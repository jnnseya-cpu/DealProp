import type { Bps, Money } from "@/lib/money";

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

/** Tailwind colour class for a 0-100 score. */
export function scoreTone(value: number): string {
  if (value >= 78) return "text-emerald-600 dark:text-emerald-400";
  if (value >= 60) return "text-amber-600 dark:text-amber-400";
  if (value >= 40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

export function scoreBg(value: number): string {
  if (value >= 78) return "bg-emerald-500";
  if (value >= 60) return "bg-amber-500";
  if (value >= 40) return "bg-orange-500";
  return "bg-red-500";
}

export function titleCase(value: string): string {
  return value
    .split("-")
    .map((w) => (w.length === 0 ? w : `${w[0]?.toUpperCase() ?? ""}${w.slice(1)}`))
    .join(" ");
}
