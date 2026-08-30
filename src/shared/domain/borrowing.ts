import { add, bps, isZero, money, sub, ZERO, type Money } from "@shared/money";
import type { DealAppraisal } from "@shared/domain/types";

/**
 * What the borrowing actually costs, and what actually arrives.
 *
 * Two questions a headline rate cannot answer, and getting either wrong is how
 * a funded deal falls over on completion day.
 *
 * **The total.** Comparing lenders on the advertised monthly rate picks the
 * wrong one routinely: a cheaper rate carrying a two per cent broker fee is
 * dearer than a higher rate carrying none over a nine-month term. The
 * comparable figure is interest plus arrangement fee plus broker fee plus
 * valuation and legal costs plus exit fee, over the actual term.
 *
 * **The net advance.** A facility is not a cash sum. Where interest is retained
 * rather than serviced, the lender deducts the whole term's interest at
 * drawdown; fees are usually deducted too. A £500,000 facility at 0.95% a month
 * over nine months with a 2% arrangement fee pays out around £447,000 on the
 * day. A borrower who planned the completion statement around £500,000 is
 * £53,000 short with the clock running, and finds out too late to do anything
 * about it.
 *
 * This module derives from the appraisal rather than recomputing anything. The
 * cost stack already prices the facility; the arithmetic that matters here is
 * what is taken off the top before the money moves.
 */

export interface BorrowingLine {
  readonly label: string;
  readonly amount: Money;
  /** True where this is taken from the facility at drawdown rather than paid later. */
  readonly deductedAtDrawdown: boolean;
  readonly note: string;
}

export interface BorrowingCost {
  readonly facility: Money;
  readonly lines: readonly BorrowingLine[];
  readonly total: Money;
  /**
   * Total cost as a proportion of the facility, over the term as modelled.
   *
   * Not annualised, and deliberately not called an APR: an APR has a statutory
   * definition and this is not one. It is what this borrowing costs on this
   * deal, which is the figure to compare between offers on the same term.
   */
  readonly costOfFacilityBps: number;
  readonly termMonths: number;
}

/** Every cost of the senior facility, itemised, from the appraisal. */
export function borrowingCost(appraisal: DealAppraisal): BorrowingCost {
  const { costs, funding, inputs } = appraisal;
  const facility = funding.seniorDebt;
  const retained = inputs.finance.interestRolledUp;

  const lines: BorrowingLine[] = [
    {
      label: "Arrangement fee",
      amount: costs.financeArrangement,
      deductedAtDrawdown: true,
      note: "Charged on the facility and almost always deducted from the advance rather than invoiced.",
    },
    {
      label: "Broker fee",
      amount: costs.financeBroker,
      deductedAtDrawdown: true,
      note: "Zero where the broker is paid by the lender. Ask which, because it changes the comparison.",
    },
    {
      label: "Interest",
      amount: costs.financeInterest,
      deductedAtDrawdown: retained,
      note: retained
        ? "Retained: the whole term's interest is deducted at drawdown, so it reduces the money received."
        : "Serviced monthly, so it is a cash-flow commitment during the term rather than a deduction from the advance.",
    },
    {
      label: "Valuation and lender legals",
      amount: costs.lenderCosts,
      deductedAtDrawdown: false,
      note: "Payable whether or not the loan completes. This is the money at risk before there is any facility at all.",
    },
    {
      label: "Exit fee",
      amount: costs.financeExit,
      deductedAtDrawdown: false,
      note: "Paid on redemption, so it comes out of the sale or the refinance rather than the advance.",
    },
  ];

  const total = add(...lines.map((l) => l.amount));

  return {
    facility,
    lines,
    total,
    costOfFacilityBps: isZero(facility) ? 0 : Math.round((total / facility) * 10_000),
    termMonths: inputs.holdMonths,
  };
}

export interface NetAdvance {
  readonly facility: Money;
  /** Taken off the top before the money moves. */
  readonly deductions: readonly BorrowingLine[];
  readonly deducted: Money;
  /** What actually reaches the solicitor's account on drawdown. */
  readonly received: Money;
  /**
   * The gap between what the deal assumed the debt would contribute and what it
   * actually will. Positive means more cash is needed than planned.
   */
  readonly shortfall: Money;
  readonly reason: string;
}

/**
 * What the facility actually pays out, and what that does to the cash needed.
 *
 * The appraisal models the senior debt as contributing its full face value
 * towards the funding requirement. Where interest is retained, that is not
 * true — and the difference is the single most common reason a funded
 * acquisition fails to complete on the day.
 */
export function netAdvance(appraisal: DealAppraisal): NetAdvance {
  const cost = borrowingCost(appraisal);
  const deductions = cost.lines.filter((l) => l.deductedAtDrawdown && l.amount > 0);
  const deducted = add(...deductions.map((l) => l.amount));
  const received = money(Math.max(0, cost.facility - deducted));

  return {
    facility: cost.facility,
    deductions,
    deducted,
    received,
    shortfall: deducted,
    reason: isZero(deducted)
      ? "Nothing is deducted at drawdown, so the facility pays out in full."
      : `The facility is ${gbpish(cost.facility)} but ${gbpish(deducted)} is deducted at drawdown, so ${gbpish(received)} reaches the completion account. Fund the difference from equity or the purchase cannot complete.`,
  };
}

/**
 * Compare two offers on the same deal.
 *
 * Written as a comparison of totals rather than rates because that is the
 * comparison people fail to make. Returns the cheaper one and by how much.
 */
export interface OfferComparison {
  readonly cheaper: "a" | "b" | "level";
  readonly difference: Money;
  readonly reason: string;
}

export function compareOffers(
  a: { readonly label: string; readonly cost: BorrowingCost },
  b: { readonly label: string; readonly cost: BorrowingCost },
): OfferComparison {
  const difference = money(Math.abs(a.cost.total - b.cost.total));
  if (a.cost.total === b.cost.total) {
    return { cheaper: "level", difference: ZERO, reason: "The two offers cost the same in total." };
  }
  const cheaper = a.cost.total < b.cost.total ? "a" : "b";
  const winner = cheaper === "a" ? a : b;
  const loser = cheaper === "a" ? b : a;
  return {
    cheaper,
    difference,
    reason: `${winner.label} costs ${gbpish(difference)} less than ${loser.label} in total over ${a.cost.termMonths} months, whatever the headline rates say.`,
  };
}

/**
 * Formatted inline rather than through `format.ts`.
 *
 * These strings are reasons, not UI: they are stored, printed into the
 * memorandum and read back in the audit trail, so they must not depend on a
 * formatting choice that a page might change.
 */
function gbpish(value: Money): string {
  return `£${(value / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * A sanity bound on what a bridging facility should cost.
 *
 * Not a rule and not advice: a wide band that flags an offer worth a second
 * look. Bridging in the UK has run roughly 0.55%–1.5% a month with fees on top,
 * so a total cost far outside this over a normal term usually means a fee has
 * been missed from the comparison or the term is longer than assumed.
 */
export const EXPECTED_TOTAL_COST_BPS = { low: bps(400), high: bps(2_000), asOf: "2026-08-25" };

export function looksMispriced(cost: BorrowingCost): string | undefined {
  if (cost.termMonths <= 0) return undefined;
  if (cost.costOfFacilityBps > EXPECTED_TOTAL_COST_BPS.high) {
    return `The total cost is ${(cost.costOfFacilityBps / 100).toFixed(1)}% of the facility over ${cost.termMonths} months, which is high for bridging. Check the exit fee and whether the term is realistic.`;
  }
  if (cost.costOfFacilityBps < EXPECTED_TOTAL_COST_BPS.low) {
    return `The total cost is only ${(cost.costOfFacilityBps / 100).toFixed(1)}% of the facility. That is cheap for bridging — check that the broker fee, valuation and legal costs are all in the figures.`;
  }
  return undefined;
}

/** Everything above, for one deal, in one call. */
export interface BorrowingReport {
  readonly cost: BorrowingCost;
  readonly advance: NetAdvance;
  readonly warning?: string;
}

export function borrowingReport(appraisal: DealAppraisal): BorrowingReport {
  const cost = borrowingCost(appraisal);
  const warning = looksMispriced(cost);
  return {
    cost,
    advance: netAdvance(appraisal),
    ...(warning !== undefined ? { warning } : {}),
  };
}

/**
 * Cash the borrower must find, given what the facility will actually pay out.
 *
 * The appraisal's own equity figure assumes the debt contributes its face
 * value. Where interest is retained it does not, and this is the difference
 * that has to be on the completion statement.
 */
export function equityGap(required: Money, advance: NetAdvance): Money {
  return money(Math.max(0, sub(required, advance.received)));
}
