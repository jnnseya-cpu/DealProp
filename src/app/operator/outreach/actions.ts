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
import { draftEnquiry, sendApproved } from "@backend/outreach/service";
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
