import {
  add,
  applyBps,
  bps,
  max,
  money,
  perMonths,
  ratioBps,
  sub,
  ZERO,
  type Money,
} from "@shared/money";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import type {
  CostStack,
  DealAppraisal,
  DealInputs,
  ExitOutcome,
  FundingRequirement,
  PropertyFacts,
} from "@shared/domain/types";

/**
 * The appraisal engine. Everything downstream — scores, capital stack,
 * matching, stress tests, the memorandum — reads from this one calculation.
 *
 * Design rule: this module states the whole cost of a transaction, including
 * the costs deals are usually sold without. Under-costed deals are the normal
 * failure mode of property sourcing, and a platform that repeats the sourcer's
 * optimism has no reason to exist.
 */

const RESIDENTIAL_TYPES = new Set(["house", "flat", "bungalow", "hmo"]);

function isResidential(property: PropertyFacts): boolean {
  return RESIDENTIAL_TYPES.has(property.propertyType);
}

/**
 * Interest on a bridging facility.
 *
 * Rolled-up interest compounds against the facility, which is how bridging
 * actually prices; serviced interest is charged flat on the drawn balance.
 * Modelling rolled-up interest as simple interest understates the cost of
 * exactly the deals most likely to overrun, so it is compounded monthly.
 */
export function financeInterest(
  facility: Money,
  annualRateBps: number,
  months: number,
  rolledUp: boolean,
): Money {
  if (facility <= 0 || months <= 0 || annualRateBps <= 0) return ZERO;

  if (!rolledUp) {
    return money(Math.round((facility * annualRateBps * months) / (10_000 * 12)));
  }

  const monthlyRate = annualRateBps / 10_000 / 12;
  const grossed = facility * Math.pow(1 + monthlyRate, months);
  return money(Math.round(grossed - facility));
}

export function buildCostStack(inputs: DealInputs): CostStack {
  const { property, purchasePrice, holdMonths, finance } = inputs;
  const pack = getJurisdiction(property.jurisdiction);
  const d = pack.defaults;

  const transferTax = pack.transferTax({
    price: purchasePrice,
    buyerOwnsOtherProperty: inputs.buyerOwnsOtherProperty,
    buyerIsCompany: inputs.buyerIsCompany,
    buyerIsNonResident: inputs.buyerIsNonResident,
    isResidential: isResidential(property),
  });

  const facility = seniorFacility(inputs);
  const financeArrangement = applyBps(facility.total, finance.arrangementFeeBps);
  const interest = financeInterest(
    facility.drawnForInterest,
    finance.annualRateBps,
    holdMonths,
    finance.interestRolledUp,
  );
  const financeExit = applyBps(facility.total, finance.exitFeeBps);

  const refurbishment = property.refurbishmentEstimate;
  const contingency = applyBps(refurbishment, d.contingencyBps);
  const holdingCosts = money(d.monthlyHoldingCost * holdMonths);

  // Selling costs are only incurred on a sale exit. A refinance-and-hold deal
  // pays valuation and legal fees instead, which are already counted in the
  // refinance advance calculation, so charging agency fees here would double
  // count and make every BRR deal look worse than it is.
  const sellingCosts =
    inputs.exit === "sell" || inputs.exit === "assign"
      ? add(applyBps(exitValue(inputs), d.sellingAgentBps), d.sellerLegalOnExit)
      : ZERO;

  const totalCostsExcludingPurchase = add(
    transferTax,
    d.buyerLegal,
    d.survey,
    financeArrangement,
    interest,
    financeExit,
    finance.lenderCosts,
    refurbishment,
    holdingCosts,
    sellingCosts,
    contingency,
  );

  return {
    purchasePrice,
    transferTax,
    transferTaxLabel: pack.transferTaxLabel,
    buyerLegal: d.buyerLegal,
    survey: d.survey,
    financeArrangement,
    financeInterest: interest,
    financeExit,
    lenderCosts: finance.lenderCosts,
    refurbishment,
    holdingCosts,
    sellingCosts,
    contingency,
    total: add(purchasePrice, totalCostsExcludingPurchase),
    totalCostsExcludingPurchase,
  };
}

/**
 * The senior facility: an advance against the purchase price plus, where the
 * lender funds works, a tranche against the refurbishment budget.
 *
 * Works tranches are drawn progressively rather than on day one, so interest
 * is charged on roughly half the works advance over the term. Charging it on
 * the full amount from completion would overstate the cost of every project
 * that phases its spend, which is all of them.
 */
export function seniorFacility(inputs: DealInputs): { total: Money; drawnForInterest: Money } {
  const againstPurchase = applyBps(inputs.purchasePrice, inputs.finance.ltvBps);
  const againstWorks = applyBps(
    inputs.property.refurbishmentEstimate,
    inputs.finance.refurbAdvanceBps,
  );
  return {
    total: add(againstPurchase, againstWorks),
    drawnForInterest: add(againstPurchase, money(Math.round(againstWorks / 2))),
  };
}

/** The value the deal is exited at, before any costs of exiting. */
export function exitValue(inputs: DealInputs): Money {
  const { property } = inputs;
  switch (inputs.exit) {
    case "sell":
    case "refinance-and-hold":
    case "rent-only":
      return property.postWorksValue;
    case "assign":
      // An assignment realises the contract's value, not the finished asset's.
      // The assignee needs a margin, so the assignor cannot capture the whole
      // uplift between price and current value.
      return property.openMarketValue;
  }
}

export function buildFunding(inputs: DealInputs, costs: CostStack): FundingRequirement {
  const seniorDebt = seniorFacility(inputs).total;
  return {
    totalRequired: costs.total,
    seniorDebt,
    equityRequired: max(sub(costs.total, seniorDebt), ZERO),
  };
}

/** Loan-to-value a refinancing lender will advance against post-works value. */
const REFINANCE_LTV_BPS = bps(7_500);

export function buildExit(inputs: DealInputs, costs: CostStack): ExitOutcome {
  const { property } = inputs;
  const pack = getJurisdiction(property.jurisdiction);
  const gdv = exitValue(inputs);
  const seniorDebt = seniorFacility(inputs).total;

  const netMonthlyRent = sub(
    property.monthlyRent,
    applyBps(property.monthlyRent, pack.defaults.rentalLeakageBps),
  );

  switch (inputs.exit) {
    case "sell":
    case "assign":
      return {
        strategy: inputs.exit,
        grossDevelopmentValue: gdv,
        netProceeds: gdv,
      };

    case "refinance-and-hold": {
      const advance = applyBps(gdv, REFINANCE_LTV_BPS);
      // Capital left in is what the investor cannot pull back out: total money
      // deployed less the refinance advance available to repay it.
      const capitalLeftIn = max(sub(costs.total, advance), ZERO);
      return {
        strategy: inputs.exit,
        grossDevelopmentValue: gdv,
        netProceeds: advance,
        refinanceAdvance: advance,
        capitalLeftIn,
        monthlyNetRent: netMonthlyRent,
      };
    }

    case "rent-only": {
      // No capital event. Proceeds are the senior debt still outstanding
      // against a retained asset; the return is income, not a lump sum.
      return {
        strategy: inputs.exit,
        grossDevelopmentValue: gdv,
        netProceeds: ZERO,
        capitalLeftIn: max(sub(costs.total, seniorDebt), ZERO),
        monthlyNetRent: netMonthlyRent,
      };
    }
  }
}

export function appraise(inputs: DealInputs): DealAppraisal {
  if (inputs.holdMonths < 0) {
    throw new RangeError("holdMonths must not be negative");
  }
  if (inputs.purchasePrice <= 0) {
    throw new RangeError("purchasePrice must be positive");
  }

  const costs = buildCostStack(inputs);
  const funding = buildFunding(inputs, costs);
  const exit = buildExit(inputs, costs);
  const pack = getJurisdiction(inputs.property.jurisdiction);

  const profitBeforeTax = computeProfit(inputs, costs, exit);

  // Profit tax is charged before any score is computed. A pre-tax appraisal
  // systematically overstates every deal, and the deals it overstates most are
  // the marginal ones where the decision actually matters.
  const rentalProfit =
    exit.monthlyNetRent !== undefined
      ? money(exit.monthlyNetRent * inputs.holdMonths)
      : ZERO;

  const taxAssessment = pack.profitTax({
    profitBeforeTax,
    buyerIsCompany: inputs.buyerIsCompany,
    isTrading: inputs.exit === "sell" || inputs.exit === "assign",
    rentalProfit,
  });

  const profit = sub(profitBeforeTax, taxAssessment.amount);

  // Return is measured against equity at risk, not against total cost. Debt is
  // repaid from proceeds; the investor's return is on the cash they actually
  // had to find. This is the number a JV partner cares about.
  const equityAtRisk = funding.equityRequired;
  const roiOnCashBps = ratioBps(profit, equityAtRisk);

  const annualisedRoiBps =
    inputs.holdMonths > 0
      ? bps(Math.round((roiOnCashBps * 12) / inputs.holdMonths))
      : roiOnCashBps;

  // The true discount compares everything spent to reach the finished asset
  // against what that asset is worth today, unimproved. Selling costs are
  // excluded because they are a cost of exiting, not of acquiring.
  const effectiveBasis = sub(costs.total, costs.sellingCosts);

  return {
    inputs,
    costs,
    funding,
    exit,
    profitBeforeTax,
    profitTax: taxAssessment.amount,
    profitTaxLabel: taxAssessment.label,
    profitTaxCaveats: taxAssessment.caveats,
    profit,
    roiOnCashBps,
    annualisedRoiBps,
    marginOnGdvBps: ratioBps(profit, exit.grossDevelopmentValue),
    discountToOmvBps: ratioBps(
      sub(inputs.property.openMarketValue, inputs.purchasePrice),
      inputs.property.openMarketValue,
    ),
    trueDiscountBps: ratioBps(
      sub(inputs.property.openMarketValue, effectiveBasis),
      inputs.property.openMarketValue,
    ),
    effectiveBasis,
  };
}

function computeProfit(inputs: DealInputs, costs: CostStack, exit: ExitOutcome): Money {
  switch (inputs.exit) {
    case "sell":
    case "assign":
      return sub(exit.netProceeds, costs.total);

    case "refinance-and-hold": {
      // On a refinance the "profit" realised at the capital event is the
      // equity created less the money spent, i.e. the same arithmetic as a
      // sale but without disposal costs, plus the retained asset's value is
      // reflected in capitalLeftIn rather than double counted here.
      return sub(exit.grossDevelopmentValue, costs.total);
    }

    case "rent-only": {
      // Over the hold period, profit is net rent received less the interest
      // and holding cost of carrying the asset. No capital gain is recognised
      // because the asset is not sold or refinanced.
      const rentReceived = money((exit.monthlyNetRent ?? ZERO) * inputs.holdMonths);
      return sub(rentReceived, add(costs.financeInterest, costs.holdingCosts));
    }
  }
}

/**
 * Largest price at which the deal still clears a target margin on GDV.
 *
 * Used by the Negotiation and Rescue agents: when a deal fails, the useful
 * output is not "rejected" but "this works at £X". Solved by bisection because
 * transfer tax is a step function of price, so there is no closed form.
 */
export function maxViablePrice(inputs: DealInputs, targetMarginBps: number): Money {
  let low = 0;
  let high = inputs.property.postWorksValue;
  let best = ZERO;

  for (let i = 0; i < 40; i += 1) {
    const mid = money(Math.round((low + high) / 2));
    if (mid <= 0) break;
    const trial = appraise({ ...inputs, purchasePrice: mid });
    if (trial.marginOnGdvBps >= targetMarginBps) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
    if (high - low < 100) break;
  }

  return best;
}

export function perMonthsHelper(annual: Money, months: number): Money {
  return perMonths(annual, months);
}
