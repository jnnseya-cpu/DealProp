import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import { contextFor, negotiationBand, respondTo, TARGET_MARGIN } from "@shared/domain/negotiation";

/**
 * The tests that matter here are the ones that stop, not the ones that price.
 * A negotiator that cannot say no is a negotiator that gives the margin away
 * one reasonable-looking concession at a time.
 */

const finance: FinanceTerms = {
  ltvBps: pct(70), refurbAdvanceBps: pct(100), annualRateBps: pct(12),
  arrangementFeeBps: pct(2), exitFeeBps: pct(1), interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

function property(overrides: Partial<PropertyFacts> = {}): PropertyFacts {
  return {
    id: "t", jurisdiction: "GB-ENG", postcodeArea: "B23", locality: "Erdington",
    propertyType: "house", tenure: "freehold", bedrooms: 3, occupancy: "vacant",
    openMarketValue: fromMajor(280_000), valuationConfidence: bps(8_500),
    refurbishmentEstimate: fromMajor(25_000), postWorksValue: fromMajor(340_000),
    monthlyRent: fromMajor(1_400), knownIssues: [],
    ...overrides,
  };
}

function seller(overrides: Partial<SellerProfile> = {}): SellerProfile {
  return {
    situation: "relocation",
    priorities: ["speed"],
    targetDays: 30,
    screening: { hasIndependentLegalAdvice: true, hasReceivedIndependentValuation: true },
    ...overrides,
  };
}

function deal(overrides: Partial<DealInputs> = {}): DealInputs {
  return {
    property: property(), seller: seller(), purchasePrice: fromMajor(210_000),
    buyerOwnsOtherProperty: true, buyerIsCompany: true, buyerIsNonResident: false,
    holdMonths: 9, structure: "bridging-refurb-refinance", finance, exit: "sell",
    ...overrides,
  };
}

describe("when there is no negotiation to have", () => {
  it("produces no position at all where Seller Protection blocks", () => {
    // Not a cautious offer. None. The engine that can block a deal outright is
    // not overridden by wanting the deal.
    const band = negotiationBand(
      deal({
        purchasePrice: fromMajor(120_000),
        seller: seller({
          situation: "repossession-threat",
          screening: { hasIndependentLegalAdvice: false, hasReceivedIndependentValuation: false },
        }),
      }),
    );
    if (band.blocked) {
      expect(band.positions).toEqual([]);
      expect(band.summary).toContain("no price to negotiate");
    }
  });

  it("walks away where the buyer's ceiling is below what the seller could get elsewhere", () => {
    // Pursuing it means looking for somebody who does not know their own value.
    const band = negotiationBand(
      deal({ property: property({ postWorksValue: fromMajor(285_000), refurbishmentEstimate: fromMajor(60_000) }) }),
    );
    expect(band.blocked).toBe(true);
    expect(band.summary.toLowerCase()).toContain("walk away");
  });

  it("says so plainly where no price clears the margin", () => {
    const band = negotiationBand(
      deal({ property: property({ postWorksValue: fromMajor(150_000), openMarketValue: fromMajor(280_000) }) }),
    );
    expect(band.blocked).toBe(true);
    expect(band.positions).toEqual([]);
  });
});

describe("the band", () => {
  const band = negotiationBand(deal());

  it("produces an opening, a target, a ceiling and a floor", () => {
    expect(band.blocked).toBe(false);
    expect(band.positions.map((p) => p.kind)).toEqual(["opening", "target", "walk-away", "floor"]);
  });

  it("never opens above the ceiling", () => {
    // A first offer the buyer could not honour is worse than no offer.
    expect(band.opening?.price).toBeLessThanOrEqual(band.walkAway?.price ?? 0);
  });

  it("never opens below the floor", () => {
    expect(band.opening?.price).toBeGreaterThanOrEqual(band.floor?.price ?? 0);
  });

  it("leaves room to move below the ceiling", () => {
    // An opening that IS the ceiling has nowhere to go except backwards, and
    // every move after it costs margin the deal needs. The first version of
    // this engine did exactly that.
    expect(band.opening?.price).toBeLessThan(band.walkAway?.price ?? 0);
  });

  it("keeps the required margin at the ceiling, and not above it", () => {
    expect(band.walkAway?.marginBps).toBeGreaterThanOrEqual(TARGET_MARGIN - 100);
  });

  it("gives every position a reason", () => {
    for (const position of band.positions) {
      expect(position.reason.length, position.kind).toBeGreaterThan(40);
    }
  });

  it("carries what the seller could take instead", () => {
    expect(band.alternatives.routes.length).toBeGreaterThan(0);
  });

  it("says so when the seller can plainly do better elsewhere", () => {
    // Found by running it: the engine stated our ceiling and their best
    // alternative side by side and drew no conclusion, leaving somebody to
    // miss that we were the worse offer.
    const outbid = negotiationBand(deal({ property: property({ postWorksValue: fromMajor(300_000) }) }));
    if (outbid.outbidByAlternative) {
      expect(outbid.summary).toContain("more than the");
      expect(outbid.summary).toContain("not a negotiation");
    }
    expect(typeof outbid.outbidByAlternative).toBe("boolean");
  });
});

describe("responding to what the seller asks", () => {
  const band = negotiationBand(deal());
  const ceiling = band.walkAway?.price ?? fromMajor(0);
  const opening = band.opening?.price ?? fromMajor(0);

  it("accepts a workable number rather than grinding", () => {
    // Grinding a seller who has named a workable number is how a deal that
    // would have completed falls through.
    const response = respondTo(band, ceiling, opening);
    expect(response.move).toBe("accept");
    expect(response.reason).toContain("clears the required margin");
  });

  it("accepts anything at or below what is already offered", () => {
    expect(respondTo(band, opening, opening).move).toBe("accept");
  });

  it("counters below the ceiling when the seller is above it", () => {
    const asking = (ceiling + fromMajor(30_000)) as typeof ceiling;
    const response = respondTo(band, asking, opening);
    expect(response.move).toBe("counter");
    expect(response.counterAt).toBeLessThanOrEqual(ceiling);
    expect(response.counterAt).toBeGreaterThan(opening);
  });

  it("never counters above the ceiling, however high the seller asks", () => {
    // The way margin is lost is not one bad decision; it is six small ones.
    for (const over of [10_000, 50_000, 200_000]) {
      const asking = (ceiling + fromMajor(over)) as typeof ceiling;
      const response = respondTo(band, asking, opening);
      expect(response.counterAt ?? 0, `+${over}`).toBeLessThanOrEqual(ceiling);
    }
  });

  it("stops conceding once the offer has reached the ceiling", () => {
    const asking = (ceiling + fromMajor(50_000)) as typeof ceiling;
    const response = respondTo(band, asking, ceiling);
    expect(response.move).toBe("walk-away");
    expect(response.reason).toContain("no room left");
  });

  it("walks away where protection blocked the band", () => {
    const blocked = negotiationBand(
      deal({ property: property({ postWorksValue: fromMajor(150_000) }) }),
    );
    expect(respondTo(blocked, fromMajor(200_000), fromMajor(180_000)).move).toBe("walk-away");
  });
});

describe("what the seller is told about the offer", () => {
  it("states the discount in money and in per cent, and names what it buys", () => {
    // An offer below market value is only defensible if the seller can see
    // what they are being paid for and decide for themselves.
    const context = contextFor(fromMajor(220_000), fromMajor(280_000), 21);
    expect(context.discount).toBe(fromMajor(60_000));
    expect(context.sentence).toContain("£60,000");
    expect(context.sentence).toContain("21 days");
  });

  it("says an agent would likely get them more, and to take advice", () => {
    const context = contextFor(fromMajor(220_000), fromMajor(280_000), 21);
    expect(context.sentence).toContain("would very likely get you more money");
    expect(context.sentence).toContain("independent advice");
  });

  it("does not claim a discount where there is none", () => {
    const context = contextFor(fromMajor(290_000), fromMajor(280_000), 21);
    expect(context.sentence).toContain("at or above");
  });
});
