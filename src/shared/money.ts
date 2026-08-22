/**
 * Money is represented as an integer number of minor units (pence, cents).
 *
 * Every figure that reaches a lender, a seller or a legal document passes
 * through here. Floating point is never used for a monetary quantity: at the
 * scale of a property transaction a half-penny drift compounds into visible
 * disagreement between the deal model, the memorandum and the completion
 * statement, and "the numbers don't tie" destroys credibility faster than a
 * bad deal does.
 */

export type Money = number & { readonly __brand: "Money" };

/** Basis points. 10_000 bps = 100%. Rates are integers for the same reason. */
export type Bps = number & { readonly __brand: "Bps" };

export function money(minorUnits: number): Money {
  if (!Number.isFinite(minorUnits)) {
    throw new RangeError(`Money must be finite, received ${minorUnits}`);
  }
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(
      `Money must be a safe integer number of minor units, received ${minorUnits}`,
    );
  }
  return minorUnits as Money;
}

export const ZERO = money(0);

/** Construct from a major-unit amount, e.g. fromMajor(280_000) === £280,000. */
export function fromMajor(majorUnits: number): Money {
  return money(Math.round(majorUnits * 100));
}

export function toMajor(value: Money): number {
  return value / 100;
}

export function bps(value: number): Bps {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Bps must be finite, received ${value}`);
  }
  return Math.round(value) as Bps;
}

/** Construct basis points from a percentage, e.g. pct(5.5) === 550 bps. */
export function pct(percent: number): Bps {
  return bps(percent * 100);
}

export function add(...values: Money[]): Money {
  return money(values.reduce<number>((total, v) => total + v, 0));
}

export function sub(a: Money, b: Money): Money {
  return money(a - b);
}

export function neg(a: Money): Money {
  return money(-a);
}

export function abs(a: Money): Money {
  return money(Math.abs(a));
}

export function max(...values: Money[]): Money {
  if (values.length === 0) throw new RangeError("max requires a value");
  return money(Math.max(...values));
}

export function min(...values: Money[]): Money {
  if (values.length === 0) throw new RangeError("min requires a value");
  return money(Math.min(...values));
}

/**
 * Multiply by a rate in basis points, rounding half away from zero.
 *
 * Rounding is symmetric about zero so that applying a rate to a credit and to
 * the equivalent debit produces amounts of equal magnitude.
 */
export function applyBps(value: Money, rate: Bps): Money {
  const raw = (value * rate) / 10_000;
  return money(roundHalfAwayFromZero(raw));
}

/** Multiply by a plain factor (e.g. 1.1 for a 10% uplift stress). */
export function scale(value: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Scale factor must be finite, received ${factor}`);
  }
  return money(roundHalfAwayFromZero(value * factor));
}

/** Pro-rate an annual amount over a number of whole months. */
export function perMonths(annualValue: Money, months: number): Money {
  if (!Number.isFinite(months) || months < 0) {
    throw new RangeError(`Months must be a non-negative number, got ${months}`);
  }
  return money(roundHalfAwayFromZero((annualValue * months) / 12));
}

/**
 * Ratio of two amounts in basis points. A zero denominator yields 0 rather
 * than Infinity: callers render this straight to a UI, and "0%" with an
 * accompanying absence of a denominator is safer than "Infinity%".
 */
export function ratioBps(numerator: Money, denominator: Money): Bps {
  if (denominator === 0) return bps(0);
  return bps(roundHalfAwayFromZero((numerator / denominator) * 10_000));
}

export function isZero(value: Money): boolean {
  return value === 0;
}

export function isNegative(value: Money): boolean {
  return value < 0;
}

function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
