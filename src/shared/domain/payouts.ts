import { add, applyBps, sub, ZERO, type Money } from "@shared/money";
import { gbp } from "@shared/format";
import { providerCommission, type ProviderKind } from "@shared/domain/pricing";

/**
 * Paying out money that was collected on somebody else's behalf.
 *
 * Everything else in the billing code is about money coming in. This is the
 * other direction, and it is more dangerous, because a payment that comes in
 * wrongly can be refunded and a payment that goes out wrongly is gone.
 *
 * Three failures decide the whole design:
 *
 *  1. **Paying out a share of money that is later charged back.** The buyer
 *     disputes, the provider has already been paid, and the platform is out
 *     the whole amount rather than its commission. This is the common way a
 *     marketplace loses more than it earns, and the answer is a hold period
 *     plus a hard block while any reversal is outstanding — not a policy about
 *     reviewing disputes.
 *  2. **Paying twice.** A retried transfer, a double-clicked button, a
 *     redelivered webhook. Every payout carries an idempotency key the store
 *     holds unique, exactly like the ledger.
 *  3. **Paying somebody unverified.** Sending money to an account nobody
 *     checked is how a marketplace becomes the payment leg of somebody else's
 *     fraud, and the money is unrecoverable by the time anybody notices.
 *
 * What is deliberately absent: any path that pays out a purchase deposit.
 * Client money needs a client account and the rules that come with it, and
 * §20 prohibits holding one here at all. What moves through this file is our
 * own revenue being split, never somebody's house deposit.
 */

export const PAYOUTS_VERSION = "payouts-1";

/**
 * How long money sits before it may be paid on.
 *
 * Fourteen days, matching the reveal refund window exactly, and the match is
 * the point: paying out before a buyer's own guarantee has expired is paying
 * out money we have promised to give back. Card disputes run far longer than
 * that, which is what the reversal block below is for — the hold covers the
 * refunds we control, the block covers the ones we do not.
 */
export const PAYOUT_HOLD_DAYS = 14;

export type RecipientKind = "estate-agent" | "provider" | "introducer";

/**
 * Somebody we may send money to.
 *
 * The verification is evidence with a date and a name on it, the same shape as
 * a funder's, and for the same reason: a boolean anybody can set is a claim,
 * not a check.
 */
export interface PayoutRecipient {
  readonly id: string;
  readonly name: string;
  readonly kind: RecipientKind;
  /** The provider's connected-account id. Absent means nowhere to send it. */
  readonly connectedAccountId?: string;
  /** ISO-8601, when we verified who they are and that the account is theirs. */
  readonly verifiedAt?: string;
  readonly verifiedBy?: string;
  /** What was checked — company number, bank verification, the account holder. */
  readonly verificationEvidence?: string;
  /** Set when payouts to this recipient are stopped. */
  readonly suspendedAt?: string;
  readonly suspendedReason?: string;
}

/** How long a recipient's verification stands. */
export const RECIPIENT_VERIFICATION_MONTHS = 12;

function current(iso: string | undefined, now: Date, months: number): boolean {
  if (iso === undefined) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at) || at > now.getTime()) return false;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return at >= cutoff.getTime();
}

export function recipientIsPayable(
  recipient: PayoutRecipient | undefined,
  now: Date,
): boolean {
  if (recipient === undefined) return false;
  if (recipient.suspendedAt !== undefined) return false;
  if ((recipient.connectedAccountId ?? "").trim() === "") return false;
  if ((recipient.verifiedBy ?? "").trim() === "") return false;
  if ((recipient.verificationEvidence ?? "").trim() === "") return false;
  return current(recipient.verifiedAt, now, RECIPIENT_VERIFICATION_MONTHS);
}

/* ------------------------------------------------------- what is owed */

/**
 * A share of one collected payment.
 *
 * The gross is what the customer paid us. The recipient's share comes out of
 * it and our commission is what is left — stated that way round because it is
 * the way round the recipient reads it, and a marketplace that describes the
 * split from its own side is a marketplace whose partners do their own
 * arithmetic and find a different answer.
 */
export interface Split {
  /** What the customer paid, in full. */
  readonly gross: Money;
  /** What goes to the recipient. */
  readonly recipient: Money;
  /** What the platform keeps. */
  readonly platform: Money;
  /** How the split was arrived at, in a sentence they can check. */
  readonly basis: string;
}

/**
 * Split a collected payment with a provider.
 *
 * `providerFee()` states what the platform earns; this states what the other
 * side gets, from the same number, so the two can never disagree. Computed
 * rather than stored, on the same rule as everything else that states an
 * amount.
 */
export function splitWithProvider(gross: Money, kind: ProviderKind): Split {
  const commission = providerCommission(kind);
  const platform =
    commission.fixed !== undefined
      ? // A fixed fee larger than the payment would pay the recipient nothing
        // and still bill them. Capped at the payment, which makes the extreme
        // case "we keep it all" rather than "they owe us money".
        (commission.fixed > gross ? gross : commission.fixed)
      : commission.rateBps !== undefined
        ? applyBps(gross, commission.rateBps)
        : ZERO;

  return {
    gross,
    recipient: sub(gross, platform),
    platform,
    basis: `${commission.label}: ${commission.basis} ${gbp(platform)} of ${gbp(gross)}.`,
  };
}

/* ------------------------------------------------ whether it may be paid */

export interface PayoutBlocker {
  readonly reason: string;
  readonly remedy: string;
}

export interface PayoutContext {
  readonly recipient: PayoutRecipient | undefined;
  readonly amount: Money;
  /** ISO-8601, when the money this comes from was collected. */
  readonly collectedAt: string;
  /** True where any reversal against the source payment is outstanding. */
  readonly reversalOutstanding: boolean;
  /** True where this payout has already been made. */
  readonly alreadyPaid: boolean;
  /** True where the source payment has been refunded in whole or in part. */
  readonly sourceRefunded: boolean;
  readonly now: Date;
}

export interface PayoutDecision {
  readonly payable: boolean;
  readonly amount: Money;
  readonly blockers: readonly PayoutBlocker[];
  /** ISO-8601, the earliest this could be paid. Undefined where never. */
  readonly releasesAt?: string;
  readonly summary: string;
  readonly version: string;
}

function daysSince(iso: string, now: Date): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return Number.NaN;
  return (now.getTime() - at) / 86_400_000;
}

/**
 * May this money go out today?
 *
 * Answers no far more often than yes, and every no says what would clear it.
 * The order matters: a suspended or unverified recipient is reported before
 * the hold period, because "wait fourteen days" is the wrong thing to tell
 * somebody whose account we would never pay.
 */
export function decidePayout(context: PayoutContext): PayoutDecision {
  const blockers: PayoutBlocker[] = [];

  if (context.amount <= ZERO) {
    blockers.push({
      reason: "There is nothing to pay.",
      remedy: "Nothing. A payout of zero is not a payout.",
    });
  }

  if (context.recipient === undefined) {
    blockers.push({
      reason: "No recipient is recorded.",
      remedy: "Record who is owed this, and the account it goes to.",
    });
  } else if (context.recipient.suspendedAt !== undefined) {
    blockers.push({
      reason: `Payouts to ${context.recipient.name} are suspended: ${context.recipient.suspendedReason ?? "no reason recorded"}.`,
      remedy: "Lift the suspension, by name, or pay them another way and record it.",
    });
  } else if (!recipientIsPayable(context.recipient, context.now)) {
    blockers.push({
      reason: `${context.recipient.name} is not verified for payouts, or the verification has lapsed.`,
      remedy:
        "Record who checked them, what was checked, and the connected account. Sending money to an account nobody checked is how a marketplace becomes the payment leg of somebody else's fraud, and it is unrecoverable by the time anybody notices.",
    });
  }

  if (context.sourceRefunded) {
    blockers.push({
      reason: "The payment this comes from has been refunded.",
      remedy: "Nothing. There is no longer any money to share.",
    });
  }

  if (context.reversalOutstanding) {
    blockers.push({
      reason: "A reversal against the source payment is outstanding.",
      remedy:
        "Wait for it to resolve. Paying out a share of money that is later charged back loses the whole amount rather than the commission, which is the common way a marketplace loses more than it earns.",
    });
  }

  const elapsed = daysSince(context.collectedAt, context.now);
  const held = Number.isNaN(elapsed) || elapsed < PAYOUT_HOLD_DAYS;
  if (held) {
    blockers.push({
      reason: Number.isNaN(elapsed)
        ? "The collection date cannot be read."
        : `Collected ${Math.floor(elapsed)} days ago, inside the ${PAYOUT_HOLD_DAYS}-day hold.`,
      remedy: `Wait. The hold matches the buyer's own refund window exactly — paying out before it expires is paying out money we have promised to give back.`,
    });
  }

  if (context.alreadyPaid) {
    blockers.push({
      reason: "This payout has already been made.",
      remedy: "Nothing. A share is paid once, and the store holds the key unique.",
    });
  }

  const releasesAt = Number.isNaN(elapsed)
    ? undefined
    : new Date(Date.parse(context.collectedAt) + PAYOUT_HOLD_DAYS * 86_400_000).toISOString();

  return {
    payable: blockers.length === 0,
    amount: context.amount,
    blockers,
    ...(releasesAt !== undefined ? { releasesAt } : {}),
    summary:
      blockers.length === 0
        ? `${gbp(context.amount)} may be paid to ${context.recipient?.name ?? "the recipient"} now.`
        : `${gbp(context.amount)} is owed and cannot be paid yet: ${blockers[0]?.reason ?? ""}`,
    version: PAYOUTS_VERSION,
  };
}

/** What is owed across a set of decisions, for a page that has to total it. */
export function payoutTotals(decisions: readonly PayoutDecision[]): {
  readonly payable: Money;
  readonly held: Money;
} {
  return {
    payable: add(...decisions.filter((d) => d.payable).map((d) => d.amount), ZERO),
    held: add(...decisions.filter((d) => !d.payable).map((d) => d.amount), ZERO),
  };
}
