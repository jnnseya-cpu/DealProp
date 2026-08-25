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
  | "adjustment";

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
  readonly owed: Money;
  /** False while anything is owed: no further spending until it is settled. */
  readonly maySpend: boolean;
  readonly reason: string;
}

export function standing(
  lots: readonly CreditLot[],
  entries: readonly LedgerEntry[],
  now: Date,
): Standing {
  const available = availableBalance(lots, now);

  // What was clawed back beyond what was still sitting unspent. A chargeback
  // for £100 against a lot with £30 left costs us the £70 already consumed.
  let owed = ZERO;
  for (const entry of entries) {
    if (entry.kind !== "chargeback") continue;
    owed = add(owed, money(Math.abs(entry.amount)));
  }
  for (const lot of lots) {
    if (lot.voidedAt === undefined) continue;
    if (lot.voidedReason !== "chargeback") continue;
    // The unspent part was recovered by voiding the lot, so only the consumed
    // part is a real loss.
    owed = sub(owed, lot.remaining);
  }
  if (owed < 0) owed = ZERO;

  if (owed > 0) {
    return {
      available,
      owed,
      maySpend: false,
      reason: `A payment was reversed after the balance was spent. £${(owed / 100).toFixed(2)} is outstanding and spending is suspended until it is settled.`,
    };
  }

  return {
    available,
    owed: ZERO,
    maySpend: true,
    reason:
      available > 0
        ? `£${(available / 100).toFixed(2)} available.`
        : "No prepaid balance. Top up to run metered operations.",
  };
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
