import { applyBps, bps, money, pct, ratioBps, sub, type Money } from "@/lib/money";
import { gbp } from "@/lib/format";
import type {
  JurisdictionCode,
  PropertyFacts,
  PropertyIssue,
  PropertyType,
  SellerProfile,
  SellerPriority,
  SellerSituation,
  Tenure,
} from "@/domain/types";

/**
 * Seller intake.
 *
 * Converts what a seller can actually tell you into what the engine needs.
 * A seller knows their situation, roughly what the house is worth and what is
 * wrong with it. They do not know post-works value, achievable rent, or a
 * refurbishment budget, and asking them to guess produces confident numbers
 * with nothing behind them.
 *
 * So this module derives what it can, states its confidence, and marks
 * everything unverified. The Truth Engine checks below exist because the
 * single most common failure in this business is building a deal on a seller's
 * optimistic valuation and discovering the truth at survey.
 */

export interface IntakeAnswers {
  readonly situation: SellerSituation;
  readonly priorities: readonly SellerPriority[];
  readonly narrative: string;
  readonly postcodeArea: string;
  readonly locality: string;
  readonly jurisdiction: JurisdictionCode;
  readonly propertyType: PropertyType;
  readonly tenure: Tenure;
  readonly bedrooms: number;
  readonly occupancy: PropertyFacts["occupancy"];
  readonly leaseYearsRemaining?: number;
  readonly knownIssues: readonly PropertyIssue[];
  /** The seller's own estimate of value. Treated as a claim, not a fact. */
  readonly sellerValuation: Money;
  /** What an agent has it listed at, if it is on the market. */
  readonly currentAsking?: Money;
  /** Condition, which drives the works estimate the seller cannot give. */
  readonly condition: PropertyCondition;
  readonly targetDays?: number;
  readonly priceExpectation?: Money;
  readonly screening: SellerProfile["screening"];
}

export type PropertyCondition =
  | "ready"
  | "tired"
  | "needs-modernising"
  | "needs-major-work"
  | "uninhabitable";

/**
 * Works as a share of value, by condition.
 *
 * Deliberately generous at the top end. Under-estimating works is the single
 * most common way these deals fail, and the seller is not the person who will
 * discover the error.
 */
const WORKS_BY_CONDITION: Record<PropertyCondition, { bps: number; label: string }> = {
  ready: { bps: 100, label: "Ready to occupy — cosmetic only" },
  tired: { bps: 600, label: "Tired — decoration and small repairs" },
  "needs-modernising": { bps: 1_400, label: "Needs modernising — kitchen, bathroom, decoration" },
  "needs-major-work": { bps: 2_400, label: "Needs major work — rewire, replumb, roof or structural" },
  uninhabitable: { bps: 3_800, label: "Uninhabitable — full refurbishment required" },
};

/**
 * Uplift on value once works are complete.
 *
 * Refurbishment does not return pound for pound. A property in poor condition
 * has more headroom than a tired one, but no condition returns its full spend
 * plus a premium at these levels, which is exactly why the margin has to come
 * from the entry price rather than from the works.
 */
const UPLIFT_BY_CONDITION: Record<PropertyCondition, number> = {
  ready: 200,
  tired: 900,
  "needs-modernising": 1_900,
  "needs-major-work": 2_800,
  uninhabitable: 3_600,
};

/** Monthly rent as a share of value, a crude yield proxy pending real comps. */
const RENT_YIELD_BPS = 620;

export type ClaimStatus = "verified" | "unverified" | "contradicted";

export interface TruthCheck {
  readonly key: string;
  readonly label: string;
  readonly status: ClaimStatus;
  readonly detail: string;
}

export interface IntakeResult {
  readonly property: PropertyFacts;
  readonly seller: SellerProfile;
  readonly checks: readonly TruthCheck[];
  /** True where a figure the routes depend on has not been independently verified. */
  readonly requiresValuation: boolean;
}

export function buildIntake(answers: IntakeAnswers): IntakeResult {
  const checks: TruthCheck[] = [];
  const condition = WORKS_BY_CONDITION[answers.condition];

  // --- Truth Engine: the seller's valuation is a claim --------------------
  // Every figure downstream rests on this number, and the seller has every
  // reason to be optimistic about it without intending to mislead.
  let valuation = answers.sellerValuation;
  let confidence = bps(5_500);

  checks.push({
    key: "seller-valuation",
    label: "Property value",
    status: "unverified",
    detail:
      "Based on the figure you gave us. We have not valued the property, and every figure on your options page moves if this number is wrong.",
  });

  if (answers.currentAsking !== undefined && answers.currentAsking > 0) {
    const gapBps = ratioBps(sub(answers.sellerValuation, answers.currentAsking), answers.currentAsking);
    if (Math.abs(gapBps) <= 500) {
      confidence = bps(7_000);
      checks.push({
        key: "asking-agrees",
        label: "Agent's asking price agrees with your estimate",
        status: "verified",
        detail: "Your estimate is within 5% of what the property is currently marketed at.",
      });
    } else if (gapBps > 500) {
      // The seller thinks it is worth more than an agent will market it at.
      // The agent's figure is the better evidence, so it wins.
      valuation = answers.currentAsking;
      confidence = bps(6_000);
      checks.push({
        key: "asking-below-estimate",
        label: "Your estimate is above the asking price",
        status: "contradicted",
        detail: `You estimated ${gbp(answers.sellerValuation)} but the property is marketed at ${gbp(answers.currentAsking)}. We have used the lower figure, because a property that has not sold at the asking price is unlikely to be worth more than it.`,
      });
    } else {
      checks.push({
        key: "asking-above-estimate",
        label: "Asking price is above your own estimate",
        status: "unverified",
        detail: `Marketed at ${gbp(answers.currentAsking)}, which is above your own estimate of ${gbp(answers.sellerValuation)}. We have used your figure.`,
      });
    }
  }

  if (answers.knownIssues.length > 0) {
    confidence = bps(Math.max(4_000, confidence - answers.knownIssues.length * 500));
    checks.push({
      key: "issues-affect-value",
      label: "Known issues reduce confidence in the value",
      status: "unverified",
      detail: `${answers.knownIssues.join(", ")}. Issues like these narrow the pool of buyers who can get a mortgage, which affects both value and saleability.`,
    });
  }

  if (answers.tenure === "leasehold" && (answers.leaseYearsRemaining ?? 999) < 80) {
    confidence = bps(Math.max(3_500, confidence - 1_000));
    checks.push({
      key: "short-lease",
      label: "Short lease materially affects value",
      status: "unverified",
      detail: `${answers.leaseYearsRemaining} years remaining. Below 80 years the cost of extending rises sharply and most lenders become cautious. A valuation should be obtained before you rely on any figure here.`,
    });
  }

  const refurbishment = applyBps(valuation, bps(condition.bps));
  const postWorks = money(valuation + applyBps(valuation, bps(UPLIFT_BY_CONDITION[answers.condition])));

  checks.push({
    key: "works-estimate",
    label: "Refurbishment estimate",
    status: "unverified",
    detail: `${gbp(refurbishment)}, derived from the condition you described (${condition.label.toLowerCase()}). This is a planning figure, not a quotation, and a builder's estimate will differ.`,
  });

  checks.push({
    key: "rent-estimate",
    label: "Rental estimate",
    status: "unverified",
    detail:
      "Derived from value rather than from local rental evidence. It affects which buyers are interested but not what you are offered.",
  });

  const issues: PropertyIssue[] = [...answers.knownIssues];
  if (
    answers.tenure === "leasehold" &&
    (answers.leaseYearsRemaining ?? 999) < 80 &&
    !issues.includes("short-lease")
  ) {
    issues.push("short-lease");
  }

  const property: PropertyFacts = {
    id: `prop-${answers.postcodeArea.toLowerCase().replace(/\s+/g, "")}-${answers.bedrooms}`,
    jurisdiction: answers.jurisdiction,
    postcodeArea: answers.postcodeArea,
    locality: answers.locality,
    propertyType: answers.propertyType,
    tenure: answers.tenure,
    bedrooms: answers.bedrooms,
    occupancy: answers.occupancy,
    openMarketValue: valuation,
    valuationConfidence: confidence,
    refurbishmentEstimate: refurbishment,
    postWorksValue: postWorks,
    monthlyRent: applyBps(money(Math.round(valuation / 12)), bps(RENT_YIELD_BPS)),
    ...(answers.leaseYearsRemaining !== undefined
      ? { leaseYearsRemaining: answers.leaseYearsRemaining }
      : {}),
    knownIssues: issues,
  };

  const seller: SellerProfile = {
    situation: answers.situation,
    priorities: answers.priorities,
    ...(answers.targetDays !== undefined ? { targetDays: answers.targetDays } : {}),
    ...(answers.priceExpectation !== undefined ? { priceExpectation: answers.priceExpectation } : {}),
    narrative: answers.narrative,
    screening: answers.screening,
  };

  return {
    property,
    seller,
    checks,
    requiresValuation: true,
  };
}

export const CONDITIONS: readonly { value: PropertyCondition; label: string }[] = (
  Object.keys(WORKS_BY_CONDITION) as PropertyCondition[]
).map((value) => ({ value, label: WORKS_BY_CONDITION[value].label }));

export const RENT_YIELD = pct(RENT_YIELD_BPS / 100);

