import { randomUUID } from "node:crypto";
import type { DealAppraisal } from "@shared/domain/types";
import {
  checkNeutralEnquiry,
  classifyReply,
  outreachEligibility,
  type Candidate,
  type MessageChannel,
  type MessageType,
} from "@shared/domain/outreach";
import { postalKey, resolveLetterTransport } from "@backend/outreach/letter";
import { redactEmail, resolveTransport } from "@backend/email";
import {
  addSuppression,
  listDiscoveryCandidates,
  listOutreachMessages,
  listSuppressions,
  saveDiscoveryCandidate,
  saveOutreachMessage,
} from "@backend/store/repository";
import type { OutreachMessage } from "@backend/store/schema";
import { audit } from "@backend/audit";

/**
 * Composing, gating and sending an approach to a funder.
 *
 * The eligibility engine decides whether a message *may* be sent; this is what
 * actually sends one, and the order is deliberate:
 *
 *  1. Compose from the deal, anonymised.
 *  2. Check the content is genuinely neutral — no address, no seller
 *     circumstances, no projected return, sender named, opt-out present.
 *  3. Check eligibility for this recipient and this message type.
 *  4. Store it as a draft. Nothing is ever sent at composition time.
 *  5. A named person approves it.
 *  6. **Re-check everything immediately before the send**, including the
 *     suppression list. A person can opt out in the minutes between approval
 *     and delivery, and the check that matters is the one at the moment of
 *     sending, not the one at the moment of drafting.
 */

/** What a stage-one enquiry says. Anonymous by construction, not by care. */
export function composeMandateEnquiry(
  appraisal: DealAppraisal,
  senderName: string,
  optOutUrl: string,
): { readonly subject: string; readonly body: string } {
  const facility = Math.round(appraisal.funding.seniorDebt / 100);
  const band = bandOf(facility);
  const region = appraisal.inputs.property.locality;
  const months = appraisal.inputs.holdMonths;
  const type = appraisal.inputs.property.propertyType;

  return {
    subject: `Do you look at ${band} ${type} bridging in the ${region} area?`,
    body: [
      `We are ${senderName}, a property acquisition platform.`,
      "",
      `We are working on a ${type} transaction in the ${region} area needing a facility in the ${band} band over about ${months} months, on a first charge.`,
      "",
      "Before sending anything specific, we wanted to ask whether transactions of that shape are within your mandate at the moment, and who is the right person to speak to.",
      "",
      "We have not included the address or any details of the seller, and we will not unless you tell us you are interested.",
      "",
      `If you would rather we did not write again, reply with "remove me" or use this link to opt out: ${optOutUrl}`,
    ].join("\n"),
  };
}

/**
 * A band rather than a figure.
 *
 * The exact facility is a detail of a specific transaction. A band tells the
 * recipient everything they need to answer the question and identifies nothing.
 */
function bandOf(pounds: number): string {
  if (pounds < 100_000) return "under £100k";
  if (pounds < 250_000) return "£100k–£250k";
  if (pounds < 500_000) return "£250k–£500k";
  if (pounds < 1_000_000) return "£500k–£1m";
  if (pounds < 5_000_000) return "£1m–£5m";
  return "over £5m";
}

export interface DraftResult {
  readonly ok: boolean;
  readonly message?: OutreachMessage;
  readonly reason: string;
}

export async function draftEnquiry(input: {
  readonly candidate: Candidate;
  readonly dealId: string;
  readonly appraisal: DealAppraisal;
  readonly senderName: string;
  readonly optOutUrl: string;
  readonly now?: Date;
}): Promise<DraftResult> {
  const now = input.now ?? new Date();
  const { candidate } = input;

  const address = candidate.publishedEmail?.value;
  if (address === undefined) {
    return { ok: false, reason: "This candidate has no published address, so there is nothing to write to." };
  }

  const composed = composeMandateEnquiry(input.appraisal, input.senderName, input.optOutUrl);

  // The content check is not a formality: a composer changed later could start
  // leaking the address or the seller's situation, and this is what catches it.
  const content = checkNeutralEnquiry(`${composed.subject} ${composed.body}`);
  if (!content.clean) {
    return {
      ok: false,
      reason: `The drafted message is not neutral: ${content.findings.join(" ")}`,
    };
  }

  const already = (await listOutreachMessages()).some(
    (m) => m.candidateId === candidate.id && m.dealId === input.dealId && m.status !== "refused",
  );

  const eligibility = outreachEligibility(candidate, "mandate-enquiry", {
    channel: "email",
    consentRecorded: false,
    softOptInApplies: false,
    complianceApproved: false,
    promotionApproved: false,
    alreadyContactedForDeal: already,
    dealDisclosureConsent: false,
    now,
  });

  const message: OutreachMessage = {
    id: randomUUID(),
    candidateId: candidate.id,
    dealId: input.dealId,
    messageType: "mandate-enquiry",
    to: address,
    subject: composed.subject,
    body: composed.body,
    decision: eligibility.decision,
    decisionReason: eligibility.reason,
    // A message that could never lawfully be sent is stored refused rather than
    // as a draft somebody might later approve without reading why.
    channel: "email",
    status: eligibility.decision === "DO_NOT_CONTACT" ? "refused" : "draft",
    createdAt: now.toISOString(),
  };

  await saveOutreachMessage(message);
  return {
    ok: message.status === "draft",
    message,
    reason: eligibility.reason,
  };
}

export interface SendResult {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Send an approved message.
 *
 * Everything is checked again here. The gap between approving and sending is
 * where a candidate gets suppressed, a verification lapses or somebody replies
 * asking to be left alone, and a system that trusts the decision made at
 * approval time sends into exactly that gap.
 */
export async function sendApproved(
  messageId: string,
  sender: { readonly email: string },
  now: Date = new Date(),
): Promise<SendResult> {
  const message = (await listOutreachMessages()).find((m) => m.id === messageId);
  if (message === undefined) return { ok: false, reason: "No such message." };
  if (message.status === "sent" || message.status === "posted" || message.status === "queued-for-post") {
    return { ok: false, reason: `Already ${message.status.replace(/-/g, " ")}.` };
  }
  if (message.status !== "approved") {
    return { ok: false, reason: "Only an approved message is sent, and approval is a person's decision." };
  }

  // Checked by whichever key this channel is addressed by, against one list —
  // so an opt-out given by letter also stops the emails, and the other way
  // round.
  const key =
    message.channel === "letter"
      ? postalKey(message.postalAddress ?? "")
      : message.to.trim().toLowerCase();
  const suppressed = (await listSuppressions()).some((s) => s.email === key);
  if (suppressed) {
    await saveOutreachMessage({
      ...message,
      status: "refused",
      failureReason: "The address was suppressed between approval and sending.",
    });
    return { ok: false, reason: "That address is suppressed. Nothing was sent." };
  }

  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === message.candidateId);
  if (entry === undefined) return { ok: false, reason: "The candidate record has gone." };

  const recheck = outreachEligibility(entry.candidate, message.messageType as MessageType, {
    channel: message.channel,
    consentRecorded: false,
    softOptInApplies: false,
    complianceApproved: true,
    promotionApproved: false,
    alreadyContactedForDeal: false,
    dealDisclosureConsent: message.messageType === "borrower-introduction",
    ...(message.screening ?? {}),
    now,
  });
  if (!recheck.maySend) {
    await saveOutreachMessage({ ...message, status: "refused", failureReason: recheck.reason });
    return { ok: false, reason: `Re-checked before sending and refused: ${recheck.reason}` };
  }

  if (message.channel === "letter") {
    const post = resolveLetterTransport();
    const result = await post.post({
      to: message.to,
      address: message.postalAddress ?? "",
      subject: message.subject,
      body: message.body,
    });

    if (result.outcome === "failed") {
      await saveOutreachMessage({ ...message, status: "failed", failureReason: result.reason });
      return { ok: false, reason: result.reason };
    }

    // "posted" only where a provider actually took it. A letter waiting to be
    // printed is visibly waiting, not quietly assumed sent.
    await saveOutreachMessage({
      ...message,
      status: result.outcome === "dispatched" ? "posted" : "queued-for-post",
      ...(result.outcome === "dispatched"
        ? { postedAt: now.toISOString(), postedBy: post.name }
        : {}),
    });
    await audit("mandate-saved", {
      email: sender.email,
      subject: message.candidateId,
      detail: `Letter ${result.outcome} for ${message.to} via ${post.name}.`,
    });
    return { ok: true, reason: result.reason };
  }

  const transport = resolveTransport();
  const outcome = await transport.send({
    to: message.to,
    subject: message.subject,
    text: message.body,
    html: `<pre style="font:14px/1.5 system-ui;white-space:pre-wrap">${escapeHtml(message.body)}</pre>`,
    unsubscribeUrl: optOutLink(message.to),
  });

  if (!outcome.ok) {
    await saveOutreachMessage({ ...message, status: "failed", failureReason: outcome.error });
    return { ok: false, reason: `The provider refused it: ${outcome.error ?? "unknown"}` };
  }

  await saveOutreachMessage({ ...message, status: "sent", sentAt: now.toISOString() });
  await audit("mandate-saved", {
    email: sender.email,
    subject: message.candidateId,
    detail: `Sent a mandate enquiry to ${redactEmail(message.to)} via ${transport.name}.`,
  });

  return { ok: true, reason: `Sent to ${redactEmail(message.to)}.` };
}

/**
 * Handle an inbound reply.
 *
 * A removal request suppresses the address immediately and marks the candidate,
 * without waiting for anybody. That is the one classification that must never
 * depend on a person being available or a model being confident.
 */
export async function handleReply(
  from: string,
  body: string,
  now: Date = new Date(),
  channel: MessageChannel = "email",
): Promise<{ readonly classification: string; readonly suppressed: boolean }> {
  const assessment = classifyReply(body);
  const address = channel === "letter" ? postalKey(from) : from.trim().toLowerCase();

  if (assessment.suppress) {
    await addSuppression({ email: address, channel, reason: assessment.reason, at: now.toISOString() });

    for (const entry of await listDiscoveryCandidates()) {
      if (entry.candidate.publishedEmail?.value.toLowerCase() !== address) continue;
      await saveDiscoveryCandidate({
        ...entry,
        candidate: { ...entry.candidate, optedOut: true, doNotContact: true },
        notes: [...entry.notes, `Opted out on ${now.toISOString().slice(0, 10)}: ${assessment.reason}`],
      });
    }
  }

  for (const message of await listOutreachMessages()) {
    if (message.to.trim().toLowerCase() !== address || message.replyReceivedAt !== undefined) continue;
    await saveOutreachMessage({
      ...message,
      replyReceivedAt: now.toISOString(),
      replyClassification: assessment.classification,
    });
  }

  return { classification: assessment.classification, suppressed: assessment.suppress };
}

function optOutLink(email: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return `${base}/outreach/opt-out?address=${encodeURIComponent(email)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Draft a letter to a property owner.
 *
 * The one message that goes to somebody who never asked to hear from us, so it
 * runs the whole gauntlet before it becomes a draft: Seller Protection through
 * the negotiation band, the eligibility gate for the letter channel, and the
 * suppression list. Any one of them refusing means no letter, and the reason is
 * the one the reviewer sees.
 */
export async function draftOwnerLetter(input: {
  readonly candidate: Candidate;
  readonly dealId: string;
  readonly compose: () => { subject: string; body: string } | { refusedBecause: string };
  readonly screening: {
    readonly mpsScreened: boolean;
    readonly privacyNoticeIncluded: boolean;
    readonly legitimateInterestsRecorded: boolean;
  };
  readonly now?: Date;
}): Promise<DraftResult> {
  const now = input.now ?? new Date();
  const address = input.candidate.postalAddress?.value;
  if (address === undefined) {
    return { ok: false, reason: "No postal address on record for this owner." };
  }

  const suppressed = (await listSuppressions()).some((s) => s.email === postalKey(address));
  if (suppressed) {
    return { ok: false, reason: "This address is suppressed. Nothing is drafted to it." };
  }

  const composed = input.compose();
  if ("refusedBecause" in composed) {
    return { ok: false, reason: composed.refusedBecause };
  }

  const eligibility = outreachEligibility(input.candidate, "borrower-introduction", {
    channel: "letter",
    consentRecorded: false,
    softOptInApplies: false,
    complianceApproved: true,
    promotionApproved: false,
    alreadyContactedForDeal: false,
    dealDisclosureConsent: true,
    mpsScreened: input.screening.mpsScreened,
    privacyNoticeIncluded: input.screening.privacyNoticeIncluded,
    legitimateInterestsRecorded: input.screening.legitimateInterestsRecorded,
    now,
  });

  const message: OutreachMessage = {
    id: randomUUID(),
    candidateId: input.candidate.id,
    dealId: input.dealId,
    messageType: "borrower-introduction",
    channel: "letter",
    to: input.candidate.organisationName,
    postalAddress: address,
    subject: composed.subject,
    body: composed.body,
    decision: eligibility.decision,
    decisionReason: eligibility.reason,
    screening: input.screening,
    status: eligibility.decision === "DO_NOT_CONTACT" ? "refused" : "draft",
    createdAt: now.toISOString(),
  };

  await saveOutreachMessage(message);
  return {
    // Drafted either way — the screening can be completed and the letter
    // redrafted — but `ok` means clear to go, not merely stored.
    ok: eligibility.maySend,
    message,
    reason:
      eligibility.blockers.length > 0
        ? `${eligibility.reason} ${eligibility.blockers.join(" ")}`
        : eligibility.reason,
  };
}

/**
 * Mark a queued letter as actually posted.
 *
 * Separate from sending because with no print provider the two are separate
 * events: the platform renders it, a person puts it in a postbox. A letter
 * nobody posted stays visibly unposted rather than being assumed sent.
 */
export async function markPosted(
  messageId: string,
  postedBy: string,
  now: Date = new Date(),
): Promise<SendResult> {
  const message = (await listOutreachMessages()).find((m) => m.id === messageId);
  if (message === undefined) return { ok: false, reason: "No such message." };
  if (message.channel !== "letter") return { ok: false, reason: "That is not a letter." };
  if (message.status !== "queued-for-post") {
    return { ok: false, reason: `That letter is ${message.status.replace(/-/g, " ")}, not waiting to be posted.` };
  }

  await saveOutreachMessage({
    ...message,
    status: "posted",
    postedAt: now.toISOString(),
    postedBy,
  });
  await audit("mandate-saved", {
    email: postedBy,
    subject: message.candidateId,
    detail: `Marked a letter posted to ${message.to}.`,
  });

  return { ok: true, reason: `Recorded as posted by ${postedBy}.` };
}
