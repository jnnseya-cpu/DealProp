import { bps, type Money } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import { borrowingCost, compareOffers, type BorrowingCost } from "@shared/domain/borrowing";
import type { DealInputs } from "@shared/domain/types";

/**
 * Comparing the offers actually received.
 *
 * The comparison is recomputed from the engine every time rather than stored,
 * because a stored total stops agreeing with the deal the moment the price or
 * the term changes — and the moment it disagrees, somebody picks a lender on a
 * figure that is no longer true.
 *
 * What is compared is the total cost and the net advance, never the headline
 * rate. A cheaper rate carrying a two per cent broker fee is dearer than a
 * higher rate carrying none over nine months, and the rate is the number every
 * lender leads with precisely because it flatters them.
 */

export interface OfferTerms {
  readonly id: string;
  readonly lender: string;
  readonly annualRateBps: number;
  readonly arrangementFeeBps: number;
  readonly brokerFeeBps: number;
  readonly exitFeeBps: number;
  readonly ltvBps: number;
  readonly lenderCosts: number;
  readonly interestRolledUp: boolean;
  readonly termMonths: number;
  readonly confidence: "indicative" | "credit-backed" | "valuation-backed" | "binding";
}

export interface ComparedOffer {
  readonly terms: OfferTerms;
  readonly cost: BorrowingCost;
  /** What reaches the completion account. */
  readonly netAdvance: Money;
  /** Cash the sponsor must find, given that advance. */
  readonly sponsorCash: Money;
  readonly confidence: OfferTerms["confidence"];
}

export interface OfferComparisonReport {
  readonly offers: readonly ComparedOffer[];
  /** Cheapest by total cost. Undefined where nothing has been received. */
  readonly cheapest?: ComparedOffer;
  /** Most cash on the day, which is not always the cheapest. */
  readonly largestAdvance?: ComparedOffer;
  readonly summary: string;
}

/**
 * Re-appraise the deal under each offer's terms and compare the results.
 *
 * Each offer is applied as a set of finance terms and run through the same cost
 * stack as everything else, so an offer cannot be compared on a different basis
 * from the deal it is for.
 */
export function compareRecordedOffers(
  inputs: DealInputs,
  offers: readonly OfferTerms[],
): OfferComparisonReport {
  if (offers.length === 0) {
    return {
      offers: [],
      summary: "No offers recorded. Ask for at least three, and compare the totals rather than the rates.",
    };
  }

  const compared: ComparedOffer[] = offers.map((terms) => {
    const appraisal = appraise({
      ...inputs,
      holdMonths: terms.termMonths,
      finance: {
        ...inputs.finance,
        ltvBps: bps(terms.ltvBps),
        annualRateBps: bps(terms.annualRateBps),
        arrangementFeeBps: bps(terms.arrangementFeeBps),
        brokerFeeBps: bps(terms.brokerFeeBps),
        exitFeeBps: bps(terms.exitFeeBps),
        interestRolledUp: terms.interestRolledUp,
        lenderCosts: terms.lenderCosts as Money,
      },
    });

    const cost = borrowingCost(appraisal);
    const deducted = cost.lines
      .filter((l) => l.deductedAtDrawdown)
      .reduce<number>((total, l) => total + l.amount, 0);
    const advance = Math.max(0, cost.facility - deducted);

    return {
      terms,
      cost,
      netAdvance: advance as Money,
      sponsorCash: Math.max(0, appraisal.costs.total - advance) as Money,
      confidence: terms.confidence,
    };
  });

  const cheapest = [...compared].sort((a, b) => a.cost.total - b.cost.total)[0];
  const largestAdvance = [...compared].sort((a, b) => b.netAdvance - a.netAdvance)[0];

  let summary: string;
  if (compared.length === 1) {
    summary = "One offer. Get two more before choosing — a single quote is a price, not a market.";
  } else if (cheapest !== undefined && largestAdvance !== undefined && cheapest.terms.id !== largestAdvance.terms.id) {
    // The genuinely useful finding: the cheapest loan is not always the one that
    // completes the purchase.
    summary = `${cheapest.terms.lender} costs least in total, but ${largestAdvance.terms.lender} puts more cash on the table on the day. If the completion statement is tight, the cheaper loan is the one that does not complete.`;
  } else if (cheapest !== undefined) {
    const rest = compared.filter((o) => o.terms.id !== cheapest.terms.id);
    const nearest = rest.sort((a, b) => a.cost.total - b.cost.total)[0];
    const gap =
      nearest === undefined ? undefined : compareOffers(
        { label: cheapest.terms.lender, cost: cheapest.cost },
        { label: nearest.terms.lender, cost: nearest.cost },
      );
    summary =
      gap === undefined
        ? `${cheapest.terms.lender} is cheapest in total.`
        : gap.reason;
  } else {
    summary = "Nothing to compare.";
  }

  return {
    offers: [...compared].sort((a, b) => a.cost.total - b.cost.total),
    ...(cheapest !== undefined ? { cheapest } : {}),
    ...(largestAdvance !== undefined ? { largestAdvance } : {}),
    summary,
  };
}
