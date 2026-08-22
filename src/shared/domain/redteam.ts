import { bps, isNegative, money, scale, type Money } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import type { DealAppraisal, DealInputs } from "@shared/domain/types";

/**
 * AI Red Team.
 *
 * An independent pass whose only job is to break the deal. It runs before any
 * pack reaches a funder, and its output is presented alongside the base case
 * rather than beneath it — a lender should see the downside at the same moment
 * they see the headline.
 *
 * Scenarios are deliberately mechanical and reproducible. The value is not in
 * a clever narrative; it is that every deal on the platform has been shocked
 * by the same defined set of stresses, so lenders can compare deals.
 */

/**
 * Single-factor stresses move one variable. Losing money in one of these is
 * genuinely alarming: it means the deal depends on a single assumption holding.
 *
 * Compound scenarios stack several severe moves at once. They are constructed
 * to be survivable-or-not at the tail, and a deal that only loses money there
 * is normal rather than defective. Scoring them identically would punish every
 * deal for failing a test designed to be nearly unpassable, which is how a
 * risk model ends up telling users nothing.
 */
export type StressTier = "single" | "compound";

export interface Stress {
  readonly key: string;
  readonly label: string;
  readonly question: string;
  readonly tier: StressTier;
  apply(inputs: DealInputs): DealInputs;
}

/** Reduce the assumed post-works value. */
function gdvDown(factor: number): (i: DealInputs) => DealInputs {
  return (i) => ({
    ...i,
    property: { ...i.property, postWorksValue: scale(i.property.postWorksValue, factor) },
  });
}

/** Increase the assumed works cost. */
function worksUp(factor: number): (i: DealInputs) => DealInputs {
  return (i) => ({
    ...i,
    property: {
      ...i.property,
      refurbishmentEstimate: scale(i.property.refurbishmentEstimate, factor),
    },
  });
}

/** Extend the hold period. */
function holdLonger(extraMonths: number): (i: DealInputs) => DealInputs {
  return (i) => ({ ...i, holdMonths: i.holdMonths + extraMonths });
}

/** Increase the cost of debt. */
function rateUp(extraBps: number): (i: DealInputs) => DealInputs {
  return (i) => ({
    ...i,
    finance: { ...i.finance, annualRateBps: bps(i.finance.annualRateBps + extraBps) },
  });
}

function rentDown(factor: number): (i: DealInputs) => DealInputs {
  return (i) => ({
    ...i,
    property: { ...i.property, monthlyRent: scale(i.property.monthlyRent, factor) },
  });
}

function compose(...fns: ((i: DealInputs) => DealInputs)[]): (i: DealInputs) => DealInputs {
  return (i) => fns.reduce((acc, fn) => fn(acc), i);
}

export const STRESSES: readonly Stress[] = [
  {
    key: "gdv-10",
    tier: "single",
    label: "Value 10% lower",
    question: "What if the finished property is worth 10% less than assumed?",
    apply: gdvDown(0.9),
  },
  {
    key: "works-25",
    tier: "single",
    label: "Works 25% over",
    question: "What if the refurbishment costs 25% more than estimated?",
    apply: worksUp(1.25),
  },
  {
    key: "hold-plus-4",
    tier: "single",
    label: "Four months late",
    question: "What if the project takes four months longer than planned?",
    apply: holdLonger(4),
  },
  {
    key: "rate-plus-300",
    tier: "single",
    label: "Rates 3% higher",
    question: "What if the cost of debt rises by three percentage points?",
    apply: rateUp(300),
  },
  {
    key: "rent-15",
    tier: "single",
    label: "Rent 15% lower",
    question: "What if achievable rent is 15% below the estimate?",
    apply: rentDown(0.85),
  },
  {
    key: "no-sale-12m",
    tier: "single",
    label: "Cannot exit for 12 months",
    question: "What if the property cannot be sold or refinanced for a further year?",
    apply: holdLonger(12),
  },
  {
    key: "moderate",
    tier: "compound",
    label: "Moderate downside",
    question: "Value 5% lower, works 15% over, two months late.",
    apply: compose(gdvDown(0.95), worksUp(1.15), holdLonger(2)),
  },
  {
    key: "severe",
    tier: "compound",
    label: "Severe downside",
    question: "Value 12% lower, works 30% over, six months late, rates 2% higher.",
    apply: compose(gdvDown(0.88), worksUp(1.3), holdLonger(6), rateUp(200)),
  },
  {
    key: "capital-loss",
    tier: "compound",
    label: "Capital loss scenario",
    question: "Value 20% lower, works 50% over, twelve months late, rates 4% higher.",
    apply: compose(gdvDown(0.8), worksUp(1.5), holdLonger(12), rateUp(400)),
  },
];

export interface StressResult {
  readonly stress: Stress;
  readonly appraisal: DealAppraisal;
  readonly profit: Money;
  /** Change in profit against the base case. */
  readonly profitDelta: Money;
  readonly wipesOutProfit: boolean;
  readonly losesCapital: boolean;
}

export interface RedTeamReport {
  readonly base: DealAppraisal;
  readonly results: readonly StressResult[];
  /** Worst profit across every scenario. */
  readonly worstCase: Money;
  /** Scenarios in which the investor loses money. */
  readonly lossScenarios: readonly string[];
  /** Losses caused by a single variable moving. These are the serious ones. */
  readonly singleFactorLosses: readonly string[];
  /** Losses that only occur when several severe moves stack at once. */
  readonly compoundLosses: readonly string[];
  /** 0-100. How much of the base profit survives the stresses. */
  readonly resilience: number;
  readonly summary: string;
}

export function runRedTeam(inputs: DealInputs): RedTeamReport {
  const base = appraise(inputs);

  const results = STRESSES.map<StressResult>((stress) => {
    const appraisal = appraise(stress.apply(inputs));
    return {
      stress,
      appraisal,
      profit: appraisal.profit,
      profitDelta: money(appraisal.profit - base.profit),
      wipesOutProfit: appraisal.profit < base.profit * 0.25,
      losesCapital: isNegative(appraisal.profit),
    };
  });

  const worstCase = money(Math.min(...results.map((r) => r.profit)));
  const losses = results.filter((r) => r.losesCapital);
  const lossScenarios = losses.map((r) => r.stress.label);
  const singleFactorLosses = losses.filter((r) => r.stress.tier === "single").map((r) => r.stress.label);
  const compoundLosses = losses.filter((r) => r.stress.tier === "compound").map((r) => r.stress.label);

  // Resilience is measured against the single-factor stresses, because those
  // are the ones that ask a fair question: does this deal survive one thing
  // going wrong? The compound scenarios are reported in full but weighted
  // lightly, since the most severe of them is built to be near-unpassable and
  // would otherwise flatten every deal to the same low score.
  const singles = results.filter((r) => r.stress.tier === "single").map((r) => r.profit).sort((a, b) => a - b);
  const median = singles[Math.floor(singles.length / 2)] ?? 0;
  let resilience =
    base.profit > 0 ? Math.round(Math.max(0, Math.min(1, median / base.profit)) * 100) : 0;

  // A deal that loses money when one variable moves is fragile, full stop.
  if (singleFactorLosses.length > 0) {
    resilience = Math.min(resilience, 40 - Math.min(35, singleFactorLosses.length * 10));
  }
  // Compound losses matter, but proportionately. Failing only the deliberately
  // catastrophic tail costs a little; failing the moderate case costs a lot.
  if (compoundLosses.length > 0) {
    const failsModerate = compoundLosses.includes("Moderate downside");
    resilience -= failsModerate ? 30 : compoundLosses.length * 7;
  }
  resilience = Math.max(0, Math.min(100, resilience));

  const summary =
    lossScenarios.length === 0
      ? `Profit remains positive under all ${results.length} stress scenarios. Worst case retains ${formatShare(worstCase, base.profit)} of base profit.`
      : singleFactorLosses.length > 0
        ? `Capital is lost when a single variable moves: ${singleFactorLosses.join(", ")}. The deal depends on that assumption holding.`
        : `Profit survives every single-factor stress. Capital is only lost in the compound tail: ${compoundLosses.join(", ")}.`;

  return {
    base,
    results,
    worstCase,
    lossScenarios,
    singleFactorLosses,
    compoundLosses,
    resilience,
    summary,
  };
}

function formatShare(part: Money, whole: Money): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}
