import { bps, isZero, money, ratioBps, sub, ZERO, type Bps, type Money } from "@shared/money";
import type { DealAppraisal } from "@shared/domain/types";
import { netAdvance } from "@shared/domain/borrowing";

/**
 * The ratios a funder actually decides on.
 *
 * A lender does not read a Deal Score. It reads leverage against value, against
 * cost and against end value; the cash the sponsor is genuinely putting in; what
 * lands on the day; and whether the exit repays the debt with room to spare.
 * Those are the numbers here, computed once so the memorandum, the readiness
 * score and the funder-facing pages cannot quote different ones.
 *
 * Every metric carries its own reasoning, in keeping with the rest of the
 * platform: a bare "72% LTV" tells a reader nothing about which value it is
 * against, and the difference between LTV on the purchase price and LTV on the
 * open-market value is exactly where a deal is talked into looking fundable.
 *
 * **`FORMULA_VERSION` is part of the output.** A ratio stored today and read in
 * six months has to be interpretable against the definition that produced it —
 * lenders change what they measure LTV against, and a silently redefined ratio
 * invalidates every comparison made before the change.
 */
export const FORMULA_VERSION = "funding-metrics-1";

/**
 * The debt-service cover a term lender typically requires at refinance.
 *
 * 1.25x is the common floor across UK buy-to-let and commercial term lending;
 * below it the rent does not cover the payment with enough margin for a void or
 * a rate move, and the refinance that the whole exit depends on is not offered.
 *
 * Kept here beside `refinanceDscr()` so the ratio and the level it is judged
 * against cannot drift apart, and dated because lenders move it.
 */
export const REFINANCE_DSCR_COVENANT = { level: bps(12_500), asOf: "2026-08-31" } as const;

export interface Metric {
  readonly key: MetricKey;
  readonly label: string;
  /**
   * How the figure should be read.
   *
   * A leverage ratio is a percentage; a debt-service cover is a multiple. They
   * are both stored in basis points, and rendering a cover of 0.53x as "52.6%"
   * says the opposite of what it means to anybody scanning the page — a lender
   * reads 52.6% as comfortable and 0.53x as unfundable.
   */
  readonly display: "percent" | "times" | "amount";
  /** Basis points where the metric is a ratio, undefined where it is an amount. */
  readonly bps?: Bps;
  /** The amount, where the metric is one. */
  readonly amount?: Money;
  /** What it was measured against, named rather than assumed. */
  readonly against: string;
  readonly reason: string;
}

export type MetricKey =
  | "ltv-purchase"
  | "ltv-market"
  | "ltgdv"
  | "ltc"
  | "equity-required"
  | "net-day-one"
  | "funding-gap"
  | "exit-headroom"
  | "refinance-dscr";

export interface FundingMetrics {
  readonly formulaVersion: string;
  readonly metrics: readonly Metric[];
  /** True where the exit does not repay the debt. Nothing else matters if so. */
  readonly exitRepaysDebt: boolean;
  readonly summary: string;
}

/**
 * How much cash the sponsor must produce, given what the facility really pays.
 *
 * The appraisal's own equity figure assumes the debt contributes its face
 * value. Where interest is retained it does not, and this is the number that
 * has to be on the completion statement rather than the optimistic one.
 */
export function cashRequired(appraisal: DealAppraisal): Money {
  const advance = netAdvance(appraisal);
  const uses = appraisal.costs.total;
  return money(Math.max(0, sub(uses, advance.received)));
}

/**
 * Net proceeds at exit less everything owed at that point.
 *
 * Headroom is what absorbs a slower sale or a lower valuation. A deal with a
 * positive profit and no headroom is a deal that repays its lender only if
 * nothing goes wrong, which is not the same thing as a fundable deal.
 */
export function exitHeadroom(appraisal: DealAppraisal): Money {
  const owedAtExit = appraisal.funding.seniorDebt;
  return sub(appraisal.exit.netProceeds, owedAtExit);
}

/**
 * Debt service cover on the refinance, where the exit is a refinance.
 *
 * Stabilised net operating income over annual debt service. Below 1.0 the
 * asset does not pay its own interest and the refinance will not be offered,
 * whatever the loan-to-value says — which is why a BRR deal can pass every
 * leverage test and still be unfundable.
 *
 * Undefined for a sale exit: there is no ongoing debt to service.
 */
export function refinanceDscr(appraisal: DealAppraisal): Bps | undefined {
  const rent = appraisal.exit.monthlyNetRent;
  const advance = appraisal.exit.refinanceAdvance;
  if (rent === undefined || advance === undefined || advance <= 0) return undefined;

  const annualNoi = money(rent * 12);
  const annualDebtService = money(
    Math.round((advance * appraisal.inputs.finance.annualRateBps) / 10_000),
  );
  if (annualDebtService <= 0) return undefined;

  return ratioBps(annualNoi, annualDebtService);
}

/**
 * @param committedCash Sponsor and investor cash actually recorded against this
 * deal, with evidence. Defaults to nothing, because unevidenced cash is not
 * cash — and a funding gap that quietly assumes the sponsor will find the money
 * is the assumption that fails at completion rather than at appraisal.
 */
export function fundingMetrics(
  appraisal: DealAppraisal,
  committedCash: Money = ZERO,
): FundingMetrics {
  const { inputs, costs, funding, exit } = appraisal;
  const facility = funding.seniorDebt;
  const advance = netAdvance(appraisal);
  const headroom = exitHeadroom(appraisal);
  const dscr = refinanceDscr(appraisal);
  const cash = cashRequired(appraisal);
  const gap = money(Math.max(0, sub(cash, committedCash)));

  const metrics: Metric[] = [
    {
      key: "ltv-purchase",
      label: "LTV on purchase price",
      display: "percent",
      bps: ratioBps(facility, inputs.purchasePrice),
      against: "the price being paid",
      reason:
        "What the lender is advancing against what is actually being paid. The honest leverage figure on a purchase.",
    },
    {
      key: "ltv-market",
      label: "LTV on market value",
      display: "percent",
      bps: ratioBps(facility, inputs.property.openMarketValue),
      against: "the independent open-market value",
      reason:
        inputs.property.openMarketValue > inputs.purchasePrice
          ? "Lower than LTV on price because the asset is being bought below value. Lenders differ on whether they will lend against value or price on a recent purchase, and most use the lower."
          : "At or above the price-based figure, which means there is no valuation cushion in the purchase.",
    },
    {
      key: "ltgdv",
      label: "Loan to gross development value",
      display: "percent",
      bps: ratioBps(facility, exit.grossDevelopmentValue),
      against: "the value once works complete",
      reason:
        "The ratio a development or refurbishment lender caps. It relies on the post-works value being achieved, so it is only as good as the evidence behind that figure.",
    },
    {
      key: "ltc",
      label: "Loan to total cost",
      display: "percent",
      bps: ratioBps(facility, costs.total),
      against: "every cost of the project including the purchase",
      reason:
        "The check that catches over-leverage a value-based ratio misses. A deal can sit inside an LTV cap and still leave the sponsor with nothing at stake.",
    },
    {
      key: "equity-required",
      display: "amount",
      label: "Cash the sponsor must produce",
      amount: cash,
      against: "total uses less the money the facility actually pays out",
      reason:
        "Computed from the net advance, not the facility. Using the face value of the debt here is how a completion statement comes up short on the day.",
    },
    {
      key: "net-day-one",
      display: "amount",
      label: "Net advance on drawdown",
      amount: advance.received,
      against: "the gross facility less what is deducted at drawdown",
      reason: advance.reason,
    },
    {
      key: "funding-gap",
      display: "amount",
      label: "Funding gap",
      amount: gap,
      against: "cash required against cash committed with evidence",
      reason:
        gap > 0
          ? `£${(gap / 100).toFixed(0)} of the £${(cash / 100).toFixed(0)} needed has no committed source recorded against it. An unevidenced gap is what fails at completion rather than at appraisal.`
          : "Every pound needed has a committed source recorded against it.",
    },
    {
      key: "exit-headroom",
      display: "amount",
      label: "Exit headroom",
      amount: headroom,
      against: "net exit proceeds less debt outstanding at exit",
      reason:
        headroom > 0
          ? "What absorbs a slower sale or a lower valuation before the lender is short."
          : "The exit does not repay the debt. Nothing else about this deal matters until that changes.",
    },
  ];

  if (dscr !== undefined) {
    metrics.push({
      key: "refinance-dscr",
      label: "Refinance debt service cover",
      display: "times",
      bps: dscr,
      against: "stabilised net rent over annual interest on the refinance",
      reason:
        dscr < 10_000
          ? "Below 1.0: the asset does not cover its own interest, so the refinance exit will not be offered whatever the leverage figures say."
          : "Above 1.0, so the asset services the refinance. Most lenders want materially more than 1.0 — check the specific cover requirement.",
    });
  }

  const exitRepaysDebt = headroom > 0;

  return {
    formulaVersion: FORMULA_VERSION,
    metrics,
    exitRepaysDebt,
    summary: exitRepaysDebt
      ? `Exit repays the facility with £${(headroom / 100).toFixed(0)} of headroom. The sponsor must produce £${(cash / 100).toFixed(0)} in cash, of which £${(gap / 100).toFixed(0)} has no committed source yet.`
      : "The modelled exit does not repay the senior facility. This is not a funding problem to shop around; it is a deal that does not work as structured.",
  };
}

/** A ratio as a percentage string, for a reason line rather than for a page. */
export function asPercent(value: Bps): string {
  return `${(value / 100).toFixed(1)}%`;
}

/** True where a ratio exceeds a cap. Named so a caller cannot invert it. */
export function exceedsCap(actual: Bps, cap: Bps): boolean {
  return actual > cap;
}

/** Zero-safe ratio for callers outside the appraisal. */
export function leverage(debt: Money, against: Money): Bps {
  return isZero(against) ? bps(0) : ratioBps(debt, against);
}
