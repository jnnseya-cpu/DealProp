import { applyBps, bps, isZero, money, sub, type Bps, type Money } from "@shared/money";
import type { DealInputs } from "@shared/domain/types";
import { appraise, maxViablePrice } from "@shared/domain/economics";
import { assessSellerProtection, type ProtectionFlag } from "@shared/domain/protection";
import { buildSellerRoutes, type SellerRoutesReport } from "@shared/domain/sellerRoutes";
import { DEFAULT_MIN_MARGIN } from "@shared/domain/matching";

/**
 * Negotiating a purchase price, computed rather than improvised.
 *
 * The hard part of negotiation is not the words. It is knowing, before the
 * conversation starts, the highest price at which the deal still works — and
 * then not going past it. A negotiator without that number concedes under
 * pressure, because every individual concession feels small. That is the
 * failure this module exists to prevent, and it is why the walk-away is
 * computed from the engine rather than set by whoever is negotiating.
 *
 * Three numbers, in this order of importance:
 *
 *  - **Walk-away.** `maxViablePrice()` at the target margin. Above it the deal
 *    does not clear the margin the buyer requires, so there is nothing to
 *    discuss. This is a ceiling and never a target.
 *  - **Floor.** What the seller could plainly get elsewhere. Offering below it
 *    wastes everybody's time and, where the seller is under pressure, is the
 *    behaviour this platform exists not to have.
 *  - **Opening.** Inside the band, defensible, and stated with the reasoning
 *    that produced it.
 *
 * Every position carries what the seller actually receives, because a price is
 * meaningless to them without the completion date and the certainty attached to
 * it. A slower £10,000 more is worse than a faster £10,000 less to somebody
 * facing a deadline, and only the seller can weigh that.
 *
 * **Seller Protection runs first and can stop this outright.** Where it blocks,
 * there is no negotiation position at all — not a cautious one.
 */

/** The margin the buyer requires. Below this there is no deal to negotiate. */
export const TARGET_MARGIN: Bps = DEFAULT_MIN_MARGIN;

/**
 * How far below the open-market value an opening offer may sit.
 *
 * Wide enough to be a real acquisition discount, narrow enough not to be an
 * insult that ends the conversation. It is a starting point and is capped by
 * the walk-away in every case.
 */
const OPENING_DISCOUNT: Bps = bps(2_200);

/**
 * The floor, as a share of what the seller could get on the open market.
 *
 * Below this the offer is not a negotiating position, it is an attempt to find
 * somebody desperate enough to accept it. The platform declines to compute one.
 */
const FLOOR_OF_MARKET: Bps = bps(6_500);

/**
 * Room kept between the opening offer and the walk-away.
 *
 * Without it the opening lands on the ceiling whenever the discount the buyer
 * wants is smaller than the discount the deal needs — and a negotiator who
 * opens at their maximum has nowhere to go except backwards. The first version
 * of this module did exactly that: on a deal where 22% off market was above the
 * viable price, it opened at the walk-away and every subsequent move was a
 * concession it could not afford.
 */
const NEGOTIATING_ROOM: Bps = bps(500);

export type PositionKind = "opening" | "target" | "walk-away" | "floor";

export interface Position {
  readonly kind: PositionKind;
  readonly price: Money;
  /** Margin on GDV the buyer keeps at this price. */
  readonly marginBps: Bps;
  /** What the seller receives on completion at this price. */
  readonly toSeller: Money;
  /** Always populated. A price with no reasoning is a number somebody made up. */
  readonly reason: string;
}

export interface NegotiationBand {
  readonly blocked: boolean;
  /**
   * True where the seller can plainly do better elsewhere.
   *
   * Not a blocker — they may still prefer the speed and the certainty — but it
   * is the fact that decides whether this is worth pursuing, and stating the
   * two numbers without drawing the conclusion leaves somebody to miss it.
   */
  readonly outbidByAlternative: boolean;
  /** Populated where protection stops the negotiation before it starts. */
  readonly blockedReason?: string;
  readonly positions: readonly Position[];
  readonly opening?: Position;
  readonly walkAway?: Position;
  readonly floor?: Position;
  /** What the seller could take instead, so the offer can be put in context. */
  readonly alternatives: SellerRoutesReport;
  readonly summary: string;
  readonly disclosures: readonly string[];
}

function positionAt(inputs: DealInputs, price: Money, kind: PositionKind, reason: string): Position {
  const appraisal = appraise({ ...inputs, purchasePrice: price });
  return {
    kind,
    price,
    marginBps: appraisal.marginOnGdvBps,
    // On a cash purchase the seller receives the price. Where a route defers
    // part of it, `alternatives` carries the split; this is the headline.
    toSeller: price,
    reason,
  };
}

/**
 * Build the negotiating band for one deal.
 *
 * Returns positions rather than a script. What to say is a person's job; what
 * the numbers are is not, and the number that matters most is the one that says
 * stop.
 */
export function negotiationBand(
  inputs: DealInputs,
  targetMargin: Bps = TARGET_MARGIN,
): NegotiationBand {
  const protection = assessSellerProtection(inputs);
  const alternatives = buildSellerRoutes(inputs.property, inputs.seller);

  if (protection.blocked) {
    // Not a cautious position. None.
    return {
      blocked: true,
      outbidByAlternative: false,
      blockedReason: protection.flags
        .filter((f: ProtectionFlag) => f.severity === "block")
        .map((f: ProtectionFlag) => f.detail)
        .join(" "),
      positions: [],
      alternatives,
      summary:
        "Seller Protection blocks this deal, so there is no price to negotiate. Clear the flags or walk away; do not approach the seller with an offer in the meantime.",
      disclosures: protection.requiredDisclosures,
    };
  }

  const market = inputs.property.openMarketValue;
  const walkAwayPrice = maxViablePrice(inputs, targetMargin);
  const floorPrice = applyBps(market, FLOOR_OF_MARKET);

  if (isZero(walkAwayPrice) || walkAwayPrice <= 0) {
    return {
      blocked: true,
      outbidByAlternative: false,
      blockedReason: "No price clears the required margin.",
      positions: [],
      alternatives,
      summary:
        "There is no purchase price at which this deal clears the target margin. That is not a negotiation problem — the deal does not work at any price the seller would accept.",
      disclosures: protection.requiredDisclosures,
    };
  }

  if (walkAwayPrice < floorPrice) {
    // The buyer's ceiling is below what the seller could plainly get elsewhere.
    // Pursuing it means looking for somebody who does not know that.
    return {
      blocked: true,
      outbidByAlternative: false,
      blockedReason: `The highest price that works for the buyer is ${gbpish(walkAwayPrice)}, below the ${gbpish(floorPrice)} floor.`,
      positions: [],
      alternatives,
      summary: `The most this deal supports is ${gbpish(walkAwayPrice)}, which is under ${(FLOOR_OF_MARKET / 100).toFixed(0)}% of the ${gbpish(market)} market value. An offer that low is not a negotiating position; it is looking for somebody who does not know what their property is worth. Walk away.`,
      disclosures: protection.requiredDisclosures,
    };
  }

  // Opening sits at the discount, and always leaves room below the ceiling.
  // A first offer the buyer cannot afford to honour is worse than no offer;
  // an opening that *is* the ceiling is worse still, because every move after
  // it costs margin the deal needs.
  const discounted = sub(market, applyBps(market, OPENING_DISCOUNT));
  const withRoom = sub(walkAwayPrice, applyBps(walkAwayPrice, NEGOTIATING_ROOM));
  const openingPrice = money(Math.max(floorPrice, Math.min(discounted, withRoom)));
  const targetPrice = money(Math.min(walkAwayPrice, Math.round((openingPrice + walkAwayPrice) / 2)));

  const positions: Position[] = [
    positionAt(
      inputs,
      openingPrice,
      "opening",
      `Opens at ${(OPENING_DISCOUNT / 100).toFixed(0)}% below the ${gbpish(market)} market value, or the walk-away if that is lower. A first offer the buyer could not honour is worse than none.`,
    ),
    positionAt(
      inputs,
      targetPrice,
      "target",
      "Where this is expected to settle. Between the opening and the ceiling, and still clears the required margin.",
    ),
    positionAt(
      inputs,
      walkAwayPrice,
      "walk-away",
      `The highest price at which the deal still returns ${(targetMargin / 100).toFixed(0)}% on value. Above this there is nothing to discuss, however far the conversation has gone.`,
    ),
    positionAt(
      inputs,
      floorPrice,
      "floor",
      `${(FLOOR_OF_MARKET / 100).toFixed(0)}% of market value. Below this an offer stops being a position and starts being an attempt to find somebody who has not taken advice.`,
    ),
  ];

  const opening = positions[0];
  const walkAway = positions[2];
  const floor = positions[3];

  const best = alternatives.best;
  const outbid = best !== undefined && best.totalToSeller > walkAwayPrice;

  return {
    blocked: false,
    outbidByAlternative: outbid,
    positions,
    ...(opening !== undefined ? { opening } : {}),
    ...(walkAway !== undefined ? { walkAway } : {}),
    ...(floor !== undefined ? { floor } : {}),
    alternatives,
    summary: outbid
      ? `The seller's best alternative here pays ${gbpish(best.totalToSeller)} — more than the ${gbpish(walkAwayPrice)} this deal can support. Offering less than they can plainly get elsewhere is not a negotiation, and pressing it would mean hoping they do not know. Point them at ${best.label} instead.`
      : openingPrice >= walkAwayPrice
        ? `The band is too thin to negotiate in: the floor of ${gbpish(floorPrice)} is at or above the ${gbpish(walkAwayPrice)} ceiling. Offer the ceiling once, plainly, and accept the answer.`
        : `Open at ${gbpish(openingPrice)}, expect ${gbpish(targetPrice)}, stop at ${gbpish(walkAwayPrice)}. The seller's best alternative on this platform pays ${best === undefined ? "nothing recorded" : gbpish(best.totalToSeller)}.`,
    disclosures: protection.requiredDisclosures,
  };
}

/* ------------------------------------------------------------- responding */

export type Move = "accept" | "counter" | "hold" | "walk-away";

export interface Response {
  readonly move: Move;
  /** Present on a counter. */
  readonly counterAt?: Money;
  readonly reason: string;
  /** What must be said to the seller alongside this, where anything must. */
  readonly disclosures: readonly string[];
}

/**
 * What to do about a price the seller has asked for.
 *
 * Deterministic, and deliberately unwilling to creep. A counter moves at most
 * halfway from the current position towards the seller's number and never past
 * the walk-away — because the way a negotiator loses a deal's margin is not one
 * bad decision, it is six small ones each of which looked reasonable.
 *
 * `accept` where the asking price already works is not a weakness. Grinding a
 * seller who has named a workable number costs goodwill, costs time, and is how
 * a deal that would have completed falls through.
 */
export function respondTo(
  band: NegotiationBand,
  sellerAsking: Money,
  currentOffer: Money,
): Response {
  if (band.blocked || band.walkAway === undefined || band.floor === undefined) {
    return {
      move: "walk-away",
      reason: band.blockedReason ?? "There is no negotiating band for this deal.",
      disclosures: band.disclosures,
    };
  }

  const ceiling = band.walkAway.price;

  if (sellerAsking <= currentOffer) {
    return {
      move: "accept",
      reason: `The seller is asking ${gbpish(sellerAsking)}, at or below the ${gbpish(currentOffer)} already offered. Accept it.`,
      disclosures: band.disclosures,
    };
  }

  if (sellerAsking <= ceiling) {
    return {
      move: "accept",
      reason: `${gbpish(sellerAsking)} is within the ${gbpish(ceiling)} ceiling and still clears the required margin. Grinding a seller who has named a workable number is how a deal that would have completed falls through.`,
      disclosures: band.disclosures,
    };
  }

  const halfway = money(Math.round((currentOffer + Math.min(sellerAsking, ceiling)) / 2));
  const next = money(Math.min(halfway, ceiling));

  if (next <= currentOffer) {
    return {
      move: "walk-away",
      reason: `The seller wants ${gbpish(sellerAsking)}. The most this deal supports is ${gbpish(ceiling)}, and there is no room left to move. Say so plainly and leave the door open.`,
      disclosures: band.disclosures,
    };
  }

  const gap = sub(sellerAsking, ceiling);
  return {
    move: "counter",
    counterAt: next,
    reason: `Counter at ${gbpish(next)}. The seller is ${gbpish(gap)} above the ${gbpish(ceiling)} ceiling, so this cannot close at their number — moving halfway keeps the conversation going without conceding past the point where the deal stops working.`,
    disclosures: band.disclosures,
  };
}

/**
 * How an offer compares to what the seller could get elsewhere.
 *
 * Included in every approach, because an offer below market value is only
 * defensible if the seller can see what they are being paid for — speed,
 * certainty, no fees, no chain — and decide for themselves whether that is
 * worth the difference. An offer presented without it is asking somebody to
 * accept less without telling them they are.
 */
export interface OfferContext {
  readonly offer: Money;
  readonly marketValue: Money;
  readonly discount: Money;
  readonly discountBps: Bps;
  readonly sentence: string;
}

export function contextFor(offer: Money, marketValue: Money, completionDays: number): OfferContext {
  const discount = sub(marketValue, offer);
  const share = marketValue <= 0 ? bps(0) : bps(Math.round((discount / marketValue) * 10_000));

  return {
    offer,
    marketValue,
    discount,
    discountBps: share,
    sentence:
      discount <= 0
        ? `This offer of ${gbpish(offer)} is at or above the ${gbpish(marketValue)} we assess the property to be worth.`
        : `This offer of ${gbpish(offer)} is ${gbpish(discount)} below the ${gbpish(marketValue)} we assess your property to be worth on the open market — ${(share / 100).toFixed(0)}% less. What you get for that difference is completion in about ${completionDays} days, no estate agent fee, no chain, and no viewings. Selling through an agent would very likely get you more money and take longer. You should take independent advice before accepting.`,
  };
}

/** Formatted here so a stored reason does not depend on a page's formatting. */
function gbpish(value: Money): string {
  return `£${Math.round(value / 100).toLocaleString("en-GB")}`;
}
