import { pct, type Bps, type Money } from "@/lib/money";
import type {
  DealAppraisal,
  JurisdictionCode,
  PropertyType,
  StructureKind,
} from "@/domain/types";
import type { DealScoreResult } from "@/domain/dealScore";

/**
 * Buy Box and Funding Box matching.
 *
 * Matching is explainable by construction: every match returns the criteria it
 * met and the criteria it missed. A percentage with no reasons behind it is
 * not something a lender can underwrite against, and "92% match" that turns
 * out to breach a hard mandate limit destroys the platform's credibility with
 * the exact users who are hardest to acquire.
 *
 * Hard criteria (jurisdiction, ticket size, LTV ceiling, charge position) are
 * pass/fail. Soft criteria (yield, margin, location preference) are scored.
 */

export interface BuyBox {
  readonly id: string;
  readonly investorName: string;
  readonly jurisdictions: readonly JurisdictionCode[];
  readonly localities: readonly string[];
  readonly propertyTypes: readonly PropertyType[];
  readonly minPrice: Money;
  readonly maxPrice: Money;
  readonly minBedrooms: number;
  /** Minimum acceptable margin on GDV, basis points. */
  readonly minMarginBps: Bps;
  readonly maxRefurbishment: Money;
  readonly acceptsRefurbishment: boolean;
  /** Minimum gross yield for income strategies, basis points. */
  readonly minYieldBps: Bps;
  readonly maxCompletionDays: number;
  readonly acceptableStructures: readonly StructureKind[];
  /** Deals scoring below this are not shown at all. */
  readonly minDealScore: number;
  readonly active: boolean;
}

export type FunderKind =
  | "bridging-lender"
  | "private-lender"
  | "family-office"
  | "debt-fund"
  | "jv-equity-partner"
  | "development-lender";

export interface FundingBox {
  readonly id: string;
  readonly funderName: string;
  readonly kind: FunderKind;
  readonly jurisdictions: readonly JurisdictionCode[];
  readonly localities: readonly string[];
  readonly capitalAvailable: Money;
  readonly minTicket: Money;
  readonly maxTicket: Money;
  readonly propertyTypes: readonly PropertyType[];
  /** Maximum loan to value the funder will advance, basis points. */
  readonly maxLtvBps: Bps;
  readonly minTermMonths: number;
  readonly maxTermMonths: number;
  readonly acceptsRefurbishment: boolean;
  readonly acceptsDevelopment: boolean;
  readonly requiresFirstCharge: boolean;
  readonly minBorrowerCompletedDeals: number;
  /** Required annual return, basis points. Equity partners use profit share. */
  readonly requiredReturnBps: Bps;
  readonly personalGuaranteeRequired: boolean;
  readonly active: boolean;
}

export interface MatchCriterion {
  readonly label: string;
  readonly met: boolean;
  readonly hard: boolean;
  readonly detail: string;
}

export interface MatchResult<T> {
  readonly target: T;
  /** 0-100. Zero whenever any hard criterion fails. */
  readonly score: number;
  readonly eligible: boolean;
  readonly criteria: readonly MatchCriterion[];
  readonly blockers: readonly string[];
}

interface Evaluator {
  hard(label: string, met: boolean, detail: string): void;
  soft(label: string, met: boolean, detail: string, weight?: number): void;
}

function evaluator(): {
  api: Evaluator;
  result(): { score: number; eligible: boolean; criteria: MatchCriterion[]; blockers: string[] };
} {
  const criteria: MatchCriterion[] = [];
  const blockers: string[] = [];
  let softTotal = 0;
  let softMet = 0;

  const api: Evaluator = {
    hard(label, met, detail) {
      criteria.push({ label, met, hard: true, detail });
      if (!met) blockers.push(`${label}: ${detail}`);
    },
    soft(label, met, detail, weight = 1) {
      criteria.push({ label, met, hard: false, detail });
      softTotal += weight;
      if (met) softMet += weight;
    },
  };

  return {
    api,
    result() {
      const eligible = blockers.length === 0;
      // Soft criteria fill the range above a 55 floor, so an eligible deal
      // that meets no preferences still reads as a weak-but-real match rather
      // than a zero.
      const score = eligible
        ? Math.round(55 + (softTotal === 0 ? 45 : (softMet / softTotal) * 45))
        : 0;
      return { score, eligible, criteria, blockers };
    },
  };
}

export function matchBuyBox(
  box: BuyBox,
  scored: DealScoreResult,
): MatchResult<BuyBox> {
  const { api, result } = evaluator();
  const a = scored.appraisal;
  const p = a.inputs.property;

  api.hard(
    "Jurisdiction",
    box.jurisdictions.includes(p.jurisdiction),
    `Deal is in ${p.jurisdiction}; mandate covers ${box.jurisdictions.join(", ")}.`,
  );
  api.hard(
    "Property type",
    box.propertyTypes.includes(p.propertyType),
    `Deal is a ${p.propertyType}; mandate accepts ${box.propertyTypes.join(", ")}.`,
  );
  api.hard(
    "Price range",
    a.inputs.purchasePrice >= box.minPrice && a.inputs.purchasePrice <= box.maxPrice,
    `Price ${fmt(a.inputs.purchasePrice)} against a range of ${fmt(box.minPrice)}–${fmt(box.maxPrice)}.`,
  );
  api.hard(
    "Minimum margin",
    a.marginOnGdvBps >= box.minMarginBps,
    `Deal margin ${(a.marginOnGdvBps / 100).toFixed(1)}% against a requirement of ${(box.minMarginBps / 100).toFixed(1)}%.`,
  );
  api.hard(
    "Deal score floor",
    scored.breakdown.composite >= box.minDealScore,
    `Deal scores ${scored.breakdown.composite} against a floor of ${box.minDealScore}.`,
  );
  api.hard(
    "Structure acceptable",
    box.acceptableStructures.includes(a.inputs.structure),
    `Deal uses ${a.inputs.structure}; mandate accepts ${box.acceptableStructures.join(", ")}.`,
  );
  api.hard(
    "Refurbishment budget",
    box.acceptsRefurbishment
      ? p.refurbishmentEstimate <= box.maxRefurbishment
      : p.refurbishmentEstimate === 0,
    box.acceptsRefurbishment
      ? `Works of ${fmt(p.refurbishmentEstimate)} against a ceiling of ${fmt(box.maxRefurbishment)}.`
      : "Mandate does not accept refurbishment projects.",
  );

  // Protection blocks are absolute: a blocked deal is never matched to anyone.
  api.hard(
    "Seller protection cleared",
    !scored.protection.blocked,
    "Deal is blocked by the Seller Protection Engine pending human review.",
  );

  api.soft(
    "Preferred locality",
    box.localities.length === 0 || box.localities.includes(p.locality),
    `Deal is in ${p.locality}.`,
    2,
  );
  api.soft(
    "Bedrooms",
    p.bedrooms >= box.minBedrooms,
    `${p.bedrooms} bedrooms against a preference for ${box.minBedrooms}+.`,
  );
  const yieldBps = a.costs.total > 0 ? Math.round(((p.monthlyRent * 12) / a.costs.total) * 10_000) : 0;
  api.soft(
    "Yield preference",
    yieldBps >= box.minYieldBps,
    `Gross yield ${(yieldBps / 100).toFixed(1)}% against a preference for ${(box.minYieldBps / 100).toFixed(1)}%.`,
    2,
  );
  api.soft(
    "Completion speed",
    a.inputs.holdMonths * 30 <= box.maxCompletionDays * 6,
    `Hold period of ${a.inputs.holdMonths} months.`,
  );
  api.soft(
    "Survives stress testing",
    scored.redTeam.singleFactorLosses.length === 0,
    scored.redTeam.summary,
    3,
  );

  const r = result();
  return { target: box, ...r };
}

export function matchFundingBox(
  box: FundingBox,
  scored: DealScoreResult,
  borrowerCompletedDeals: number,
): MatchResult<FundingBox> {
  const { api, result } = evaluator();
  const a = scored.appraisal;
  const p = a.inputs.property;

  // The funder is being asked for the debt portion, so the ticket is the
  // senior facility, not the whole cost of the project.
  const ticket = a.funding.seniorDebt;
  const ltvBps = a.inputs.finance.ltvBps;

  api.hard(
    "Jurisdiction",
    box.jurisdictions.includes(p.jurisdiction),
    `Deal is in ${p.jurisdiction}; mandate covers ${box.jurisdictions.join(", ")}.`,
  );
  api.hard(
    "Ticket size",
    ticket >= box.minTicket && ticket <= box.maxTicket,
    `Facility of ${fmt(ticket)} against a range of ${fmt(box.minTicket)}–${fmt(box.maxTicket)}.`,
  );
  api.hard(
    "Capital available",
    ticket <= box.capitalAvailable,
    `Facility of ${fmt(ticket)} against ${fmt(box.capitalAvailable)} of available capital.`,
  );
  api.hard(
    "LTV ceiling",
    ltvBps <= box.maxLtvBps,
    `Deal is at ${(ltvBps / 100).toFixed(0)}% LTV against a ceiling of ${(box.maxLtvBps / 100).toFixed(0)}%.`,
  );
  api.hard(
    "Term",
    a.inputs.holdMonths >= box.minTermMonths && a.inputs.holdMonths <= box.maxTermMonths,
    `Term of ${a.inputs.holdMonths} months against ${box.minTermMonths}–${box.maxTermMonths} months.`,
  );
  api.hard(
    "Property type",
    box.propertyTypes.includes(p.propertyType),
    `Deal is a ${p.propertyType}; mandate accepts ${box.propertyTypes.join(", ")}.`,
  );
  api.hard(
    "Refurbishment appetite",
    box.acceptsRefurbishment || p.refurbishmentEstimate === 0,
    "Mandate does not lend against refurbishment projects.",
  );
  api.hard(
    "Borrower experience",
    borrowerCompletedDeals >= box.minBorrowerCompletedDeals,
    `Borrower has completed ${borrowerCompletedDeals} deals against a minimum of ${box.minBorrowerCompletedDeals}.`,
  );
  api.hard(
    "Seller protection cleared",
    !scored.protection.blocked,
    "Deal is blocked by the Seller Protection Engine pending human review.",
  );

  // A lender's real question is whether the exit repays them, not whether the
  // borrower makes money. Debt coverage against the finished value is
  // therefore a hard test.
  const coverageBps = a.exit.grossDevelopmentValue > 0
    ? Math.round((ticket / a.exit.grossDevelopmentValue) * 10_000)
    : 10_000;
  api.hard(
    "Exit covers the facility",
    coverageBps <= 7_500,
    `Facility is ${(coverageBps / 100).toFixed(0)}% of projected exit value.`,
  );

  api.soft(
    "Preferred locality",
    box.localities.length === 0 || box.localities.includes(p.locality),
    `Deal is in ${p.locality}.`,
    2,
  );
  api.soft(
    "Return meets target",
    a.inputs.finance.annualRateBps >= box.requiredReturnBps,
    `Deal pays ${(a.inputs.finance.annualRateBps / 100).toFixed(1)}% against a target of ${(box.requiredReturnBps / 100).toFixed(1)}%.`,
    3,
  );
  api.soft(
    "Survives stress testing",
    scored.redTeam.singleFactorLosses.length === 0,
    scored.redTeam.summary,
    3,
  );
  api.soft(
    "Deal quality",
    scored.breakdown.composite >= 70,
    `Deal scores ${scored.breakdown.composite}/100.`,
    2,
  );

  const r = result();
  return { target: box, ...r };
}

/** Rank matches, strongest first, dropping anything ineligible. */
export function rankMatches<T>(matches: readonly MatchResult<T>[]): readonly MatchResult<T>[] {
  return matches.filter((m) => m.eligible).sort((a, b) => b.score - a.score);
}

/**
 * Count of live buy boxes a property could satisfy, for the seller-facing
 * "buyers already exist" message.
 *
 * This counts genuine active mandates whose hard criteria the property meets.
 * It must never be inflated: the entire value of the claim is that it is true.
 */
export function countInterestedBuyers(
  boxes: readonly BuyBox[],
  scored: DealScoreResult,
): { total: number; fast: number } {
  const eligible = boxes.filter((b) => b.active).map((b) => matchBuyBox(b, scored)).filter((m) => m.eligible);
  return {
    total: eligible.length,
    fast: eligible.filter((m) => m.target.maxCompletionDays <= 28).length,
  };
}

export const DEFAULT_MIN_MARGIN: Bps = pct(15);

function fmt(value: Money): string {
  return `£${Math.round(value / 100).toLocaleString("en-GB")}`;
}
