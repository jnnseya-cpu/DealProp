import { randomUUID } from "node:crypto";
import { newToken } from "@backend/auth/tokens";
import { gbp } from "@shared/format";
import { appraise } from "@shared/domain/economics";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { fundingMetrics } from "@shared/domain/fundingMetrics";
import { checkPromotionLanguage } from "@shared/domain/regulatoryRoute";
import { contextFor, negotiationBand } from "@shared/domain/negotiation";
import { outreachEligibility, type Candidate } from "@shared/domain/outreach";
import type { DataRoomGrant, DealRecord, OutreachMessage } from "@backend/store/schema";
import {
  getDataRoomGrant,
  getDeal,
  listDataRoomGrants,
  listDiscoveryCandidates,
  listOutreachMessages,
  saveDataRoomGrant,
  saveOutreachMessage,
} from "@backend/store/repository";

/**
 * Stage two and stage three.
 *
 * Stage one asked, anonymously, whether an organisation looks at this shape of
 * transaction. These are what happens after they say yes, and each adds
 * something the previous stage deliberately withheld:
 *
 *  - **Stage two** names the property. That is a disclosure of the seller's
 *    business to a third party, so it needs the deal owner's consent — recorded,
 *    scoped and dated. An agent does not clear it by deciding the recipient
 *    seemed keen.
 *  - **Stage three** opens the memorandum. That is deal material, and it goes
 *    through a capability URL that expires, is revocable, counts every opening
 *    and carries the recipient's name on the page.
 *
 * Neither stage skips a step. Stage two requires a positive reply on record to
 * a stage-one message; stage three requires a stage-two message to have gone.
 * A funder cannot be dropped straight into the data room because somebody was
 * in a hurry.
 */

/** How long a data-room grant lasts before it stops working on its own. */
export const GRANT_DAYS = 14;

export interface StageResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly message?: OutreachMessage;
  readonly grant?: DataRoomGrant;
}

/**
 * Compose the identified teaser.
 *
 * Carries the figures a funder needs to say yes or no — the asset, the
 * facility, the leverage, the term, the exit — and nothing about the seller.
 * The seller's situation is never disclosed at any stage, to anybody: it was
 * given to us to get them help, not to make a deal more compelling.
 */
export function composeTeaser(record: DealRecord, senderName: string): { subject: string; body: string } {
  const appraisal = appraise(toWorkingDeal(record.inputs).inputs);
  const metrics = fundingMetrics(appraisal, record.evidence?.committedCash);
  const ltv = metrics.metrics.find((m) => m.key === "ltv-market");
  const property = record.inputs.property;

  return {
    subject: `${record.reference} — ${property.propertyType} in ${property.locality}, ${gbp(appraisal.funding.seniorDebt)} facility`,
    body: [
      `Thank you for confirming this is within your mandate. Here are the specifics.`,
      "",
      `Asset: ${property.bedrooms}-bed ${property.propertyType}, ${property.tenure}, ${property.locality} (${property.postcodeArea}).`,
      `Purchase price: ${gbp(record.inputs.purchasePrice)}.`,
      `Independent open-market value: ${gbp(property.openMarketValue)}.`,
      `Works: ${gbp(property.refurbishmentEstimate)}. Value on completion of works: ${gbp(property.postWorksValue)}.`,
      `Facility sought: ${gbp(appraisal.funding.seniorDebt)} over ${record.inputs.holdMonths} months${ltv?.bps !== undefined ? `, ${(ltv.bps / 100).toFixed(1)}% of value` : ""}.`,
      `Exit: ${record.inputs.exit.replace(/-/g, " ")}.`,
      "",
      `Figures are our own appraisal and are estimates, not advice or a valuation. Property values can fall, works can overrun and the exit may take longer than modelled, in which case the return would be lower or capital could be lost.`,
      "",
      `If you would like the full pack, reply and we will send a time-limited link. Reply "remove me" at any point and we will not write again.`,
      "",
      `${senderName}`,
    ].join("\n"),
  };
}

/**
 * Stage two: send the identified teaser.
 *
 * Three things must be true, and none of them is "the agent thinks this is
 * going well": the recipient replied positively to stage one, the deal owner
 * consented to identifying the transaction, and the composed text carries no
 * claim that would make it a misleading promotion.
 */
export async function sendTeaser(input: {
  readonly candidateId: string;
  readonly dealId: string;
  readonly senderName: string;
  readonly approvedBy: string;
  readonly now?: Date;
}): Promise<StageResult> {
  const now = input.now ?? new Date();

  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === input.candidateId);
  if (entry === undefined) return { ok: false, reason: "No such candidate." };

  const record = await getDeal(input.dealId);
  if (record === undefined) return { ok: false, reason: "No such deal." };

  const consent = record.disclosureConsent;
  if (consent === undefined) {
    return {
      ok: false,
      reason:
        "The deal owner has not consented to identifying this transaction. Stage one is anonymous precisely so that this is a decision somebody makes rather than a step that happens.",
    };
  }

  const messages = await listOutreachMessages();
  const interested = messages.some(
    (m) =>
      m.candidateId === input.candidateId &&
      m.dealId === input.dealId &&
      m.status === "sent" &&
      (m.replyClassification === "INTERESTED" || m.replyClassification === "REQUEST_MORE"),
  );
  if (!interested) {
    return {
      ok: false,
      reason:
        "No positive reply to a stage-one enquiry is on record. A funder is not dropped into a named transaction because somebody is in a hurry.",
    };
  }

  const composed = composeTeaser(record, input.senderName);
  const promotion = checkPromotionLanguage(`${composed.subject} ${composed.body}`);
  if (!promotion.clean) {
    return {
      ok: false,
      reason: `The teaser contains language that would make it misleading: ${promotion.findings.map((f) => f.why).join(" ")}`,
    };
  }

  const eligibility = outreachEligibility(entry.candidate, "borrower-introduction", {
    channel: "email",
    consentRecorded: true,
    softOptInApplies: false,
    complianceApproved: true,
    promotionApproved: false,
    alreadyContactedForDeal: false,
    dealDisclosureConsent: true,
    now,
  });

  const address = entry.candidate.publishedEmail?.value;
  if (address === undefined) return { ok: false, reason: "No published address." };

  const message: OutreachMessage = {
    id: randomUUID(),
    candidateId: input.candidateId,
    dealId: input.dealId,
    messageType: "borrower-introduction",
    channel: "email",
    to: address,
    subject: composed.subject,
    body: composed.body,
    decision: eligibility.decision,
    decisionReason: `${eligibility.reason} Disclosure consented on ${consent.at.slice(0, 10)} by ${consent.by}.`,
    // Drafted, never sent here. Naming a transaction to a third party is
    // approved by a person on its own merits, not carried through by the
    // approval that covered stage one.
    status: "draft",
    createdAt: now.toISOString(),
  };

  await saveOutreachMessage(message);
  return {
    ok: true,
    message,
    reason: "Teaser drafted. It needs its own approval before it goes — stage one's approval does not carry.",
  };
}

/**
 * Stage three: grant time-limited access to the memorandum.
 *
 * A capability URL, like the seller's own result page. It expires on its own,
 * so forgetting to revoke it is not the same as leaving it open for ever; it is
 * revocable before then; every opening is counted; and the page carries the
 * recipient's name and the time it was produced, so a copy that circulates says
 * who it was given to.
 */
export async function grantDataRoom(input: {
  readonly candidateId: string;
  readonly dealId: string;
  readonly grantedBy: string;
  readonly now?: Date;
}): Promise<StageResult> {
  const now = input.now ?? new Date();

  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === input.candidateId);
  if (entry === undefined) return { ok: false, reason: "No such candidate." };

  const record = await getDeal(input.dealId);
  if (record === undefined) return { ok: false, reason: "No such deal." };

  if (record.disclosureConsent?.scope !== "full-pack") {
    return {
      ok: false,
      reason:
        "The deal owner has consented to an identified teaser but not to the full pack. The memorandum is a wider disclosure and needs its own consent.",
    };
  }

  const teaserSent = (await listOutreachMessages()).some(
    (m) =>
      m.candidateId === input.candidateId &&
      m.dealId === input.dealId &&
      m.messageType === "borrower-introduction" &&
      m.status === "sent",
  );
  if (!teaserSent) {
    return {
      ok: false,
      reason: "No stage-two introduction has been sent to this funder for this deal. The stages are not optional.",
    };
  }

  const existing = (await listDataRoomGrants()).find(
    (g) =>
      g.candidateId === input.candidateId &&
      g.dealId === input.dealId &&
      g.revokedAt === undefined &&
      new Date(g.expiresAt).getTime() > now.getTime(),
  );
  if (existing !== undefined) {
    return { ok: true, grant: existing, reason: "A live grant already exists for this funder." };
  }

  const expires = new Date(now);
  expires.setDate(expires.getDate() + GRANT_DAYS);

  const grant: DataRoomGrant = {
    // A CSPRNG token, not derived from anything guessable about the deal.
    token: newToken(),
    dealId: input.dealId,
    candidateId: input.candidateId,
    organisationName: entry.candidate.organisationName,
    grantedAt: now.toISOString(),
    grantedBy: input.grantedBy,
    expiresAt: expires.toISOString(),
    accessCount: 0,
  };

  await saveDataRoomGrant(grant);
  return {
    ok: true,
    grant,
    reason: `Access granted to ${entry.candidate.organisationName} until ${grant.expiresAt.slice(0, 10)}.`,
  };
}

export interface GrantCheck {
  readonly valid: boolean;
  readonly grant?: DataRoomGrant;
  readonly reason: string;
}

/**
 * Open a grant, and count the opening.
 *
 * Expiry and revocation are both checked here rather than by a job, so a grant
 * stops working on the day it should whether or not anything ran.
 */
export async function openDataRoom(token: string, now: Date = new Date()): Promise<GrantCheck> {
  const grant = await getDataRoomGrant(token);
  if (grant === undefined) return { valid: false, reason: "This link is not valid." };
  if (grant.revokedAt !== undefined) {
    return { valid: false, reason: "This link has been withdrawn." };
  }
  if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
    return { valid: false, reason: "This link has expired. Ask for a new one." };
  }

  await saveDataRoomGrant({
    ...grant,
    accessCount: grant.accessCount + 1,
    lastAccessedAt: now.toISOString(),
  });

  return { valid: true, grant, reason: "Open." };
}

/* --------------------------------------------------------- owner approach */

/**
 * The letter to a homeowner.
 *
 * This is the one message in the system that goes to somebody who never asked
 * to hear from us, about the most valuable thing they own. So it says four
 * things most letters of this kind leave out, and each is there because leaving
 * it out is what makes the industry's version of this letter objectionable:
 *
 *  - **Where we got the address.** From the register, bought for this property.
 *    A person written to out of the blue is entitled to know how we found them.
 *  - **What the offer actually is**, against what the property is worth, in
 *    pounds and per cent — not "we buy any house".
 *  - **That an agent would very likely get them more.** True, and the sentence
 *    that turns an offer into an honest one.
 *  - **How to stop this**, in one step, without needing to explain themselves.
 */
export function composeOwnerLetter(input: {
  readonly ownerName: string;
  readonly address: string;
  readonly record: DealRecord;
  readonly senderName: string;
  readonly senderAddress: string;
  readonly optOutUrl: string;
  readonly optOutPhone: string;
  readonly reference: string;
}): { subject: string; body: string } | { refusedBecause: string } {
  const inputs = toWorkingDeal(input.record.inputs).inputs;
  const band = negotiationBand(inputs);

  if (band.blocked) {
    return {
      refusedBecause: `No offer to make: ${band.summary}`,
    };
  }
  if (band.outbidByAlternative) {
    return {
      refusedBecause:
        "The seller can plainly do better elsewhere than this deal supports. Writing to them with a lower offer would be hoping they do not know that.",
    };
  }

  const offer = band.opening?.price;
  if (offer === undefined) return { refusedBecause: "No opening position was computed." };

  const context = contextFor(offer, inputs.property.openMarketValue, COMPLETION_DAYS);

  return {
    subject: `An offer for ${input.record.inputs.property.locality} — reference ${input.reference}`,
    body: [
      `Dear ${input.ownerName},`,
      "",
      `We are ${input.senderName}. We buy property directly, and we would like to make you an offer.`,
      "",
      context.sentence,
      "",
      "We are not estate agents and we are not asking to market your property. If the offer suits you we would buy it ourselves; if it does not, that is a perfectly good answer and you will not hear from us again.",
      "",
      `Where we got your address: we bought the title register for this property from HM Land Registry, which lists the registered owner and an address for service. That is the only place it came from, and we have not shared it with anybody.`,
      "",
      `If you would rather we did not write again, call ${input.optOutPhone} or visit ${input.optOutUrl} and quote reference ${input.reference}. We will remove you the same day and we will not ask why.`,
      "",
      "You should take independent advice before accepting any offer, including this one.",
      "",
      `${input.senderName}`,
      input.senderAddress,
    ].join("\n"),
  };
}

/** The completion window an offer is made on. A promise somebody must keep. */
const COMPLETION_DAYS = 21;
