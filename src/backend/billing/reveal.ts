import { randomUUID } from "node:crypto";
import { appraise } from "@shared/domain/economics";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { classifyOpportunity, type InventoryItem } from "@shared/domain/inventory";
import {
  decideRefund,
  opportunityCard,
  quoteReveal,
  type OpportunityCard,
  type RefundTrigger,
  type RevealQuote,
} from "@shared/domain/reveal";
import { permissionsHeld } from "@backend/permissions";
import {
  getDeal,
  listRevealsForAccount,
  recordReveal,
  refundReveal,
} from "@backend/store/repository";
import { audit } from "@backend/audit";
import type { Account } from "@shared/domain/accounts";
import { buyerPassport, type Passport } from "@shared/domain/passport";
import {
  materialInformation,
  type MaterialReport,
} from "@shared/domain/materialInformation";
import {
  rankOpportunities,
  scoreOpportunity,
  type OpportunityScore,
} from "@shared/domain/opportunityScore";
import type { DealRecord, RevealRecord } from "@backend/store/schema";

/**
 * Quoting an opportunity for one buyer.
 *
 * The class is derived from the property and the price read from the
 * catalogue, both here. Nothing in a request decides either — a request that
 * could name its own class could buy a portfolio disposal at the
 * standard-residential price, and the failure would be silent.
 *
 * An opportunity with no category recorded is treated as AI-discovered and
 * unconfirmed. That is the honest default and it is also the safe one: it
 * makes the fee unchargeable rather than chargeable, so a record nobody
 * finished cannot be sold.
 */

export const UNCATEGORISED: InventoryItem = { category: "ai-discovered" };

export function inventoryOf(record: DealRecord): InventoryItem {
  return record.inventory ?? UNCATEGORISED;
}

export interface RevealOffer {
  readonly record: DealRecord;
  readonly quote: RevealQuote;
  readonly card: OpportunityCard;
  /** The buyer's own purchase of this opportunity, where they have made one. */
  readonly opened?: RevealRecord;
  /** The buyer's readiness against this opportunity's price. */
  readonly passport?: Passport;
  /** How good it is, and how much of that is actually established. */
  readonly score: OpportunityScore;
  /** What a buyer is entitled to be told before they spend money. */
  readonly material: MaterialReport;
}

export async function quoteRevealForDeal(
  dealId: string,
  account: Account | undefined,
  now: Date = new Date(),
): Promise<RevealOffer | undefined> {
  const record = await getDeal(dealId);
  if (record === undefined) return undefined;
  const opened = account === undefined ? [] : await listRevealsForAccount(account.id);
  return offerFor(record, opened, account, now);
}

/**
 * Every opportunity, as this buyer sees it.
 *
 * The account's own purchases are read once and passed in rather than looked up
 * per opportunity: a list of forty opportunities would otherwise be forty
 * round trips to answer the same question.
 */
export async function offersFor(
  records: readonly DealRecord[],
  account: Account,
  now: Date = new Date(),
): Promise<readonly RevealOffer[]> {
  const opened = await listRevealsForAccount(account.id);
  // Ranked by the capped score, so an unevidenced 92 sits below an evidenced
  // 70. That ordering is the whole point of scoring beyond discount.
  return rankOpportunities(records.map((record) => offerFor(record, opened, account, now)));
}

function offerFor(
  record: DealRecord,
  opened: readonly RevealRecord[],
  account: Account | undefined,
  now: Date,
): RevealOffer {
  const item = inventoryOf(record);
  const inputs = toWorkingDeal(record.inputs).inputs;
  const property = appraise(inputs).inputs.property;
  const mine = opened.find((r) => r.dealId === record.id && r.refundedAt === undefined);

  // Graded against this opportunity's own price. "Funded" is not an absolute:
  // £180,000 evidenced is grade A against a terrace and grade B against a
  // townhouse, and a marketplace that grades buyers without reference to what
  // they are buying is grading them against nothing.
  const passport =
    account === undefined
      ? undefined
      : buyerPassport(account.passportEvidence ?? {}, inputs.purchasePrice, now);

  const material = materialInformation(property, record.material ?? {});

  const quote = quoteReveal({
    opportunity: classifyOpportunity(property, item),
    item,
    permissionsHeld: permissionsHeld(),
    ...(passport !== undefined ? { passport } : {}),
    // Completed and withdrawn are the two states where there is no
    // introduction left to make. A funded deal is still one, because the buyer
    // is buying an introduction to a transaction rather than to a vacancy.
    closed: record.status === "completed" || record.status === "withdrawn",
    // A recorded listing signal means the property is being advertised: the
    // signal is derived from a live listing, so its presence with days on
    // market is the fact that it is on a portal now.
    openlyAdvertised: (record.listing?.daysOnMarket ?? 0) > 0,
    material,
    alreadyOpened: mine !== undefined,
  });

  return {
    record,
    quote,
    card: opportunityCard({
      reference: record.reference,
      property,
      guidePrice: inputs.purchasePrice,
      item,
      quote,
    }),
    ...(mine !== undefined ? { opened: mine } : {}),
    ...(passport !== undefined ? { passport } : {}),
    material,
    score: scoreOpportunity({
      inputs,
      item,
      ...(record.evidence !== undefined ? { evidence: record.evidence } : {}),
      now,
    }),
  };
}

/* ------------------------------------------------ opening and refunding */

export interface RevealOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Open one opportunity for one buyer.
 *
 * The quote is recomputed here rather than trusted from the request — the page
 * that showed it is a page, and a page can be old, edited or fabricated. The
 * idempotency key is derived from the buyer and the opportunity rather than
 * generated, because the thing being made unique is "this buyer opened this
 * opportunity", and a fresh random key on every retry would make that not
 * unique at all.
 *
 * What is written down is what the buyer was shown: the category, the sentence
 * and the price. If the opportunity is later reclassified, the record of what
 * they paid for does not move with it — that record is the whole basis of the
 * refund.
 */
export async function openOpportunity(
  dealId: string,
  account: Account,
  paymentReference: string,
): Promise<RevealOutcome> {
  const offer = await quoteRevealForDeal(dealId, account);
  if (offer === undefined) return { ok: false, message: "No such opportunity." };

  if (!offer.quote.chargeable) {
    return { ok: false, message: offer.quote.blockers.map((b) => b.reason).join(" ") };
  }

  const reference = paymentReference.trim();
  if (reference === "") {
    return {
      ok: false,
      message: "No payment reference, so there is nothing to record against. Nothing was opened.",
    };
  }

  const record: RevealRecord = {
    id: randomUUID(),
    dealId,
    accountId: account.id,
    opportunity: offer.quote.opportunity,
    // The catalogue price at the moment of sale, frozen. Not read back later.
    paid: offer.quote.price,
    paidAt: new Date().toISOString(),
    categoryAtPurchase: inventoryOf(offer.record).category,
    disclosureShown: offer.quote.disclosure,
    idempotencyKey: `reveal:${account.id}:${dealId}:${reference}`,
  };

  const written = await recordReveal(record);
  if (!written) {
    return {
      ok: false,
      message: "This opportunity is already open to you. Nothing was charged a second time.",
    };
  }

  await audit("opportunity-opened", {
    account: { id: account.id, email: account.email },
    subject: dealId,
    detail: `${record.opportunity} · ${record.paid} pence · ${record.categoryAtPurchase}`,
  });

  return { ok: true, message: "Opened. The pack and the introduction are on the opportunity." };
}

/**
 * Give the fee back.
 *
 * Nobody has to be persuaded, which is what the guarantee says and therefore
 * what this has to do. The only reasons it refuses are that the claim is
 * outside the stated window, the dates are impossible, or it has already been
 * refunded — and a person cannot override any of the three, because a
 * guarantee an operator can decline is a concession.
 */
export async function claimRevealRefund(
  revealId: string,
  accountId: string,
  trigger: RefundTrigger,
): Promise<RevealOutcome> {
  const mine = (await listRevealsForAccount(accountId)).find((r) => r.id === revealId);
  // Scoped to the claimant's own purchases. A refund keyed only on an id is a
  // refund anybody who guesses an id can trigger against somebody else's money.
  if (mine === undefined) return { ok: false, message: "No such purchase on this account." };
  if (mine.refundedAt !== undefined) {
    return { ok: false, message: "That has already been refunded." };
  }

  const decision = decideRefund(
    { trigger, paidAt: mine.paidAt, claimedAt: new Date().toISOString() },
    mine.paid,
  );
  if (!decision.refund) return { ok: false, message: decision.reason };

  const written = await refundReveal(mine.id, new Date().toISOString(), trigger, decision.reason);
  if (!written) return { ok: false, message: "That has already been refunded." };

  await audit("opportunity-refunded", {
    account: { id: accountId, email: "" },
    subject: mine.dealId,
    detail: `${trigger} · ${decision.amount} pence`,
  });

  return { ok: true, message: decision.reason };
}
