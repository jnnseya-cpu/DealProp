import { add, isZero, money, sub, ZERO, type Money } from "@shared/money";

/**
 * Prepaid balance: what is held, what may be spent, and what may come back out.
 *
 * The shape of this module is decided by the ways a stored-value balance loses
 * money, all of which have been designed against rather than left to be caught
 * later:
 *
 *  - **Overspend.** Balance is never a mutable number that a caller decrements.
 *    Spending is an allocation against specific lots that either succeeds in
 *    full or does not happen, so two simultaneous spends cannot both see the
 *    same balance and both succeed.
 *  - **Cash-out through a bonus.** Balance given away is a separate lot with no
 *    cash behind it, and cash refunds are computed from cash received. A
 *    promotional top-up therefore cannot be converted into money.
 *  - **Spend-then-reverse.** A chargeback reverses the whole lot whether or not
 *    it was spent. The resulting position is negative and visible, rather than
 *    silently clamped at zero, which is how a platform ends up giving away the
 *    service and the money.
 *  - **Indefinite liability.** Lots expire. Expiry is derived from a date
 *    passed in, never from the clock, so it is testable and cannot differ
 *    between two parts of the system.
 *  - **Refunding more than was received.** Every payout is proportional to cash
 *    actually taken and rounded down.
 *
 * Pure and framework-free. The store makes the writes atomic; this decides what
 * the writes should be.
 */

export type LotKind =
  /** Bought with money. Refundable in cash while unspent. */
  | "purchased"
  /** Given: a promotional bonus or a plan's periodic allowance. Never cash. */
  | "granted";

export interface CreditLot {
  readonly id: string;
  readonly accountId: string;
  readonly kind: LotKind;
  /** Balance credited when the lot was created. */
  readonly original: Money;
  /** Balance still unspent. Never below zero, never above `original`. */
  readonly remaining: Money;
  /** Gross cash received for this lot, including tax. Zero for a grant. */
  readonly cashGross: Money;
  /** The tax element of `cashGross`, which is reclaimed on a refund. */
  readonly cashTax: Money;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The payment this lot came from, for reversing exactly what a dispute names. */
  readonly paymentReference?: string;
  /** Set when a refund or chargeback voided the lot. A voided lot is unspendable. */
  readonly voidedAt?: string;
  readonly voidedReason?: string;
}

export type EntryKind =
  | "topup"
  | "spend"
  | "expire"
  | "refund"
  | "chargeback"
  /** A goodwill credit or correction. Always carries a named author and a reason. */
  | "adjustment"
  /**
   * One use of a plan allowance, at no cost.
   *
   * Carries no money — the amount is zero — but it is written to the ledger
   * rather than counted from the audit trail, for two reasons. The audit write
   * is best-effort and swallows its failures, so a logging blip would silently
   * hand out an uncapped allowance; and the ledger's unique key makes reopening
   * the same document twice in a period free, which is what a customer expects
   * and what stops a cap becoming a trap.
   */
  | "allowance"
  /**
   * Service consumed and then paid for again out of our pocket.
   *
   * Written when a reversal takes back more than was left unspent. It moves no
   * balance — the balance is already gone — so it exists purely to make the
   * loss a number rather than an absence.
   */
  | "debt"
  /** A cost the provider charged us, such as a dispute fee. */
  | "fee";

/**
 * One movement, appended and never changed.
 *
 * Same rule as the audit trail, for the same reason: a ledger that can be
 * edited cannot answer the question it exists to answer, and the question is
 * always asked after money has already gone missing.
 */
export interface LedgerEntry {
  readonly id: string;
  readonly at: string;
  readonly accountId: string;
  readonly kind: EntryKind;
  /** Signed. Positive adds balance, negative removes it. */
  readonly amount: Money;
  readonly lotId?: string;
  /** A payment id, an operation id — whatever this movement is evidence of. */
  readonly reference?: string;
  /**
   * The key that makes this movement happen at most once.
   *
   * Every money-moving call carries one and the store holds it unique. A
   * retried webhook, a double-clicked button and a redelivered provider event
   * all collapse to the same single entry.
   */
  readonly idempotencyKey: string;
  readonly reason: string;
}

/** True where the lot can still be spent from on the given date. */
export function isSpendable(lot: CreditLot, now: Date): boolean {
  if (lot.voidedAt !== undefined) return false;
  if (lot.remaining <= 0) return false;
  return !hasExpired(lot, now);
}

export function hasExpired(lot: CreditLot, now: Date): boolean {
  const expiry = new Date(lot.expiresAt);
  if (Number.isNaN(expiry.getTime())) return true; // Unreadable date: treat as spent.
  return expiry.getTime() <= now.getTime();
}

/** What may be spent right now. */
export function availableBalance(lots: readonly CreditLot[], now: Date): Money {
  return add(...lots.filter((lot) => isSpendable(lot, now)).map((lot) => lot.remaining));
}

/**
 * The account's true position, which can be worse than zero.
 *
 * `available` is what may be spent. `owed` is what has been consumed and then
 * reversed — service delivered, money taken back. Clamping that to zero would
 * hide the only number that matters after a dispute.
 */
export interface Standing {
  readonly available: Money;
  /** Service delivered, then taken back. What we are out of pocket. */
  readonly owed: Money;
  /** Fees the provider charged us, chiefly on disputes. Never recoverable here. */
  readonly fees: Money;
  /** False while anything is owed: no further spending until it is settled. */
  readonly maySpend: boolean;
  readonly reason: string;
}

/**
 * The account's true position, which can be worse than zero.
 *
 * Debt is read from explicit `debt` entries rather than reconstructed from lot
 * arithmetic. The reversal decides how much was consumed at the moment it
 * happens, when the lot's state is known; recomputing it later from a lot that
 * has since expired or been partly refunded gives a different answer every time
 * it is asked, and a debt figure that moves is a debt figure nobody trusts.
 *
 * Fees are kept apart from debt on purpose. What a customer consumed and did
 * not pay for is arguably theirs to settle; a dispute fee the provider charged
 * us is our cost whatever the outcome. Rolling the two together would either
 * overstate what may be pursued or hide what a serial disputer actually costs.
 */
export function standing(
  lots: readonly CreditLot[],
  entries: readonly LedgerEntry[],
  now: Date,
): Standing {
  const available = availableBalance(lots, now);

  // Signed, not absolute. Debt entries are negative when incurred and positive
  // when written off, so summing the magnitudes would make a write-off increase
  // the debt it was meant to clear. Floored at zero: an over-generous write-off
  // is a mistake to correct, not a balance to hand back.
  const signedTotal = (kind: EntryKind): number =>
    entries.filter((e) => e.kind === kind).reduce((total, e) => total + e.amount, 0);

  const owed = money(Math.max(0, -signedTotal("debt")));
  const fees = money(Math.max(0, -signedTotal("fee")));

  if (owed > 0) {
    return {
      available,
      owed,
      fees,
      maySpend: false,
      reason: `A payment was reversed after the balance was spent. £${(owed / 100).toFixed(2)} is outstanding and spending is suspended until it is settled.`,
    };
  }

  return {
    available,
    owed: ZERO,
    fees,
    maySpend: true,
    reason:
      available > 0
        ? `£${(available / 100).toFixed(2)} available.`
        : "No prepaid balance. Top up to run metered operations.",
  };
}

/* -------------------------------------------------------------- reversals */

export interface Reversal {
  /** Balance to remove from the lot. Never more than it has left. */
  readonly balanceRemoved: Money;
  /** Balance already consumed that the reversal has now taken payment for. */
  readonly debt: Money;
  /** True where nothing is left and the lot should be closed outright. */
  readonly voids: boolean;
  readonly reason: string;
}

/**
 * What a refund or dispute does to one lot.
 *
 * A chargeback takes everything, so it is the full-reversal case. A refund may
 * be partial, and treating a partial refund as a full one would strip balance
 * the customer still owns and has paid for — which produces the second dispute,
 * from a customer who is now right.
 *
 * The balance removed is proportional to the cash returned. Whatever that
 * proportion covers beyond what is still sitting unspent is service already
 * delivered and now unpaid for, which is the debt.
 *
 *   £100 paid, nothing spent, all refunded   → remove £100, no debt.
 *   £100 paid, £70 spent, all refunded       → remove £30, £70 owed.
 *   £100 paid, £70 spent, 30% refunded       → remove £30, no debt.
 *   £100 paid, £70 spent, 50% refunded       → remove £30, £20 owed.
 *
 * The share is decided once per payment by `reversalShare`, never per lot.
 */
export function reversalImpact(lot: CreditLot, proportion: number): Reversal {
  if (lot.voidedAt !== undefined) {
    return {
      balanceRemoved: ZERO,
      debt: ZERO,
      voids: false,
      reason: "Already reversed. A second reversal of one payment takes nothing further.",
    };
  }

  const share = Math.min(1, Math.max(0, proportion));
  const clawedBack = money(Math.round(lot.original * share));

  const balanceRemoved = money(Math.min(clawedBack, lot.remaining));
  const debt = money(Math.max(0, clawedBack - lot.remaining));

  return {
    balanceRemoved,
    debt,
    voids: share >= 1,
    reason:
      share >= 1
        ? "The payment was reversed in full, so the lot is closed."
        : `${Math.round(share * 100)}% of the payment was returned.`,
  };
}

/**
 * How much of a payment a reversal takes back, as a share of the whole.
 *
 * Computed once per payment rather than per lot, which is the correction to an
 * earlier version that computed it per lot. A £100 top-up that carries a £5
 * bonus is two lots, and the bonus has no cash behind it — so a per-lot
 * calculation saw a lot with zero cash, concluded it was fully refunded, and
 * wiped the whole bonus for a partial refund. A £40 refund took £45.
 *
 * A refund of two fifths of a payment takes back two fifths of everything that
 * payment granted, bonus included. Capped at one: a provider cannot refund more
 * than it took, and if it reports otherwise the excess is not ours to claw back
 * from a balance.
 */
export function reversalShare(
  lots: readonly CreditLot[],
  refundedGross: Money | "full",
): number {
  if (refundedGross === "full") return 1;
  const cashTaken = lots.reduce<number>((total, lot) => total + lot.cashGross, 0);
  if (cashTaken <= 0) return 1;
  return Math.min(1, refundedGross / cashTaken);
}

/* ------------------------------------------------------------ allocation */

export interface Allocation {
  readonly lotId: string;
  readonly amount: Money;
}

export interface SpendPlan {
  readonly ok: boolean;
  readonly allocations: readonly Allocation[];
  /** How much could not be covered. Zero when `ok`. */
  readonly shortfall: Money;
  readonly reason: string;
}

/**
 * Decide which lots a spend comes out of.
 *
 * Ordered by expiry, soonest first, so balance is used before it lapses rather
 * than lapsing while later balance is spent. Ties break towards granted lots,
 * which is the order that protects us: granted balance can never be refunded,
 * so leaving it behind while spending purchased balance would let somebody
 * consume the free part and then withdraw the paid part in cash.
 *
 * All or nothing. A partial allocation would mean charging for part of an
 * operation that did not run.
 */
export function planSpend(
  lots: readonly CreditLot[],
  amount: Money,
  now: Date,
): SpendPlan {
  if (amount < 0) {
    return {
      ok: false,
      allocations: [],
      shortfall: ZERO,
      reason: "A spend cannot be negative. Use an adjustment to give balance back.",
    };
  }
  if (isZero(amount)) {
    return { ok: true, allocations: [], shortfall: ZERO, reason: "Nothing to charge." };
  }

  const spendable = lots
    .filter((lot) => isSpendable(lot, now))
    .sort((a, b) => {
      const byExpiry = a.expiresAt.localeCompare(b.expiresAt);
      if (byExpiry !== 0) return byExpiry;
      if (a.kind !== b.kind) return a.kind === "granted" ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const allocations: Allocation[] = [];
  let outstanding: number = amount;

  for (const lot of spendable) {
    if (outstanding <= 0) break;
    const take = Math.min(outstanding, lot.remaining);
    if (take <= 0) continue;
    allocations.push({ lotId: lot.id, amount: money(take) });
    outstanding -= take;
  }

  if (outstanding > 0) {
    return {
      ok: false,
      allocations: [],
      shortfall: money(outstanding),
      reason: `Short by £${(outstanding / 100).toFixed(2)}. Top up before running this.`,
    };
  }

  return { ok: true, allocations, shortfall: ZERO, reason: "Covered by the available balance." };
}

/* --------------------------------------------------------------- refunds */

export interface RefundQuote {
  /** Gross cash to return, including tax. */
  readonly gross: Money;
  /** The tax element, reclaimable from HMRC. */
  readonly tax: Money;
  /** Balance withdrawn from the lot in exchange. */
  readonly balanceWithdrawn: Money;
  readonly refundable: boolean;
  readonly reason: string;
}

/**
 * What may lawfully and safely be paid back for one lot.
 *
 * Proportional to what is left, computed from cash actually received, and
 * rounded **down**. Rounding a payout up gives away a penny per refund that
 * nothing ever recovers, and at volume a penny per refund is a real number.
 *
 * A granted lot refunds nothing. That is the whole point of it being a separate
 * lot: a bonus is a discount on usage, not a deposit.
 */
export function quoteRefund(lot: CreditLot, now: Date): RefundQuote {
  if (lot.kind === "granted") {
    return {
      gross: ZERO,
      tax: ZERO,
      balanceWithdrawn: ZERO,
      refundable: false,
      reason: "Granted balance was never paid for, so there is no cash to return.",
    };
  }
  if (lot.voidedAt !== undefined) {
    return {
      gross: ZERO,
      tax: ZERO,
      balanceWithdrawn: ZERO,
      refundable: false,
      reason: "This lot has already been refunded or charged back.",
    };
  }
  if (hasExpired(lot, now)) {
    return {
      gross: ZERO,
      tax: ZERO,
      balanceWithdrawn: ZERO,
      refundable: false,
      reason: "The balance expired. Expiry was disclosed at the point of sale.",
    };
  }
  if (lot.remaining <= 0 || lot.original <= 0) {
    return {
      gross: ZERO,
      tax: ZERO,
      balanceWithdrawn: ZERO,
      refundable: false,
      reason: "The balance has been spent. There is nothing left to return.",
    };
  }

  const proportion = lot.remaining / lot.original;
  const gross = money(Math.floor(lot.cashGross * proportion));
  const tax = money(Math.min(Math.floor(lot.cashTax * proportion), gross));

  return {
    gross,
    tax,
    balanceWithdrawn: lot.remaining,
    refundable: gross > 0,
    reason:
      gross > 0
        ? `£${(gross / 100).toFixed(2)} of £${(lot.cashGross / 100).toFixed(2)} remains unspent and may be returned.`
        : "The unspent proportion rounds to nothing.",
  };
}

/* --------------------------------------------------------------- expiry */

export interface Expiry {
  readonly lotId: string;
  readonly amount: Money;
  readonly expiredAt: string;
}

/**
 * Lots that have lapsed and the balance written off with them.
 *
 * Returned rather than applied, so the caller records it in the ledger inside
 * the same transaction that zeroes the lot. Expiring balance without an entry
 * would make it look like it had been spent.
 */
export function dueForExpiry(lots: readonly CreditLot[], now: Date): readonly Expiry[] {
  return lots
    .filter((lot) => lot.voidedAt === undefined && lot.remaining > 0 && hasExpired(lot, now))
    .map((lot) => ({ lotId: lot.id, amount: lot.remaining, expiredAt: lot.expiresAt }));
}

/** Add months to an ISO timestamp, for setting a lot's expiry at creation. */
export function expiryFrom(iso: string, months: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Cannot compute an expiry from ${iso}`);
  }
  const expiry = new Date(date);
  expiry.setMonth(expiry.getMonth() + months);
  return expiry.toISOString();
}
