import type { Bps, Money } from "@/lib/money";

/**
 * Formatting primitives.
 *
 * Pure and framework-free, so the domain layer can use them without importing
 * anything UI-shaped. Presentation concerns — colour, tone, Tailwind classes —
 * live in app/components/chrome.tsx, not here.
 *
 * This module exists because five separate modules had each grown their own
 * private `fmt()` that formatted pounds slightly differently. Money shown to a
 * seller in one place and a lender in another must be formatted identically or
 * the figures look like they disagree when they do not.
 */

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const GBP_PRECISE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money for display. Rounded to the pound: pence are noise at deal scale. */
export function gbp(value: Money): string {
  return GBP.format(value / 100);
}

/** Money to the penny, for completion statements and reconciliation. */
export function gbpPrecise(value: Money): string {
  return GBP_PRECISE.format(value / 100);
}

/** Signed money, so a loss never reads as a gain at a glance. */
export function gbpSigned(value: Money): string {
  return value >= 0 ? gbp(value) : `−${GBP.format(Math.abs(value) / 100)}`;
}

export function percent(value: Bps, decimals = 1): string {
  return `${(value / 100).toFixed(decimals)}%`;
}

export function score(value: number): string {
  return `${Math.round(value)}/100`;
}

export function days(value: number): string {
  return `${value} day${value === 1 ? "" : "s"}`;
}

export function months(value: number): string {
  return `${value} month${value === 1 ? "" : "s"}`;
}

/** Pluralise a count with its noun: `count(1, "buyer")` → "1 buyer". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function titleCase(value: string): string {
  return value
    .split("-")
    .map((w) => (w.length === 0 ? w : `${w[0]?.toUpperCase() ?? ""}${w.slice(1)}`))
    .join(" ");
}
