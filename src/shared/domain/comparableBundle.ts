import { money, scale, type Money } from "@shared/money";
import type { SourceAttribution } from "@shared/domain/sources";
import {
  selectComparables,
  type Comparable,
  type ComparableSelection,
  type ComparableSubject,
  type ComparableType,
  type ValuationRange,
} from "@shared/domain/comparables";

/**
 * The Deal Hunt comparable-evidence bundle (Deal Hunt spec §4).
 *
 * A shortlisted deal is shown with the evidence around it: completed sales near
 * the subject, and rents. This assembles both into one bundle, under a pinned
 * policy version, keeping three rules the spec is emphatic about:
 *
 *  - **Sold and rent are different questions and never averaged together.** Sold
 *    evidence reuses the surveyor-style selector in `comparables.ts` (0.5mi/12mo,
 *    widen once to 1mi/24mo, fewer than three is thin). Rent is computed here.
 *  - **Advertised rent and agreed rent are different evidence and never combined
 *    into one estimate.** An asking rent is what a landlord hopes for; an agreed
 *    rent is what a tenant paid. They are ranged and counted separately, and if
 *    only adverts exist the output is explicitly an *advertised* range (DH10).
 *  - **Missing evidence stays missing.** No licensed rental feed → `unavailable`
 *    (rent_unavailable), never a fabricated range. Fewer than three in a group →
 *    `thin`. Freshness and coverage travel with the bundle.
 *
 * Pure and framework-free, like `comparables.ts`: the backend adapter maps a
 * licensed source into {@link Comparable}/{@link RentalComparable}, this reads
 * the ranges, and nothing here invents an after-works value or an achievable
 * rent — those are reviewer judgements that belong in the appraisal.
 */

export const COMPARABLE_POLICY_VERSION = "comparable-policy-1";

/** Reviewable rental heuristics (spec §4) — tighter windows than sales. */
export const RENTAL_RULES = {
  tightRadiusMiles: 0.5,
  wideRadiusMiles: 1,
  tightAgeDays: 90,
  wideAgeDays: 180,
  /** Below this a group is thin evidence. */
  minDefensible: 3,
} as const;

export type RentalBasis = "advertised" | "agreed";
export type RentPeriod = "weekly" | "monthly" | "annual";

/** One rental record, as evidence. The original record — never mutated. */
export interface RentalComparable {
  readonly id: string;
  readonly address: string;
  readonly postcode: string;
  /** The rent exactly as recorded, in pence, over {@link period}. */
  readonly amountPence: Money;
  readonly period: RentPeriod;
  /** Advertised (asking) or an agreed, let rent. Never mixed. */
  readonly basis: RentalBasis;
  readonly type: ComparableType;
  readonly bedrooms?: number;
  readonly distanceMiles: number;
  /** ISO-8601 date the rent was observed. */
  readonly observedDate: string;
  /** Excluded: a room in a shared house is not a whole-property let. */
  readonly roomLet?: boolean;
  /** Excluded: a holiday/short-stay let is a different market. */
  readonly shortStay?: boolean;
  readonly source: SourceAttribution;
}

export interface RentalSubject {
  readonly acceptableTypes: readonly ComparableType[];
  readonly bedrooms?: number;
}

export interface SelectedRental {
  readonly comparable: RentalComparable;
  /** The rent normalised to GBP pence per month. */
  readonly monthlyPence: Money;
  readonly reason: string;
}

export interface RentalGroup {
  readonly basis: RentalBasis;
  readonly count: number;
  readonly thin: boolean;
  readonly widened: boolean;
  /** Monthly pence. Absent when the group is empty. */
  readonly range?: ValuationRange;
  readonly used: readonly SelectedRental[];
  readonly reason: string;
}

export interface RentalEvidence {
  /** No licensed rental feed at all — distinct from a feed that returned nothing. */
  readonly unavailable: boolean;
  readonly advertised?: RentalGroup;
  readonly agreed?: RentalGroup;
  readonly asOf: string;
}

export interface ComparableCoverage {
  readonly soldCount: number;
  readonly soldThin: boolean;
  readonly advertisedRentCount: number;
  readonly agreedRentCount: number;
  readonly rentUnavailable: boolean;
}

export interface ComparableBundle {
  readonly policyVersion: string;
  readonly asOf: string;
  readonly sold: ComparableSelection;
  readonly rental: RentalEvidence;
  readonly coverage: ComparableCoverage;
}

/** Normalise any period's rent to GBP pence per month. */
export function toMonthlyPence(amountPence: Money, period: RentPeriod): Money {
  if (period === "monthly") return amountPence;
  // Annual ÷ 12; weekly × 52 ÷ 12. Rounded to the penny for display only.
  if (period === "annual") return money(Math.round(Number(amountPence) / 12));
  return scale(amountPence, 52 / 12);
}

function daysBetween(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

function normaliseAddress(a: string): string {
  return a.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Mirrors the private percentile in `comparables.ts`. Kept local rather than
 * exported from there so the stable, tested sold-comparable engine is not
 * touched to serve the rental one.
 */
function percentile(sorted: readonly Money[], p: number): Money {
  if (sorted.length === 0) return money(0);
  if (sorted.length === 1) return sorted[0] as Money;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const low = sorted[lo] as number;
  if (lo === hi) return money(low);
  const high = sorted[hi] as number;
  return money(Math.round(low + (high - low) * (idx - lo)));
}

function selectRentalGroup(
  basis: RentalBasis,
  subject: RentalSubject,
  candidates: readonly RentalComparable[],
  now: Date,
): RentalGroup {
  const r = RENTAL_RULES;

  // Deduplicate relisted adverts of the same address, keeping the most recent.
  const byAddress = new Map<string, RentalComparable>();
  for (const c of candidates) {
    const key = normaliseAddress(c.address);
    const held = byAddress.get(key);
    if (held === undefined || c.observedDate > held.observedDate) byAddress.set(key, c);
  }
  const unique = [...byAddress.values()];

  const disqualified = (c: RentalComparable): boolean => {
    if (c.roomLet === true || c.shortStay === true) return true;
    if (subject.acceptableTypes.length > 0 && !subject.acceptableTypes.includes(c.type)) return true;
    if (subject.bedrooms !== undefined && c.bedrooms !== undefined && c.bedrooms !== subject.bedrooms) return true;
    return false;
  };

  const passesAt = (radius: number, maxAgeDays: number): RentalComparable[] =>
    unique.filter(
      (c) => !disqualified(c) && c.distanceMiles <= radius && daysBetween(c.observedDate, now) <= maxAgeDays,
    );

  const tight = passesAt(r.tightRadiusMiles, r.tightAgeDays);
  let chosen = tight;
  let radius: number = r.tightRadiusMiles;
  let maxAgeDays: number = r.tightAgeDays;
  let widened = false;
  if (tight.length < r.minDefensible) {
    const wide = passesAt(r.wideRadiusMiles, r.wideAgeDays);
    if (wide.length > tight.length) {
      chosen = wide;
      radius = r.wideRadiusMiles;
      maxAgeDays = r.wideAgeDays;
      widened = true;
    }
  }

  const used: SelectedRental[] = chosen
    .slice()
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .map((c) => ({
      comparable: c,
      monthlyPence: toMonthlyPence(c.amountPence, c.period),
      reason: `${c.distanceMiles.toFixed(2)} miles away, observed ${daysBetween(c.observedDate, now)} days ago${c.bedrooms !== undefined ? `, ${c.bedrooms} bed` : ""}.`,
    }));

  const monthly = used.map((u) => u.monthlyPence).slice().sort((a, b) => a - b);
  const range: ValuationRange | undefined =
    monthly.length === 0
      ? undefined
      : { low: percentile(monthly, 0.25), mid: percentile(monthly, 0.5), high: percentile(monthly, 0.75) };

  const label = basis === "advertised" ? "advertised" : "agreed";
  const thin = used.length < r.minDefensible;
  const reason =
    used.length === 0
      ? `No ${label} rents found${widened ? ", even widened to a mile and 180 days" : ""}.`
      : thin
        ? `Only ${used.length} ${label} rent${used.length === 1 ? "" : "s"} — thin evidence${widened ? ", after widening the search" : ""}.`
        : `${used.length} ${label} rents within ${radius} miles and ${maxAgeDays} days${widened ? ", after widening the search" : ""}.`;

  return { basis, count: used.length, thin, widened, used, reason, ...(range !== undefined ? { range } : {}) };
}

/**
 * Select rental evidence, advertised and agreed kept entirely separate.
 *
 * `candidates === null` means no licensed rental feed is configured for this
 * area — rent_unavailable — which is not the same as a feed returning nothing.
 */
export function selectRentalComparables(
  subject: RentalSubject,
  candidates: readonly RentalComparable[] | null,
  opts: { readonly now?: Date } = {},
): RentalEvidence {
  const now = opts.now ?? new Date();
  const asOf = now.toISOString().slice(0, 10);
  if (candidates === null) return { unavailable: true, asOf };

  const advertised = selectRentalGroup("advertised", subject, candidates.filter((c) => c.basis === "advertised"), now);
  const agreed = selectRentalGroup("agreed", subject, candidates.filter((c) => c.basis === "agreed"), now);
  return { unavailable: false, advertised, agreed, asOf };
}

/**
 * Assemble the full comparable bundle for one subject property: sold evidence
 * (via the existing selector) and rental evidence, under a pinned policy
 * version, with coverage and freshness that travel with it.
 */
export function buildComparableBundle(
  sold: { subject: ComparableSubject; candidates: readonly Comparable[] },
  rental: { subject: RentalSubject; candidates: readonly RentalComparable[] | null },
  opts: { readonly now?: Date } = {},
): ComparableBundle {
  const now = opts.now ?? new Date();
  const asOf = now.toISOString().slice(0, 10);

  const soldSelection = selectComparables(sold.subject, sold.candidates, { now });
  const rentalEvidence = selectRentalComparables(rental.subject, rental.candidates, { now });

  const coverage: ComparableCoverage = {
    soldCount: soldSelection.used.length,
    soldThin: soldSelection.used.length < 3,
    advertisedRentCount: rentalEvidence.advertised?.count ?? 0,
    agreedRentCount: rentalEvidence.agreed?.count ?? 0,
    rentUnavailable: rentalEvidence.unavailable,
  };

  return { policyVersion: COMPARABLE_POLICY_VERSION, asOf, sold: soldSelection, rental: rentalEvidence, coverage };
}
