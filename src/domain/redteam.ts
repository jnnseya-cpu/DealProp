import { bps, isNegative, money, scale, type Money } from "@/lib/money";
import { appraise } from "@/domain/economics";
import type { DealAppraisal, DealInputs } from "@/domain/types";

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

export interface Stress {
  readonly key: string;
  readonly label: string;
  readonly question: string;
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
    label: "Value 10% lower",
    question: "What if the finished property is worth 10% less than assumed?",
    apply: gdvDown(0.9),
  },
  {
    key: "works-25",
    label: "Works 25% over",
    question: "What if the refurbishment costs 25% more than estimated?",
    apply: worksUp(1.25),
  },
  {
    key: "hold-plus-4",
    label: "Four months late",
    question: "What if the project takes four months longer than planned?",
    apply: holdLonger(4),
  },
  {
    key: "rate-plus-300",
    label: "Rates 3% higher",
    question: "What if the cost of debt rises by three percentage points?",
    apply: rateUp(300),
  },
  {
    key: "rent-15",
    label: "Rent 15% lower",
    question: "What if achievable rent is 15% below the estimate?",
    apply: rentDown(0.85),
  },
  {
    key: "no-sale-12m",
    label: "Cannot exit for 12 months",
    question: "What if the property cannot be sold or refinanced for a further year?",
    apply: holdLonger(12),
  },
  {
    key: "moderate",
    label: "Moderate downside",
    question: "Value 5% lower, works 15% over, two months late.",
    apply: compose(gdvDown(0.95), worksUp(1.15), holdLonger(2)),
  },
  {
    key: "severe",
    label: "Severe downside",
    question: "Value 12% lower, works 30% over, six months late, rates 2% higher.",
    apply: compose(gdvDown(0.88), worksUp(1.3), holdLonger(6), rateUp(200)),
  },
  {
    key: "capital-loss",
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
  const lossScenarios = results.filter((r) => r.losesCapital).map((r) => r.stress.label);

  // Resilience compares the median stressed outcome to the base case, so a
  // single catastrophic scenario does not dominate, but any loss scenario
  // caps the score — a deal that can lose money is not resilient regardless
  // of how well it performs elsewhere.
  const sorted = [...results].map((r) => r.profit).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let resilience =
    base.profit > 0 ? Math.round(Math.max(0, Math.min(1, median / base.profit)) * 100) : 0;
  if (lossScenarios.length > 0) {
    resilience = Math.min(resilience, 45 - Math.min(40, lossScenarios.length * 8));
  }
  resilience = Math.max(0, Math.min(100, resilience));

  const summary =
    lossScenarios.length === 0
      ? `Profit remains positive under all ${results.length} stress scenarios. Worst case retains ${formatShare(worstCase, base.profit)} of base profit.`
      : `Capital is lost in ${lossScenarios.length} of ${results.length} scenarios: ${lossScenarios.join(", ")}.`;

  return { base, results, worstCase, lossScenarios, resilience, summary };
}

function formatShare(part: Money, whole: Money): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}
