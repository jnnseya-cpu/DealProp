import { fromMajor, pct } from "@shared/money";
import { maxViablePrice } from "@shared/domain/economics";
import { routeStrategies } from "@shared/domain/strategies";
import type { DealInputs, FinanceTerms } from "@shared/domain/types";

/**
 * Working inputs for a deal that has not been priced or structured yet.
 *
 * An enquiry arriving from seller intake carries no agreed price and no
 * structure — the seller has told us about a property, not accepted an offer.
 * Rendering that record as-is would appraise a cash purchase at full asking
 * price, which loses money on every deal, and the Deal Room would show a wall
 * of rejections that say nothing about the opportunity.
 *
 * So an unpriced deal is modelled at the best structure the Router can find,
 * priced at the ceiling that clears a target margin. The result is explicitly
 * labelled as modelled rather than agreed, because the difference between "we
 * could pay this" and "we have offered this" is the whole distinction between
 * an opportunity and a transaction.
 */

const TARGET_MARGIN_BPS = 1_500;

const WORKING_FINANCE: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(9.6),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

export interface WorkingDeal {
  readonly inputs: DealInputs;
  /** True where the price and structure were derived, not agreed. */
  readonly modelled: boolean;
  readonly note?: string;
}

/**
 * True when a record carries no negotiated position: no leverage, and a price
 * at or above open market value. Seller enquiries are stored this way.
 */
export function isUnpriced(inputs: DealInputs): boolean {
  return (
    inputs.finance.ltvBps === 0 &&
    inputs.purchasePrice >= inputs.property.openMarketValue
  );
}

export function toWorkingDeal(inputs: DealInputs): WorkingDeal {
  if (!isUnpriced(inputs)) {
    return { inputs, modelled: false };
  }

  const structured: DealInputs = {
    ...inputs,
    finance: { ...WORKING_FINANCE, lenderCosts: inputs.finance.lenderCosts },
    structure: "bridging-refurb-refinance",
    exit: "refinance-and-hold",
    holdMonths: 9,
  };

  // Let the Router pick the shape, then price that shape at its ceiling.
  const router = routeStrategies(structured);
  const best = router.best;

  const shaped: DealInputs =
    best === undefined
      ? structured
      : { ...structured, structure: best.candidate.structure, exit: best.candidate.exit };

  const ceiling = maxViablePrice(shaped, TARGET_MARGIN_BPS);

  if (ceiling <= 0) {
    return {
      inputs: shaped,
      modelled: true,
      note: "No price produces an acceptable margin on these figures. The deal is shown unpriced.",
    };
  }

  return {
    inputs: { ...shaped, purchasePrice: ceiling },
    modelled: true,
    note: `No price has been agreed. Modelled at the maximum a buyer could pay while clearing a ${TARGET_MARGIN_BPS / 100}% margin, using the structure the Router ranked first.`,
  };
}
