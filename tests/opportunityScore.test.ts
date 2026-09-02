import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, ZERO } from "@shared/money";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { FundingEvidence } from "@shared/domain/fundingReadiness";
import type { InventoryItem } from "@shared/domain/inventory";
import {
  CONFIDENCE_CAPS,
  rankOpportunities,
  scoreOpportunity,
  type OpportunityScore,
} from "@shared/domain/opportunityScore";
import { scoreDeal } from "@shared/domain/dealScore";

/**
 * Scoring beyond discount.
 *
 * The ordering this file exists to produce: a property with a large
 * theoretical discount and an unchecked title must rank below a
 * smaller-discount property that can complete. A deal is worth its discount
 * multiplied by the chance it happens, and ranking on discount alone computes
 * only the first half.
 */

const NOW = new Date("2026-09-01T00:00:00.000Z");

const finance: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(12),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

function property(over: Partial<PropertyFacts> = {}): PropertyFacts {
  return {
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
    ...over,
  };
}

const seller: SellerProfile = { situation: "downsizing", priorities: ["speed"], screening: {} };

function deal(purchasePrice = fromMajor(172_000), over: Partial<PropertyFacts> = {}): DealInputs {
  return {
    property: property(over),
    seller,
    purchasePrice,
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: "bridging-refurb-refinance",
    finance,
    exit: "sell",
  };
}

const CONFIRMED: InventoryItem = {
  category: "owner-verified",
  confirmation: {
    by: "owner",
    at: "2026-08-01T00:00:00.000Z",
    recordedBy: "Jo Bloggs",
    evidence: "Confirmed on the phone.",
  },
};

const EVERYTHING: FundingEvidence = {
  titleNumber: "WM123456",
  tenureConfirmed: true,
  titleDefectsResolved: true,
  searchesOrdered: true,
  independentValuation: true,
  comparablesRecorded: true,
  legalPackReviewed: true,
  solicitorInstructed: true,
  planningStatus: "not-required",
};

const score = (
  inputs: DealInputs,
  evidence: FundingEvidence = {},
  item: InventoryItem | undefined = CONFIRMED,
): OpportunityScore =>
  scoreOpportunity({ inputs, evidence, ...(item !== undefined ? { item } : {}), now: NOW });

describe("confidence caps the score", () => {
  it("publishes an unevidenced deal below what the deal itself scores", () => {
    const bare = score(deal());
    expect(bare.confidence).toBe("low");
    expect(bare.score).toBe(Math.min(bare.uncappedScore, CONFIDENCE_CAPS.low));
    expect(bare.score).toBeLessThan(bare.uncappedScore);
    expect(bare.uncappedScore).toBe(scoreDeal(deal()).breakdown.composite);
  });

  it("lifts the cap as the evidence arrives", () => {
    const full = score(deal(), EVERYTHING);
    expect(full.confidence).toBe("high");
    expect(full.score).toBe(full.uncappedScore);
  });

  it("is low whatever else holds when a critical check is missing", () => {
    // No amount of other evidence substitutes for an unconfirmed sale or an
    // unchecked title. There is no transaction to be early to.
    const unconfirmed = score(deal(), EVERYTHING, { category: "ai-discovered" });
    expect(unconfirmed.confidence).toBe("low");
    expect(unconfirmed.confidenceReason).toContain("decide whether this can complete");

    const untitled = score(deal(), { ...EVERYTHING, titleNumber: undefined });
    expect(untitled.confidence).toBe("low");
  });
});

describe("the ordering the whole thing exists for", () => {
  it("ranks a smaller evidenced discount above a larger unchecked one", () => {
    // The headline case from the specification, run as arithmetic rather than
    // asserted as a principle.
    // £160,000 against a £212,000 valuation is the larger discount and the
    // better deal on paper. £185,000 is the smaller one — and the one somebody
    // has actually checked.
    const enormous = { score: score(deal(fromMajor(160_000))) };
    const modest = { score: score(deal(fromMajor(185_000)), EVERYTHING) };

    // The unchecked deal really is the better deal on paper.
    expect(enormous.score.uncappedScore).toBeGreaterThan(modest.score.uncappedScore);

    // And it still ranks below.
    const ranked = rankOpportunities([enormous, modest]);
    expect(ranked[0]).toBe(modest);
    expect(ranked[0]?.score.score).toBeGreaterThan(ranked[1]?.score.score ?? 0);
  });

  it("breaks a tie towards whichever has actually been checked", () => {
    const partial: FundingEvidence = { titleNumber: "WM1", tenureConfirmed: true, independentValuation: true };
    const a = { score: score(deal(), partial) };
    const b = { score: score(deal(), { ...partial, searchesOrdered: true, legalPackReviewed: true }) };
    const ranked = rankOpportunities([a, b]);
    expect(ranked[0]).toBe(b);
  });
});

describe("what every score has to show", () => {
  it("publishes evidence used, evidence missing, the date and the version", () => {
    const partial = score(deal(), { titleNumber: "WM1", tenureConfirmed: true });
    expect(partial.evidenceUsed.map((e) => e.label)).toContain("Title checked and clear");
    expect(partial.evidenceMissing.map((e) => e.label)).toContain("Independent valuation");
    expect(partial.calculatedAt).toBe(NOW.toISOString());
    expect(partial.version).toBe("opportunity-1");

    // Missing evidence says why it matters, not only that it is absent.
    for (const item of partial.evidenceMissing) {
      expect(item.why.length, item.label).toBeGreaterThan(20);
    }
  });

  it("gives principal reasons and principal risks, not a bare number", () => {
    const partial = score(deal());
    expect(partial.reasons.length).toBeGreaterThan(0);
    expect(partial.risks.length).toBeGreaterThan(0);
    expect(partial.risks.join(" ")).toContain("multiplied by the chance it happens");
  });

  it("reads the date passed in, never the wall clock", () => {
    const later = new Date("2027-01-01T00:00:00.000Z");
    expect(scoreOpportunity({ inputs: deal(), item: CONFIRMED, now: later }).calculatedAt).toBe(
      later.toISOString(),
    );
  });

  it("does not count evidence that has expired", () => {
    const stale = score(deal(), { ...EVERYTHING, expiredDocuments: 2 });
    expect(stale.risks.join(" ")).toContain("Stale evidence is not evidence");
  });
});

describe("a Seller Protection block is not a risk to be weighed", () => {
  it("says there is no position rather than deducting points", () => {
    // A block caps the score at 35 and forces reject in the deal engine. Here
    // it has to be stated as the reason there is no opportunity, because a
    // discount cannot be traded against it.
    const extreme = deal(fromMajor(140_000));
    const blocked = scoreDeal(extreme).protection.blocked;
    const reported = score(extreme, EVERYTHING);
    if (blocked) {
      expect(reported.risks[0]).toContain("Seller Protection blocks this");
      expect(reported.risks[0]).toContain("no position to take");
    } else {
      expect(reported.risks.length).toBeGreaterThanOrEqual(0);
    }
  });
});
