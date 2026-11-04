import { money, scale, ZERO, type Money } from "@shared/money";
import type { SourceAttribution } from "@shared/domain/sources";

/**
 * Comparable-evidence valuation (spec §7).
 *
 * A value is not a number somebody typed — it is a position argued from sales
 * that actually happened. This engine takes candidate sales (each already
 * carrying the distance from the subject and its provenance) and does what a
 * surveyor does on paper: keep the ones that are genuinely comparable, say in
 * writing why each other one was set aside, and read a RANGE off what is left
 * rather than a single confident figure. Fewer than three defensible
 * comparables is not a weak valuation, it is not a valuation — it returns low
 * confidence and demands review.
 *
 * Pure and framework-free. It knows nothing about where the sales came from:
 * the backend adapter maps HM Land Registry Price Paid records (and a postcode
 * centroid for the distance) into {@link Comparable}, and a reviewer approves
 * the range this produces. The original sale price and any adjustment are kept
 * separately, because an adjustment is an argument and must be visible as one.
 *
 * It deliberately does NOT invent an after-works value: that is a reviewer's
 * judgement about work that has not happened, not something comparable sales
 * can establish. This produces the as-is range only.
 */

/** The categories Price Paid Data distinguishes, normalised. */
export type ComparableType = "detached" | "semi-detached" | "terraced" | "flat" | "other";

export type ComparableTenure = "freehold" | "leasehold" | "unknown";

/** One registered sale, as evidence. The original record — never mutated. */
export interface Comparable {
  readonly id: string;
  readonly address: string;
  readonly postcode: string;
  /** The registered sale price, exactly as recorded. */
  readonly soldPrice: Money;
  /** ISO-8601 date of transfer. */
  readonly soldDate: string;
  readonly type: ComparableType;
  readonly tenure: ComparableTenure;
  /** Internal floor area in square metres, where a source records it. */
  readonly floorAreaSqm?: number;
  /** Straight-line miles from the subject, computed by the adapter. */
  readonly distanceMiles: number;
  /** False for repossessions, portfolio and related-party transfers. */
  readonly armsLength: boolean;
  /** Flagged by the adapter where a transaction is otherwise unusual. */
  readonly unusual?: boolean;
  readonly source: SourceAttribution;
}

/** What is being valued. */
export interface ComparableSubject {
  /**
   * The categories a comparable may be. A generic "house" accepts detached,
   * semi and terraced; a flat accepts only flat. Empty means the subject's own
   * type is unknown, which the engine treats as a reason for review.
   */
  readonly acceptableTypes: readonly ComparableType[];
  readonly tenure: ComparableTenure;
  readonly floorAreaSqm?: number;
}

export interface ValuationRange {
  readonly low: Money;
  readonly mid: Money;
  readonly high: Money;
}

export interface SelectedComparable {
  readonly comparable: Comparable;
  /** The sale price after any size adjustment. Equal to soldPrice when none. */
  readonly adjustedValue: Money;
  /** The adjustment as an argument, kept separate from the original price. */
  readonly adjustmentNote: string;
  /** Why this sale was kept. */
  readonly reason: string;
}

export interface RejectedComparable {
  readonly comparable: Comparable;
  /** Why this sale was set aside — recorded, never silent. */
  readonly reason: string;
}

export type ComparableConfidence = "high" | "medium" | "low";

export interface ComparableSelection {
  readonly used: readonly SelectedComparable[];
  readonly rejected: readonly RejectedComparable[];
  /** True where the tight band found too few and the search was widened. */
  readonly widened: boolean;
  readonly confidence: ComparableConfidence;
  /** True where a human must approve before this value is relied on. */
  readonly requiresReview: boolean;
  readonly reason: string;
  /** The as-is range, where there is at least one defensible comparable. */
  readonly asIs?: ValuationRange;
  /** When the selection was computed — stale evidence is not evidence. */
  readonly asOf: string;
}

/** Reviewable heuristics, not universal valuation law (spec §7). */
export const COMPARABLE_RULES = {
  tightRadiusMiles: 0.5,
  wideRadiusMiles: 1,
  tightAgeMonths: 12,
  wideAgeMonths: 24,
  /** Below this, it is not a valuation. */
  minDefensible: 3,
} as const;

function monthsBetween(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY;
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

function normaliseAddress(a: string): string {
  return a.trim().toLowerCase().replace(/\s+/g, " ");
}

function percentile(sorted: readonly Money[], p: number): Money {
  if (sorted.length === 0) return ZERO;
  if (sorted.length === 1) return sorted[0] as Money;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const low = sorted[lo] as number;
  if (lo === hi) return money(low);
  const high = sorted[hi] as number;
  return money(Math.round(low + (high - low) * (idx - lo)));
}

/**
 * Select the defensible comparables, with a reason for every inclusion and
 * every rejection, and read an as-is range off them.
 *
 * The search starts tight (same type, 0.5 miles, 12 months) and widens once to
 * 1 mile / 24 months only if the tight band cannot find three. Widening is
 * recorded and costs a confidence grade, because a value argued from sales a
 * year older and twice as far away is a weaker argument and must present as one.
 */
export function selectComparables(
  subject: ComparableSubject,
  candidates: readonly Comparable[],
  opts: { readonly now?: Date } = {},
): ComparableSelection {
  const now = opts.now ?? new Date();
  const asOf = now.toISOString().slice(0, 10);
  const r = COMPARABLE_RULES;

  // De-duplicate by address, keeping the most recent sale. An earlier sale of
  // the same home is not a second data point.
  const byAddress = new Map<string, Comparable>();
  const dupes: Comparable[] = [];
  for (const c of candidates) {
    const key = normaliseAddress(c.address);
    const held = byAddress.get(key);
    if (held === undefined) {
      byAddress.set(key, c);
    } else if (c.soldDate > held.soldDate) {
      byAddress.set(key, c);
      dupes.push(held);
    } else {
      dupes.push(c);
    }
  }
  const unique = [...byAddress.values()];

  // Why a candidate fails at a given band, or undefined if it passes.
  const failure = (c: Comparable, radius: number, maxAge: number): string | undefined => {
    if (subject.acceptableTypes.length === 0) {
      return "The subject's own property type is unknown, so comparability cannot be established.";
    }
    if (!subject.acceptableTypes.includes(c.type)) {
      return `A ${c.type} is not comparable to the subject's type.`;
    }
    if (!c.armsLength) {
      return "Not an open-market sale (repossession, portfolio or related-party transfer).";
    }
    if (c.unusual === true) {
      return "Flagged as an unusual transaction.";
    }
    if (subject.tenure !== "unknown" && c.tenure !== "unknown" && c.tenure !== subject.tenure) {
      return `Tenure ${c.tenure} does not match the subject's ${subject.tenure}.`;
    }
    if (subject.tenure !== "unknown" && c.tenure === "unknown") {
      return "Tenure not recorded, so comparability cannot be established.";
    }
    const age = monthsBetween(c.soldDate, now);
    if (c.distanceMiles > radius) return `${c.distanceMiles.toFixed(2)} miles away, beyond the ${radius}-mile band.`;
    if (age > maxAge) return `Sold ${age} months ago, beyond the ${maxAge}-month band.`;
    return undefined;
  };

  const passesAt = (radius: number, maxAge: number): Comparable[] =>
    unique.filter((c) => failure(c, radius, maxAge) === undefined);

  const tight = passesAt(r.tightRadiusMiles, r.tightAgeMonths);
  let chosen = tight;
  let radius: number = r.tightRadiusMiles;
  let maxAge: number = r.tightAgeMonths;
  let widened = false;
  if (tight.length < r.minDefensible) {
    const wide = passesAt(r.wideRadiusMiles, r.wideAgeMonths);
    if (wide.length > tight.length) {
      chosen = wide;
      radius = r.wideRadiusMiles;
      maxAge = r.wideAgeMonths;
      widened = true;
    }
  }

  const chosenIds = new Set(chosen.map((c) => c.id));

  const used: SelectedComparable[] = chosen
    .slice()
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .map((c) => {
      const canAdjust =
        subject.floorAreaSqm !== undefined &&
        subject.floorAreaSqm > 0 &&
        c.floorAreaSqm !== undefined &&
        c.floorAreaSqm > 0;
      const adjustedValue = canAdjust
        ? scale(c.soldPrice, (subject.floorAreaSqm as number) / (c.floorAreaSqm as number))
        : c.soldPrice;
      const adjustmentNote = canAdjust
        ? `Size-adjusted from ${c.floorAreaSqm}m² to the subject's ${subject.floorAreaSqm}m².`
        : "No size adjustment — floor area not recorded for one side.";
      return {
        comparable: c,
        adjustedValue,
        adjustmentNote,
        reason: `${c.distanceMiles.toFixed(2)} miles away, sold ${monthsBetween(c.soldDate, now)} months ago, ${c.type}.`,
      };
    });

  const rejected: RejectedComparable[] = [
    ...dupes.map((c) => ({ comparable: c, reason: "A more recent sale of the same address is used instead." })),
    ...unique
      .filter((c) => !chosenIds.has(c.id))
      .map((c) => ({
        comparable: c,
        reason: failure(c, radius, maxAge) ?? "Not among the defensible set.",
      })),
  ];

  const values = used.map((u) => u.adjustedValue).slice().sort((a, b) => a - b);
  const asIs: ValuationRange | undefined =
    values.length === 0
      ? undefined
      : { low: percentile(values, 0.25), mid: percentile(values, 0.5), high: percentile(values, 0.75) };

  const unknownType = subject.acceptableTypes.length === 0;
  const enough = used.length >= r.minDefensible;
  const requiresReview = !enough || unknownType;

  let confidence: ComparableConfidence;
  if (unknownType || used.length < r.minDefensible) {
    confidence = "low";
  } else if (widened) {
    confidence = "medium";
  } else {
    confidence = used.length >= 5 ? "high" : "medium";
  }

  const reason = unknownType
    ? "The subject's own property type is unknown, so no comparable is defensible. A reviewer must establish it."
    : used.length === 0
      ? "No defensible comparable sales were found, even widened to a mile and two years. This is not a valuation."
      : used.length < r.minDefensible
        ? `Only ${used.length} defensible comparable${used.length === 1 ? "" : "s"} — fewer than the ${r.minDefensible} a valuation needs. Low confidence, and a reviewer must approve before it is relied on.`
        : `${used.length} defensible comparables within ${radius} miles and ${maxAge} months${widened ? ", after widening the search" : ""}.`;

  return { used, rejected, widened, confidence, requiresReview, reason, ...(asIs !== undefined ? { asIs } : {}), asOf };
}
