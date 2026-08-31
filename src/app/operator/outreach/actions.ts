"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import {
  addSuppression,
  getDeal,
  listDiscoveryCandidates,
  listOutreachMessages,
  saveOutreachMessage,
} from "@backend/store/repository";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { appraise } from "@shared/domain/economics";
import { draftEnquiry, draftOwnerLetter, markPosted, sendApproved } from "@backend/outreach/service";
import { composeOwnerLetter } from "@backend/outreach/stages";
import { grantDataRoom, sendTeaser } from "@backend/outreach/stages";
import { saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";

/**
 * Drafting, approving and sending an approach to a funder.
 *
 * Three separate actions on purpose. Composing is not approving and approving
 * is not sending, because each is a different decision and collapsing them is
 * how a system ends up emailing somebody nobody meant to email.
 */

export interface OutreachResult {
  readonly ok: boolean;
  readonly message: string;
}

const SENDER = process.env.NEWSLETTER_SENDER_NAME ?? "Lode";

export async function draftEnquiryAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  await requirePermission("manage-mandates", "/operator/outreach");

  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const dealId = String(formData.get("dealId") ?? "").trim();

  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === candidateId);
  if (entry === undefined) return { ok: false, message: "No such candidate." };
  if (entry.approvedAt === undefined) {
    return {
      ok: false,
      message: "This candidate has not been approved for outreach. Approve it first, on the discovery page.",
    };
  }

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const result = await draftEnquiry({
    candidate: entry.candidate,
    dealId,
    appraisal: appraise(toWorkingDeal(record.inputs).inputs),
    senderName: SENDER,
    optOutUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/outreach/opt-out`,
  });

  revalidatePath("/operator/outreach");
  return {
    ok: result.ok,
    message: result.ok
      ? `Drafted. It will not go anywhere until somebody approves it. ${result.reason}`
      : result.reason,
  };
}

export async function approveMessageAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return {
      ok: false,
      message:
        "Approving a message needs a named person. Sign in with your own account rather than the shared password — there is nobody behind a shared password to have made this decision.",
    };
  }

  const id = String(formData.get("messageId") ?? "").trim();
  const message = (await listOutreachMessages()).find((m) => m.id === id);
  if (message === undefined) return { ok: false, message: "No such message." };
  if (message.status !== "draft") {
    return { ok: false, message: `This message is ${message.status}, not a draft.` };
  }
  if (message.decision !== "SEND_ALLOWED") {
    return {
      ok: false,
      message: `Eligibility says ${message.decision}: ${message.decisionReason}`,
    };
  }

  await saveOutreachMessage({
    ...message,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: author.email,
  });
  await audit("mandate-saved", {
    account: author,
    subject: message.candidateId,
    detail: "Approved an outreach message for sending.",
  });

  revalidatePath("/operator/outreach");
  return { ok: true, message: "Approved. Send it when you are ready." };
}

export async function sendMessageAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return { ok: false, message: "Sending needs a named person." };
  }

  const id = String(formData.get("messageId") ?? "").trim();
  const result = await sendApproved(id, { email: author.email });

  revalidatePath("/operator/outreach");
  return { ok: result.ok, message: result.reason };
}

/** Suppress an address by hand, without waiting for a reply to arrive. */
export async function suppressAddressAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/outreach");
  const author = viewerAccount(viewer);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const reason = String(formData.get("reason") ?? "").trim();
  if (email === "" || !email.includes("@")) return { ok: false, message: "Give an address." };

  const added = await addSuppression({
    email,
    reason: reason === "" ? "Suppressed by hand." : reason,
    at: new Date().toISOString(),
  });
  await audit("mandate-deleted", {
    ...(author !== undefined ? { account: author } : {}),
    subject: email,
    detail: `Suppressed. ${reason}`,
  });

  revalidatePath("/operator/outreach");
  return {
    ok: true,
    message: added ? `${email} will not be written to again.` : `${email} was already suppressed.`,
  };
}

/**
 * Record the deal owner's consent to identify the transaction.
 *
 * Stage one is anonymous so that this is a decision somebody makes, on the
 * record, rather than a step that happens because a recipient sounded keen.
 * Scoped: consenting to a named teaser is not consenting to the full pack.
 */
export async function recordDisclosureConsentAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("view-seller-data", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return { ok: false, message: "Consent has to be recorded against a named person." };
  }

  const dealId = String(formData.get("dealId") ?? "").trim();
  const scope = String(formData.get("scope") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (scope !== "identified-teaser" && scope !== "full-pack") {
    return { ok: false, message: "Choose what the owner has agreed to." };
  }

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  await saveDeal({
    ...record,
    disclosureConsent: {
      at: new Date().toISOString(),
      by: author.email,
      scope,
      note: note === "" ? "No note given." : note,
    },
  });
  await audit("viewed-seller-data", {
    account: author,
    subject: dealId,
    detail: `Recorded disclosure consent: ${scope}. ${note}`,
  });

  revalidatePath("/operator/outreach");
  return {
    ok: true,
    message:
      scope === "full-pack"
        ? "Recorded. The teaser and the data room are both available for this deal."
        : "Recorded. The teaser is available; the full pack needs its own consent.",
  };
}

/** Stage two: draft the identified teaser. It still needs its own approval. */
export async function sendTeaserAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) return { ok: false, message: "This needs a named person." };

  const result = await sendTeaser({
    candidateId: String(formData.get("candidateId") ?? "").trim(),
    dealId: String(formData.get("dealId") ?? "").trim(),
    senderName: SENDER,
    approvedBy: author.email,
  });

  revalidatePath("/operator/outreach");
  return { ok: result.ok, message: result.reason };
}

/** Stage three: grant expiring, watermarked access to the pack. */
export async function grantDataRoomAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("view-deal-material", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) return { ok: false, message: "This needs a named person." };

  const result = await grantDataRoom({
    candidateId: String(formData.get("candidateId") ?? "").trim(),
    dealId: String(formData.get("dealId") ?? "").trim(),
    grantedBy: author.email,
  });

  if (result.ok && result.grant !== undefined) {
    await audit("viewed-deal-material", {
      account: author,
      subject: result.grant.dealId,
      detail: `Granted data-room access to ${result.grant.organisationName} until ${result.grant.expiresAt.slice(0, 10)}.`,
    });
  }

  revalidatePath("/operator/outreach");
  return {
    ok: result.ok,
    message:
      result.ok && result.grant !== undefined
        ? `${result.reason} Link: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/dataroom/${result.grant.token}`
        : result.reason,
  };
}

/**
 * Draft a letter to a property owner.
 *
 * The three screening boxes are not paperwork. Direct mail to a person relies
 * on legitimate interests, which is a test to be applied and recorded rather
 * than asserted, and the eligibility gate refuses the letter until each has
 * actually been done.
 */
export async function draftOwnerLetterAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("view-seller-data", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return { ok: false, message: "Writing to a homeowner needs a named person behind it." };
  }

  const candidateId = String(formData.get("candidateId") ?? "").trim();
  const dealId = String(formData.get("dealId") ?? "").trim();

  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === candidateId);
  if (entry === undefined) return { ok: false, message: "No such owner on record." };

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await draftOwnerLetter({
    candidate: entry.candidate,
    dealId,
    screening: {
      mpsScreened: formData.get("mpsScreened") !== null,
      privacyNoticeIncluded: formData.get("privacyNoticeIncluded") !== null,
      legitimateInterestsRecorded: formData.get("legitimateInterestsRecorded") !== null,
    },
    compose: () =>
      composeOwnerLetter({
        ownerName: entry.candidate.organisationName,
        address: entry.candidate.postalAddress?.value ?? "",
        record,
        senderName: SENDER,
        senderAddress: process.env.NEWSLETTER_SENDER_ADDRESS ?? "",
        optOutUrl: `${site}/outreach/opt-out`,
        optOutPhone: process.env.OUTREACH_OPT_OUT_PHONE ?? "the number on this letter",
        reference: record.reference,
      }),
  });

  await audit("viewed-seller-data", {
    account: author,
    subject: dealId,
    detail: `Owner letter drafted for ${entry.candidate.organisationName}: ${result.reason}`,
  });

  revalidatePath("/operator/outreach");
  return { ok: result.ok, message: result.reason };
}

/** Record that a queued letter actually went in the post. */
export async function markPostedAction(
  _previous: OutreachResult | undefined,
  formData: FormData,
): Promise<OutreachResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/outreach");
  const author = viewerAccount(viewer);
  if (author === undefined) return { ok: false, message: "This needs a named person." };

  const result = await markPosted(String(formData.get("messageId") ?? "").trim(), author.email);
  revalidatePath("/operator/outreach");
  return { ok: result.ok, message: result.reason };
}
