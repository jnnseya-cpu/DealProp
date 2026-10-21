import { add, applyBps, money, pct, sub, ZERO, type Bps, type Money } from "@shared/money";
import { appraise, maxViablePrice } from "@shared/domain/economics";
import type { DealInputs, ExitStrategy } from "@shared/domain/types";

/**
 * The two things buy-refurbish-sell gets wrong that the rest of the engine
 * could not tell you about.
 *
 * Everything else in a flip is already modelled: the finished value is
 * `postWorksValue`, the full cost stack is `appraise()`, the tax treatment
 * distinguishes trading from capital gain, the contingency is charged rather
 * than noted, and the market dips and overruns are nine Red Team scenarios.
 * This module is deliberately small because almost nothing was missing.
 *
 * What was missing is the arithmetic a flipper actually does, and the date
 * nobody puts in the spreadsheet.
 */

/* ------------------------------------------------------------ the 70% rule */

/**
 * The rule of thumb, as it is actually used: pay no more than 70% of the
 * finished value, less the cost of the works.
 *
 * It is here so it can be *compared against*, not because the engine uses it.
 * Thirty per cent is meant to cover every transaction cost and the profit, and
 * it does so by assuming they are all average — which is exactly when they are
 * not worth checking, and no use at all when they are not. On a company
 * purchase the additional-dwelling surcharge alone can be a sixth of that
 * thirty points before anybody has borrowed anything.
 *
 * `maxViablePrice()` answers the same question properly: it searches for the
 * highest price at which this deal, with these costs, in this jurisdiction,
 * still clears the target margin. The rule is a heuristic standing in for that
 * search, and the gap between them is the subject of this module.
 */
export const RULE_OF_THUMB_SHARE: Bps = pct(70);

export interface IgnoredCost {
  readonly label: string;
  readonly amount: Money;
}

export interface RuleOfThumbComparison {
  /** What the rule says to offer. */
  readonly ruleOffer: Money;
  /** What the engine says is the most that could be paid. */
  readonly computedCeiling: Money;
  /** Rule minus engine. Positive means the rule would have you overpay. */
  readonly gap: Money;
  readonly ruleOverpays: boolean;
  /**
   * The costs the rule folds into its thirty points, itemised from the actual
   * cost stack — so the gap is explained rather than asserted.
   */
  readonly foldedIntoTheThirty: readonly IgnoredCost[];
  readonly verdict: string;
}

/**
 * The rule's offer against the computed ceiling, with the difference explained.
 *
 * Both directions are reported and neither is editorialised away. The rule
 * usually overpays, because transaction costs on a refurbishment purchase are
 * heavier than thirty points of the finished value once the surcharge and
 * bridging are real. But on a cheap property with light works and a cash buyer
 * it can be *conservative*, and a comparison that only ever said "the rule is
 * too generous" would be a slogan rather than a calculation.
 */
export function compareToRuleOfThumb(
  inputs: DealInputs,
  targetMarginBps: Bps,
): RuleOfThumbComparison {
  const arv = inputs.property.postWorksValue;
  const works = inputs.property.refurbishmentEstimate;

  // 70% of the finished value, less the works. Floored at zero: on a property
  // whose works exceed seventy points of its finished value the rule produces
  // a negative offer, which is information rather than an error.
  const share = applyBps(arv, RULE_OF_THUMB_SHARE);
  const ruleOffer = share > works ? sub(share, works) : ZERO;

  const computedCeiling = maxViablePrice(inputs, targetMarginBps);
  const gap = sub(ruleOffer, computedCeiling);
  const ruleOverpays = gap > ZERO;

  /*
   * Itemised from the appraisal at the rule's own offer, because what the
   * costs come to depends on the price — the surcharge especially.
   *
   * Guarded, because `appraise()` rejects a non-positive price and the rule
   * produces one on any property whose works exceed seventy points of its
   * finished value. That is the case the floor above exists for, so calling
   * straight through would have crashed on exactly the deal this comparison
   * is most useful on. Found by writing the test for the floor.
   */
  const foldedIntoTheThirty: IgnoredCost[] =
    ruleOffer > ZERO ? itemise({ ...inputs, purchasePrice: ruleOffer }) : [];

  return {
    ruleOffer,
    computedCeiling,
    gap: money(Math.abs(gap)),
    ruleOverpays,
    foldedIntoTheThirty,
    verdict:
      ruleOffer === ZERO
        ? "The rule produces no offer at all here: the works are more than seventy per cent of the finished value. That is a fact about the property rather than a failure of the rule."
        : ruleOverpays
          ? "The rule of thumb would have you offer more than this deal can carry. Thirty points of the finished value does not cover these costs and a profit."
          : "The rule of thumb is conservative on this one. There is room above its offer, which is worth knowing before a negotiation starts there.",
  };
}

/** The costs the rule's thirty points has to absorb, at a given price. */
function itemise(at: DealInputs): IgnoredCost[] {
  const appraised = appraise(at);
  const costs = appraised.costs;

  return [
    { label: costs.transferTaxLabel, amount: costs.transferTax },
    {
      label: "Finance: arrangement, interest and exit",
      amount: add(
        costs.financeArrangement,
        costs.financeInterest,
        costs.financeExit,
        costs.lenderCosts,
      ),
    },
    { label: "Legal and survey, both ends", amount: add(costs.buyerLegal, costs.survey) },
    { label: "Holding costs across the works", amount: costs.holdingCosts },
    { label: "Contingency on the works", amount: costs.contingency },
    { label: "Profit tax", amount: appraised.profitTax },
  ].filter((line) => line.amount > ZERO);
}

/* -------------------------------------------------- the six-month problem */

/**
 * How long most lenders want the seller to have owned the property.
 *
 * This is lender criteria rather than law, and it is stated that way
 * everywhere it is surfaced. There is no statute to cite and inventing one
 * would be worse than leaving it uncited: the position is that a large part of
 * the UK residential lending market declines where the vendor registered title
 * less than six months ago, the threshold is conventional rather than
 * universal, and the only way to know for a given buyer is to ask their
 * lender.
 *
 * It belongs in the engine because it is a constraint on the *exit*, and an
 * appraisal that models a four-month flip while assuming a mortgaged buyer is
 * modelling a transaction that a meaningful share of buyers cannot complete.
 */
export const SEASONING_MONTHS = 6;

export type ResaleRisk =
  /** Past the convention. Nothing to manage. */
  | "clear"
  /** Inside it, but close enough that waiting is cheap. */
  | "restricted"
  /** Well inside it. The mortgaged buyer pool is the thing at risk. */
  | "most-lenders-decline";

export interface EarlyResaleAssessment {
  readonly holdMonths: number;
  readonly risk: ResaleRisk;
  /** Zero once past the convention. */
  readonly monthsUntilClear: number;
  /**
   * Whether this exit is affected at all. Only a sale to a mortgaged buyer is;
   * a refinance, a let or an assignment is not, which is why the exit has to
   * be part of the question rather than just the hold period.
   */
  readonly affectsThisExit: boolean;
  readonly consequence: string;
  readonly mitigations: readonly string[];
}

/**
 * Whether the planned exit lands inside the seasoning convention.
 *
 * Reported rather than priced in. Making it reduce the modelled sale price
 * would bury a specific, manageable problem inside a general number, and the
 * manageable part is the point: three of the four mitigations below cost
 * nothing but a decision.
 */
export function assessEarlyResale(
  holdMonths: number,
  exit: ExitStrategy,
): EarlyResaleAssessment {
  // Only a sale is exposed. A refinance is the lender's own seasoning question
  // and is handled by the refinance window; a let has no lender on the far
  // side; an assignment never reaches a mortgage at all.
  const affectsThisExit = exit === "sell";
  const monthsUntilClear = Math.max(0, SEASONING_MONTHS - holdMonths);

  const risk: ResaleRisk =
    monthsUntilClear === 0 ? "clear" : holdMonths >= SEASONING_MONTHS - 2 ? "restricted" : "most-lenders-decline";

  if (!affectsThisExit) {
    return {
      holdMonths,
      risk: "clear",
      monthsUntilClear: 0,
      affectsThisExit: false,
      consequence:
        "This exit does not depend on a buyer's mortgage, so the seasoning convention does not apply to it.",
      mitigations: [],
    };
  }

  if (risk === "clear") {
    return {
      holdMonths,
      risk,
      monthsUntilClear: 0,
      affectsThisExit: true,
      consequence: `A ${holdMonths}-month hold is past the point at which most lenders ask about the vendor's ownership period.`,
      mitigations: [],
    };
  }

  return {
    holdMonths,
    risk,
    monthsUntilClear,
    affectsThisExit: true,
    consequence:
      risk === "most-lenders-decline"
        ? `Completing a sale ${holdMonths} months after purchase puts it well inside the period in which a large part of the lending market declines on vendor ownership. The buyer pool for the modelled exit is cash buyers and the lenders that do not apply it.`
        : `At ${holdMonths} months the sale is close to the convention but still inside it, so some buyers' lenders will decline and the rest will ask.`,
    mitigations: [
      `Hold to ${SEASONING_MONTHS} months before completing. ${monthsUntilClear} more month${monthsUntilClear === 1 ? "" : "s"} of holding costs, against a buyer pool several times larger.`,
      "Price and market for cash buyers, and model the exit at a cash price rather than an open-market one.",
      "Exchange inside the window with completion after it, which solves the lender's question without extending the works.",
      "Check the specific buyer's lender rather than assuming. It is criteria, not law, and the lenders that do not apply it are not rare.",
    ],
  };
}
