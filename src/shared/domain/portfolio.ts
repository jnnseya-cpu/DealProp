import { add, applyBps, bps, ratioBps, scale, sub, ZERO, type Bps, type Money } from "@shared/money";
import { gbp, percent } from "@shared/format";
import type { PropertyFacts } from "@shared/domain/types";

/**
 * What happens to a property after it completes.
 *
 * The last step of the workflow, and the one that decides whether this is a
 * marketplace or an operating system. A marketplace forgets a buyer the moment
 * they complete and has to win them back for the next purchase; an OS holds
 * what they own, tells them when the money is due to be refinanced, and knows
 * how much comes out when it is.
 *
 * Two rules shape all of it.
 *
 * **A figure is evidenced or it is an assumption, and the difference is
 * printed.** The single most tempting thing here is to carry the appraisal's
 * post-works value forward as though the works happened and the valuer agreed.
 * A holding whose current value nobody has revalued says so, every time, and
 * its equity is stated against what was actually paid rather than against a
 * projection. Every number that rests on an unverified value is marked.
 *
 * **The refinance window is a date, not a status.** A bridge is expensive
 * money with an end on it. What kills a refurbishment is not the interest, it
 * is arriving at the term end with no exit arranged — and by then the options
 * are a costly extension, a forced sale, or the lender taking it. So the
 * window is computed from the completion date and the term, and it opens
 * before it is urgent, because a broker needs weeks and a valuer needs a
 * fortnight.
 */

export const PORTFOLIO_VERSION = "portfolio-1";

/**
 * When most lenders will refinance a property the borrower has just bought.
 *
 * Six months is the common seasoning rule: before it, a term lender will
 * usually lend against the purchase price rather than the new valuation, which
 * is precisely the thing a refurbishment strategy needs them not to do.
 * Some lend earlier on a demonstrable uplift; this is the figure to plan on.
 */
export const SEASONING_MONTHS = 6;

/**
 * How long before the term ends that refinancing has to be under way.
 *
 * Ninety days. A valuation takes a fortnight to book and a fortnight to
 * arrive, legals take four to six weeks, and a lender's offer expires. Leaving
 * it later is how a sponsor ends up paying an extension fee for a case that
 * was always going to refinance.
 */
export const REFINANCE_LEAD_DAYS = 90;

/**
 * How a holding's current value was arrived at.
 *
 * Three states, because "we think it is worth this" and "a valuer said so"
 * are different facts and every figure downstream inherits the difference.
 */
export type ValuationBasis =
  /** A RICS valuation, dated. */
  | "valued"
  /** What was paid, which is a fact but a stale one. */
  | "purchase-price"
  /** The appraisal's projection. Honest, and not evidence of anything. */
  | "projected";

/**
 * What somebody has established about a property since it completed.
 *
 * Every field is a fact somebody recorded, not a projection carried forward.
 * Absent fields fall back to what was paid, which is stale but true — never to
 * the appraisal's post-works figure, which would state as fact a number that
 * depends on works nobody has confirmed happened.
 */
export interface HoldingFacts {
  /** ISO-8601, when it completed. */
  readonly completedAt: string;
  /** Everything spent since, evidenced. */
  readonly spent?: Money;
  /** What a valuer said it is worth. */
  readonly valuedAt?: string;
  readonly valuation?: Money;
  readonly valuer?: string;
  /** Debt outstanding, and the term on it. */
  readonly debt?: Money;
  readonly debtRateBps?: Bps;
  readonly facilityEndsAt?: string;
  /** Rent received monthly. Absent means not let, or nobody has said. */
  readonly monthlyRent?: Money;
  /** ISO-8601, when it was sold. A sold property leaves the portfolio. */
  readonly soldAt?: string;
}

export interface Holding {
  readonly id: string;
  readonly reference: string;
  readonly property: PropertyFacts;
  /** ISO-8601, when it completed. */
  readonly completedAt: string;
  /** What was actually paid. */
  readonly purchasePrice: Money;
  /** Everything spent since, evidenced. Refurbishment, fees, costs. */
  readonly spent: Money;
  /** What it is worth now, however that was arrived at. */
  readonly currentValue: Money;
  readonly valuationBasis: ValuationBasis;
  /** ISO-8601, the date of the valuation where there is one. */
  readonly valuedAt?: string;
  /** Debt outstanding. */
  readonly debt: Money;
  /** The rate on it, annual. */
  readonly debtRateBps: Bps;
  /** ISO-8601, when the facility ends. Absent means unencumbered. */
  readonly facilityEndsAt?: string;
  /** Rent received monthly, evidenced. Zero where it is not let. */
  readonly monthlyRent: Money;
}

/**
 * Build a holding from what was recorded, and fall back honestly.
 *
 * The one decision worth stating: with no valuation recorded, the current
 * value is what was paid, and the basis says so. Carrying the appraisal's
 * post-works value forward would state as fact a number that depends on works
 * nobody has confirmed happened — which is the most tempting and most
 * expensive mistake available in a portfolio view, because every figure
 * downstream inherits it.
 */
export function toHolding(input: {
  readonly id: string;
  readonly reference: string;
  readonly property: PropertyFacts;
  readonly purchasePrice: Money;
  readonly facts: HoldingFacts;
}): Holding {
  const { facts } = input;
  const valued = facts.valuation !== undefined && facts.valuedAt !== undefined;

  return {
    id: input.id,
    reference: input.reference,
    property: input.property,
    completedAt: facts.completedAt,
    purchasePrice: input.purchasePrice,
    spent: facts.spent ?? ZERO,
    currentValue: valued ? (facts.valuation ?? input.purchasePrice) : input.purchasePrice,
    valuationBasis: valued ? "valued" : "purchase-price",
    ...(valued && facts.valuedAt !== undefined ? { valuedAt: facts.valuedAt } : {}),
    debt: facts.debt ?? ZERO,
    debtRateBps: facts.debtRateBps ?? bps(0),
    ...(facts.facilityEndsAt !== undefined ? { facilityEndsAt: facts.facilityEndsAt } : {}),
    monthlyRent: facts.monthlyRent ?? ZERO,
  };
}

/* ------------------------------------------------------------- the money */

export interface HoldingPosition {
  readonly holding: Holding;
  /** Purchase plus everything spent on it. */
  readonly totalCost: Money;
  /** Value less debt. Negative where the debt exceeds the value. */
  readonly equity: Money;
  /** Debt against current value. */
  readonly ltvBps: Bps;
  /** Annual rent against total cost. Zero where it is not let. */
  readonly yieldOnCostBps: Bps;
  /** Rent less interest, monthly. Negative where it does not cover. */
  readonly monthlyNet: Money;
  /** True where every figure above rests on a value nobody verified. */
  readonly restsOnAnUnverifiedValue: boolean;
  readonly caveat: string;
}

export function holdingPosition(holding: Holding): HoldingPosition {
  const totalCost = add(holding.purchasePrice, holding.spent);
  const equity = sub(holding.currentValue, holding.debt);
  // Branded arithmetic through the money helpers, never bare numbers: the
  // brand exists to catch exactly the mistake of multiplying pence by twelve
  // and getting something that is not pence.
  const annualRent = scale(holding.monthlyRent, 12);
  const monthlyInterest = scale(applyBps(holding.debt, holding.debtRateBps), 1 / 12);
  const unverified = holding.valuationBasis !== "valued";

  return {
    holding,
    totalCost,
    equity,
    ltvBps: holding.currentValue > ZERO ? ratioBps(holding.debt, holding.currentValue) : bps(0),
    yieldOnCostBps: totalCost > ZERO ? ratioBps(annualRent, totalCost) : bps(0),
    monthlyNet: sub(holding.monthlyRent, monthlyInterest),
    restsOnAnUnverifiedValue: unverified,
    caveat: unverified
      ? holding.valuationBasis === "projected"
        ? `Every figure here rests on a projected value of ${gbp(holding.currentValue)} that no valuer has confirmed. Equity against what was actually paid is ${gbp(sub(totalCost, holding.debt))}.`
        : `Valued at what was paid, which is a fact but a stale one. Any uplift from works is not counted here because nothing has evidenced it.`
      : `Valued ${holding.valuedAt?.slice(0, 10) ?? ""}. A valuation is one professional's opinion on a date, not a guaranteed figure.`,
  };
}

/* --------------------------------------------------- the refinance window */

export type WindowState =
  /** Too recently bought for most term lenders to lend against the new value. */
  | "seasoning"
  /** Refinanceable, and there is time. */
  | "open"
  /** Refinanceable, and it needs to start now. */
  | "urgent"
  /** The facility has ended. */
  | "overdue"
  /** No debt, so nothing to refinance. */
  | "unencumbered";

export interface RefinanceWindow {
  readonly state: WindowState;
  /** ISO-8601, the earliest most lenders will refinance against a new value. */
  readonly seasonedAt: string;
  /** ISO-8601, when work has to start to land before the term ends. */
  readonly startBy?: string;
  /** ISO-8601, when the facility ends. */
  readonly endsAt?: string;
  /** Days until the facility ends. Negative where it has passed. */
  readonly daysRemaining?: number;
  /** What to do, in a sentence. */
  readonly advice: string;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

function addMonths(iso: string, months: number): string {
  const date = new Date(Date.parse(iso));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

/**
 * When this has to be refinanced, and whether it is time.
 *
 * Computed from the completion date and the facility term, never set. The
 * failure being prevented is arriving at the term end with no exit arranged,
 * where the remaining options are an extension fee, a forced sale or the
 * lender taking it — and every one of them costs more than starting early.
 */
export function refinanceWindow(holding: Holding, now: Date): RefinanceWindow {
  const seasonedAt = addMonths(holding.completedAt, SEASONING_MONTHS);
  const seasoned = Date.parse(seasonedAt) <= now.getTime();

  if (holding.debt <= ZERO || holding.facilityEndsAt === undefined) {
    return {
      state: "unencumbered",
      seasonedAt,
      advice:
        holding.debt <= ZERO
          ? "No debt against it, so there is nothing to refinance. Any borrowing would be a new decision rather than a deadline."
          : "Debt is recorded with no term against it. Record when the facility ends — a bridge with no end date in the system is a bridge nobody is counting down.",
    };
  }

  const endsAt = holding.facilityEndsAt;
  const startBy = addDays(endsAt, -REFINANCE_LEAD_DAYS);
  const daysRemaining = Math.floor((Date.parse(endsAt) - now.getTime()) / 86_400_000);

  if (daysRemaining < 0) {
    return {
      state: "overdue",
      seasonedAt,
      startBy,
      endsAt,
      daysRemaining,
      advice: `The facility ended ${Math.abs(daysRemaining)} days ago. Whatever is happening is happening on the lender's terms now; speak to them today.`,
    };
  }

  if (Date.parse(startBy) <= now.getTime()) {
    return {
      state: "urgent",
      seasonedAt,
      startBy,
      endsAt,
      daysRemaining,
      advice: `${daysRemaining} days left and refinancing should already be under way. A valuation takes a month to book and arrive and legals four to six weeks, so this is the point at which waiting starts costing an extension fee.`,
    };
  }

  if (!seasoned) {
    return {
      state: "seasoning",
      seasonedAt,
      startBy,
      endsAt,
      daysRemaining,
      advice: `Most term lenders will lend against the purchase price rather than a new valuation until ${seasonedAt.slice(0, 10)}, which is exactly what a refurbishment needs them not to do. Some lend earlier on a demonstrable uplift — worth asking, not worth assuming.`,
    };
  }

  return {
    state: "open",
    seasonedAt,
    startBy,
    endsAt,
    daysRemaining,
    advice: `Refinanceable now, with ${daysRemaining} days before the facility ends. Start by ${startBy.slice(0, 10)}.`,
  };
}

/* ----------------------------------------------------- what comes back out */

export interface ReleaseEstimate {
  /** What a term lender would advance at the stated LTV. */
  readonly newFacility: Money;
  /** What is left after repaying the bridge. Negative means a shortfall. */
  readonly released: Money;
  /** True where the refinance would not clear the existing debt. */
  readonly shortfall: boolean;
  readonly basis: string;
}

/**
 * What a refinance would release.
 *
 * An estimate, and labelled as one everywhere it appears. It rests on the
 * current value, so a holding valued by projection produces a projected
 * release — which is why `holdingPosition()` marks that and this repeats it.
 * A sponsor who plans the next purchase on a release that never arrives has a
 * deposit-shaped hole and a property under offer.
 */
export function releaseEstimate(holding: Holding, atLtvBps: Bps): ReleaseEstimate {
  const newFacility = applyBps(holding.currentValue, atLtvBps);
  const released = sub(newFacility, holding.debt);
  return {
    newFacility,
    released,
    shortfall: released < ZERO,
    basis: `${percent(atLtvBps, 0)} of ${gbp(holding.currentValue)}${
      holding.valuationBasis === "valued" ? "" : " — which no valuer has confirmed"
    }, less ${gbp(holding.debt)} outstanding.`,
  };
}

/* ------------------------------------------------------------- the whole */

export interface PortfolioPosition {
  readonly holdings: readonly HoldingPosition[];
  readonly totalValue: Money;
  readonly totalDebt: Money;
  readonly totalEquity: Money;
  readonly monthlyNet: Money;
  /** Holdings whose facility needs attention now, worst first. */
  readonly needingAttention: readonly { readonly holding: Holding; readonly window: RefinanceWindow }[];
  /** How many figures rest on a value nobody verified. */
  readonly unverifiedCount: number;
  readonly summary: string;
  readonly version: string;
}

export function portfolioPosition(
  holdings: readonly Holding[],
  now: Date,
): PortfolioPosition {
  const positions = holdings.map(holdingPosition);
  const windows = holdings.map((h) => ({ holding: h, window: refinanceWindow(h, now) }));

  const needingAttention = windows
    .filter((w) => w.window.state === "overdue" || w.window.state === "urgent")
    .sort((a, b) => (a.window.daysRemaining ?? 0) - (b.window.daysRemaining ?? 0));

  const totalValue = add(...positions.map((p) => p.holding.currentValue), ZERO);
  const totalDebt = add(...positions.map((p) => p.holding.debt), ZERO);
  const unverifiedCount = positions.filter((p) => p.restsOnAnUnverifiedValue).length;

  return {
    holdings: positions,
    totalValue,
    totalDebt,
    totalEquity: sub(totalValue, totalDebt),
    monthlyNet: add(...positions.map((p) => p.monthlyNet), ZERO),
    needingAttention,
    unverifiedCount,
    summary: summarise(positions.length, needingAttention.length, unverifiedCount),
    version: PORTFOLIO_VERSION,
  };
}

function summarise(held: number, attention: number, unverified: number): string {
  if (held === 0) {
    return "Nothing held yet. A property appears here when it completes, and stays until it is sold.";
  }
  const parts = [`${held} ${held === 1 ? "property" : "properties"} held`];
  if (attention > 0) {
    parts.push(
      `${attention} with a facility that needs attention now — an extension fee is the cheapest thing that goes wrong from here`,
    );
  }
  if (unverified > 0) {
    parts.push(
      `${unverified} valued by projection rather than by a valuer, so the equity on ${unverified === 1 ? "it" : "them"} is an assumption`,
    );
  }
  return `${parts.join(". ")}.`;
}
