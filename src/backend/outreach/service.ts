import { randomUUID } from "node:crypto";
import type { DealAppraisal } from "@shared/domain/types";
import {
  checkNeutralEnquiry,
  classifyReply,
  outreachEligibility,
  type Candidate,
  type MessageType,
} from "@shared/domain/outreach";
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
  if (message.status === "sent") return { ok: false, reason: "Already sent." };
  if (message.status !== "approved") {
    return { ok: false, reason: "Only an approved message is sent, and approval is a person's decision." };
  }

  const suppressed = (await listSuppressions()).some(
    (s) => s.email === message.to.trim().toLowerCase(),
  );
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
    consentRecorded: false,
    softOptInApplies: false,
    complianceApproved: true,
    promotionApproved: false,
    alreadyContactedForDeal: false,
    dealDisclosureConsent: false,
    now,
  });
  if (!recheck.maySend) {
    await saveOutreachMessage({ ...message, status: "refused", failureReason: recheck.reason });
    return { ok: false, reason: `Re-checked before sending and refused: ${recheck.reason}` };
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
): Promise<{ readonly classification: string; readonly suppressed: boolean }> {
  const assessment = classifyReply(body);
  const address = from.trim().toLowerCase();

  if (assessment.suppress) {
    await addSuppression({ email: address, reason: assessment.reason, at: now.toISOString() });

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
