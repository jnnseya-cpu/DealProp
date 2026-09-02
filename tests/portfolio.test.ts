import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, ZERO } from "@shared/money";
import type { PropertyFacts } from "@shared/domain/types";
import {
  holdingPosition,
  portfolioPosition,
  refinanceWindow,
  REFINANCE_LEAD_DAYS,
  releaseEstimate,
  SEASONING_MONTHS,
  toHolding,
  type Holding,
  type HoldingFacts,
} from "@shared/domain/portfolio";

/**
 * Portfolio OS.
 *
 * Two failures decide the tests worth having. Carrying the appraisal's
 * post-works value forward as though the works happened and a valuer agreed,
 * which every figure downstream then inherits. And arriving at a facility's
 * term end with no exit arranged, where the cheapest remaining option is an
 * extension fee.
 */

const NOW = new Date("2026-09-01T00:00:00.000Z");

const property: PropertyFacts = {
  id: "p",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  openMarketValue: fromMajor(212_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(34_000),
  postWorksValue: fromMajor(285_000),
  monthlyRent: fromMajor(1_250),
  knownIssues: [],
};

function holding(facts: Partial<HoldingFacts> = {}): Holding {
  return toHolding({
    id: "deal-1",
    reference: "LODE-0001",
    property,
    purchasePrice: fromMajor(172_000),
    facts: { completedAt: "2026-01-15T00:00:00.000Z", ...facts },
  });
}

describe("a figure is evidenced or it is an assumption", () => {
  it("values an unvalued holding at what was paid, and says so", () => {
    // The most tempting mistake available here is carrying the appraisal's
    // post-works value forward as though the works happened and a valuer
    // agreed. Every figure downstream inherits it.
    const held = holding({ spent: fromMajor(34_000) });
    expect(held.currentValue).toBe(fromMajor(172_000));
    expect(held.currentValue).not.toBe(property.postWorksValue);
    expect(held.valuationBasis).toBe("purchase-price");

    const position = holdingPosition(held);
    expect(position.restsOnAnUnverifiedValue).toBe(true);
    expect(position.caveat).toContain("stale");
  });

  it("takes a valuation only with a figure, a date and a valuer", () => {
    const valued = holding({
      valuation: fromMajor(285_000),
      valuedAt: "2026-08-01T00:00:00.000Z",
      valuer: "Marsh Surveyors",
    });
    expect(valued.valuationBasis).toBe("valued");
    expect(holdingPosition(valued).restsOnAnUnverifiedValue).toBe(false);

    // A figure with no date behind it is an opinion, and the portfolio would
    // present it as evidence.
    const dateless = holding({ valuation: fromMajor(285_000) });
    expect(dateless.valuationBasis).toBe("purchase-price");
    expect(dateless.currentValue).toBe(fromMajor(172_000));
  });

  it("never calls a valuation a guaranteed figure", () => {
    const valued = holdingPosition(
      holding({
        valuation: fromMajor(285_000),
        valuedAt: "2026-08-01T00:00:00.000Z",
        valuer: "Marsh",
      }),
    );
    expect(valued.caveat).toContain("not a guaranteed figure");
  });

  it("computes equity, LTV and yield from what is recorded", () => {
    const position = holdingPosition(
      holding({
        valuation: fromMajor(280_000),
        valuedAt: "2026-08-01T00:00:00.000Z",
        valuer: "Marsh",
        spent: fromMajor(28_000),
        debt: fromMajor(140_000),
        debtRateBps: pct(6),
        monthlyRent: fromMajor(1_400),
      }),
    );
    expect(position.totalCost).toBe(fromMajor(200_000));
    expect(position.equity).toBe(fromMajor(140_000));
    expect(position.ltvBps).toBe(pct(50));
    // £16,800 a year against £200,000 of cost.
    expect(position.yieldOnCostBps).toBe(pct(8.4));
    // £1,400 rent less £700 of monthly interest.
    expect(position.monthlyNet).toBe(fromMajor(700));
  });

  it("reports a negative monthly position rather than flooring it at zero", () => {
    const position = holdingPosition(
      holding({ debt: fromMajor(150_000), debtRateBps: pct(12), monthlyRent: fromMajor(900) }),
    );
    expect(position.monthlyNet).toBeLessThan(ZERO);
  });
});

describe("the refinance window", () => {
  it("holds while the property is too recently bought", () => {
    // Most term lenders lend against the purchase price rather than a new
    // valuation before this, which is what a refurbishment needs them not to.
    const fresh = refinanceWindow(
      holding({
        completedAt: "2026-08-01T00:00:00.000Z",
        debt: fromMajor(140_000),
        facilityEndsAt: "2027-08-01T00:00:00.000Z",
      }),
      NOW,
    );
    expect(fresh.state).toBe("seasoning");
    expect(fresh.seasonedAt.slice(0, 10)).toBe("2027-02-01");
    expect(SEASONING_MONTHS).toBe(6);
  });

  it("opens once seasoned, with the date work has to start", () => {
    const open = refinanceWindow(
      holding({ debt: fromMajor(140_000), facilityEndsAt: "2027-01-15T00:00:00.000Z" }),
      NOW,
    );
    expect(open.state).toBe("open");
    expect(open.startBy?.slice(0, 10)).toBe("2026-10-17");
    expect(REFINANCE_LEAD_DAYS).toBe(90);
  });

  it("turns urgent at the lead time, not at the term end", () => {
    // A valuation takes a month to book and arrive and legals four to six
    // weeks. Waiting until the end is how a sponsor pays an extension fee on a
    // case that was always going to refinance.
    const urgent = refinanceWindow(
      holding({ debt: fromMajor(140_000), facilityEndsAt: "2026-10-15T00:00:00.000Z" }),
      NOW,
    );
    expect(urgent.state).toBe("urgent");
    expect(urgent.advice).toContain("should already be under way");
  });

  it("says plainly when the facility has already ended", () => {
    const late = refinanceWindow(
      holding({ debt: fromMajor(140_000), facilityEndsAt: "2026-07-01T00:00:00.000Z" }),
      NOW,
    );
    expect(late.state).toBe("overdue");
    expect(late.advice).toContain("on the lender's terms now");
  });

  it("asks for a term where there is debt and no end date recorded", () => {
    // A bridge with no end date in the system is a bridge nobody is counting
    // down, and the countdown is the whole point.
    const dateless = refinanceWindow(holding({ debt: fromMajor(140_000) }), NOW);
    expect(dateless.state).toBe("unencumbered");
    expect(dateless.advice).toContain("nobody is counting down");
  });

  it("has nothing to say about a property with no debt", () => {
    const clear = refinanceWindow(holding(), NOW);
    expect(clear.state).toBe("unencumbered");
    expect(clear.advice).toContain("nothing to refinance");
  });
});

describe("what a refinance would release", () => {
  it("estimates the advance and what is left after the bridge", () => {
    const release = releaseEstimate(
      holding({
        valuation: fromMajor(280_000),
        valuedAt: "2026-08-01T00:00:00.000Z",
        valuer: "Marsh",
        debt: fromMajor(140_000),
      }),
      pct(75),
    );
    expect(release.newFacility).toBe(fromMajor(210_000));
    expect(release.released).toBe(fromMajor(70_000));
    expect(release.shortfall).toBe(false);
    expect(release.basis).not.toContain("no valuer has confirmed");
  });

  it("says a projected release is projected, every time it appears", () => {
    // A sponsor who plans the next purchase on a release that never arrives
    // has a deposit-shaped hole and a property under offer.
    const release = releaseEstimate(holding({ debt: fromMajor(140_000) }), pct(75));
    expect(release.basis).toContain("no valuer has confirmed");
  });

  it("reports a shortfall rather than a negative release dressed as a gain", () => {
    const release = releaseEstimate(holding({ debt: fromMajor(160_000) }), pct(75));
    expect(release.shortfall).toBe(true);
    expect(release.released).toBeLessThan(ZERO);
  });
});

describe("the portfolio as a whole", () => {
  it("puts what needs attention first, soonest first", () => {
    const position = portfolioPosition(
      [
        holding({ debt: fromMajor(100_000), facilityEndsAt: "2026-10-20T00:00:00.000Z" }),
        holding({ debt: fromMajor(100_000), facilityEndsAt: "2026-07-01T00:00:00.000Z" }),
        holding({ debt: fromMajor(100_000), facilityEndsAt: "2028-01-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(position.needingAttention).toHaveLength(2);
    expect(position.needingAttention[0]?.window.state).toBe("overdue");
  });

  it("counts how many figures rest on a value nobody verified", () => {
    const position = portfolioPosition(
      [
        holding(),
        holding({ valuation: fromMajor(280_000), valuedAt: "2026-08-01T00:00:00.000Z", valuer: "M" }),
      ],
      NOW,
    );
    expect(position.unverifiedCount).toBe(1);
    expect(position.summary).toContain("an assumption");
  });

  it("says plainly when nothing is held", () => {
    const empty = portfolioPosition([], NOW);
    expect(empty.summary).toContain("Nothing held yet");
    expect(empty.totalEquity).toBe(ZERO);
  });
});
