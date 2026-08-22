import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import { assessSellerProtection } from "@shared/domain/protection";
import { runRedTeam } from "@shared/domain/redteam";
import { scoreDeal } from "@shared/domain/dealScore";
import { buildCapitalStack, DEFAULT_PREFERENCES } from "@shared/domain/capitalStack";
import { buildExitMatrix, capitalRecycle, routeStrategies } from "@shared/domain/strategies";
import { categoriseHeat, diagnoseUnsold, scoreGoldMine, sellerPressure } from "@shared/domain/goldmine";
import { buildCloseReport, STANDARD_MILESTONES, type Milestone, type MilestoneStatus } from "@shared/domain/completion";
import { countInterestedBuyers, matchBuyBox, matchFundingBox } from "@shared/domain/matching";
import { SEED_BUY_BOXES, SEED_FUNDING_BOXES } from "@backend/store/seed";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { ListingSignal } from "@shared/domain/goldmine";

const finance: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(10),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

const property: PropertyFacts = {
  id: "test",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  openMarketValue: fromMajor(212_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(30_000),
  postWorksValue: fromMajor(285_000),
  monthlyRent: fromMajor(1_250),
  knownIssues: [],
};

const safeSeller: SellerProfile = {
  situation: "probate",
  priorities: ["speed", "certainty"],
  targetDays: 35,
  screening: {
    hasIndependentLegalAdvice: true,
    hasReceivedIndependentValuation: true,
    isSoleDecisionMaker: true,
    ageBand: "under-65",
  },
};

const inputs: DealInputs = {
  property,
  seller: safeSeller,
  purchasePrice: fromMajor(172_000),
  buyerOwnsOtherProperty: true,
  buyerIsCompany: true,
  buyerIsNonResident: false,
  holdMonths: 9,
  structure: "bridging-refurb-refinance",
  finance,
  exit: "refinance-and-hold",
};

describe("seller protection", () => {
  it("clears a well-safeguarded ordinary deal", () => {
    const result = assessSellerProtection(inputs);
    expect(result.blocked).toBe(false);
  });

  it("blocks an extreme discount", () => {
    const result = assessSellerProtection({ ...inputs, purchasePrice: fromMajor(120_000) });
    expect(result.blocked).toBe(true);
    expect(result.flags.some((f) => f.key === "extreme-discount")).toBe(true);
  });

  it("blocks when a capacity concern is reported, at any price", () => {
    const result = assessSellerProtection({
      ...inputs,
      purchasePrice: fromMajor(210_000),
      seller: { ...safeSeller, screening: { ...safeSeller.screening, reportsHealthOrCapacityConcern: true } },
    });
    expect(result.blocked).toBe(true);
  });

  it("blocks third-party pressure", () => {
    const result = assessSellerProtection({
      ...inputs,
      seller: { ...safeSeller, screening: { ...safeSeller.screening, isUnderTimePressureFromThirdParty: true } },
    });
    expect(result.blocked).toBe(true);
  });

  it("blocks an elderly seller taking a large discount", () => {
    const result = assessSellerProtection({
      ...inputs,
      purchasePrice: fromMajor(150_000),
      seller: { ...safeSeller, screening: { ...safeSeller.screening, ageBand: "80-plus" } },
    });
    expect(result.blocked).toBe(true);
    expect(result.flags.some((f) => f.key === "age-and-discount")).toBe(true);
  });

  it("treats missing safeguards as a reason for caution, not a pass", () => {
    const result = assessSellerProtection({
      ...inputs,
      seller: { ...safeSeller, screening: {} },
    });
    expect(result.flags.some((f) => f.key === "no-independent-advice")).toBe(true);
  });

  it("always requires the core disclosures", () => {
    const result = assessSellerProtection(inputs);
    expect(result.requiredDisclosures.length).toBeGreaterThanOrEqual(3);
    expect(result.requiredDisclosures.some((d) => d.includes("profit"))).toBe(true);
  });

  it("adds extra disclosures for creative structures", () => {
    const ordinary = assessSellerProtection(inputs);
    const creative = assessSellerProtection({ ...inputs, structure: "seller-finance" });
    expect(creative.requiredDisclosures.length).toBeGreaterThan(ordinary.requiredDisclosures.length);
  });
});

describe("red team", () => {
  it("runs every stress scenario", () => {
    const report = runRedTeam(inputs);
    expect(report.results.length).toBeGreaterThanOrEqual(9);
  });

  it("reduces profit under downside scenarios", () => {
    const report = runRedTeam(inputs);
    const severe = report.results.find((r) => r.stress.key === "severe");
    expect(severe).toBeDefined();
    expect(severe?.profit ?? 0).toBeLessThan(report.base.profit);
  });

  it("identifies capital loss scenarios on a thin deal", () => {
    const thin = runRedTeam({ ...inputs, purchasePrice: fromMajor(205_000) });
    expect(thin.lossScenarios.length).toBeGreaterThan(0);
    expect(thin.resilience).toBeLessThan(50);
  });

  it("caps resilience whenever capital can be lost", () => {
    const thin = runRedTeam({ ...inputs, purchasePrice: fromMajor(205_000) });
    expect(thin.resilience).toBeLessThanOrEqual(45);
  });
});

describe("deal score", () => {
  it("scores a sound deal well and explains every component", () => {
    const result = scoreDeal(inputs);
    expect(result.breakdown.composite).toBeGreaterThan(50);
    expect(result.breakdown.components.length).toBe(9);
    for (const c of result.breakdown.components) {
      expect(c.rationale.length).toBeGreaterThan(0);
    }
  });

  it("caps the score when the protection engine blocks the deal", () => {
    const blocked = scoreDeal({ ...inputs, purchasePrice: fromMajor(110_000) });
    expect(blocked.protection.blocked).toBe(true);
    expect(blocked.breakdown.composite).toBeLessThanOrEqual(35);
    expect(blocked.verdict).toBe("reject");
  });

  it("refuses to recommend a deal that makes no money", () => {
    const bad = scoreDeal({ ...inputs, purchasePrice: fromMajor(260_000) });
    expect(bad.appraisal.profit).toBeLessThanOrEqual(0);
    expect(["negotiate", "restructure", "reject"]).toContain(bad.verdict);
    expect(bad.breakdown.composite).toBeLessThanOrEqual(25);
  });

  it("weights sum to 100%", () => {
    const result = scoreDeal(inputs);
    const total = result.breakdown.components.reduce((t, c) => t + c.weightBps, 0);
    expect(total).toBe(10_000);
  });
});

describe("capital stack", () => {
  it("closes the funding gap with layered capital", () => {
    const appraisal = appraise(inputs);
    const stack = buildCapitalStack(appraisal, DEFAULT_PREFERENCES);
    expect(stack.totalRaised).toBe(stack.requirement);
    expect(stack.shortfall).toBe(0);
  });

  it("warns loudly when the originator contributes no cash", () => {
    const appraisal = appraise(inputs);
    const stack = buildCapitalStack(appraisal, DEFAULT_PREFERENCES);
    expect(stack.originatorCash).toBe(0);
    expect(stack.warnings.some((w) => w.includes("not free money"))).toBe(true);
  });

  it("warns about the regulated nature of private capital", () => {
    const appraisal = appraise(inputs);
    const stack = buildCapitalStack(appraisal, DEFAULT_PREFERENCES);
    expect(stack.warnings.some((w) => w.toLowerCase().includes("regulated"))).toBe(true);
  });

  it("reports infeasible when nothing is left for the originator", () => {
    const appraisal = appraise({ ...inputs, purchasePrice: fromMajor(240_000) });
    const stack = buildCapitalStack(appraisal, DEFAULT_PREFERENCES);
    expect(stack.feasible).toBe(false);
  });

  it("orders layers by repayment priority", () => {
    const appraisal = appraise(inputs);
    const stack = buildCapitalStack(appraisal, DEFAULT_PREFERENCES);
    const priorities = stack.layers.map((l) => l.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });
});

describe("strategy router", () => {
  it("tests many strategies and rejects most", () => {
    const report = routeStrategies(inputs);
    expect(report.tested).toBeGreaterThanOrEqual(14);
    expect(report.rejected.length).toBeGreaterThan(0);
  });

  it("explains why each strategy was rejected", () => {
    const report = routeStrategies(inputs);
    for (const r of report.rejected) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("marks structures it cannot model precisely as approximate", () => {
    const report = routeStrategies(inputs);
    const all = [...report.viable, ...report.needsReview, ...report.rejected];
    const leaseOption = all.find((r) => r.candidate.structure === "lease-option");
    expect(leaseOption?.fidelity).toBe("approximate");
  });

  it("respects jurisdiction bans", () => {
    const scottish = routeStrategies({
      ...inputs,
      property: { ...property, jurisdiction: "GB-SCT" },
    });
    const leaseOption = scottish.rejected.find((r) => r.candidate.structure === "lease-option");
    expect(leaseOption?.status).toBe("not-permitted");
  });

  it("routes regulated structures to review rather than straight to viable", () => {
    const report = routeStrategies(inputs);
    const sellerFinance = [...report.viable, ...report.needsReview].find(
      (r) => r.candidate.structure === "seller-finance",
    );
    if (sellerFinance !== undefined) {
      expect(sellerFinance.status).toBe("needs-review");
    }
  });
});

describe("exit matrix and capital recycling", () => {
  it("counts how many exits actually work", () => {
    const matrix = buildExitMatrix(inputs);
    expect(matrix.options.length).toBe(4);
    expect(matrix.viableCount).toBeGreaterThan(0);
  });

  it("flags a deal with only one way out as fragile", () => {
    const matrix = buildExitMatrix({ ...inputs, purchasePrice: fromMajor(215_000) });
    if (matrix.viableCount <= 1) {
      expect(matrix.fragile).toBe(true);
      expect(matrix.summary).toContain("FRAGILE");
    }
  });

  it("measures how much capital comes back on refinance", () => {
    const appraisal = appraise(inputs);
    const recycle = capitalRecycle(appraisal);
    expect(recycle.recycledBps).toBeGreaterThan(0);
    expect(recycle.verdict.length).toBeGreaterThan(0);
  });

  it("reports no recycling on a straight sale", () => {
    const appraisal = appraise({ ...inputs, exit: "sell" });
    const recycle = capitalRecycle(appraisal);
    expect(recycle.verdict).toContain("does not involve a refinance");
  });
});

describe("goldmine", () => {
  const listing: ListingSignal = {
    propertyId: "test",
    daysOnMarket: 412,
    initialAskingPrice: fromMajor(240_000),
    currentAskingPrice: fromMajor(199_950),
    priceReductions: 3,
    relistCount: 2,
    agentCount: 3,
    previouslyFailedSale: true,
    appearsVacant: true,
    photoCount: 5,
    hasFloorplan: false,
    localMedianDaysOnMarket: 82,
    localMedianAsking: fromMajor(205_000),
  };

  it("categorises heat by time and failure history", () => {
    expect(categoriseHeat({ ...listing, daysOnMarket: 30, relistCount: 0, previouslyFailedSale: false })).toBe("cold");
    expect(categoriseHeat({ ...listing, daysOnMarket: 120, relistCount: 0, previouslyFailedSale: false })).toBe("warm");
    expect(categoriseHeat({ ...listing, daysOnMarket: 200, relistCount: 0, previouslyFailedSale: false })).toBe("hot");
    expect(categoriseHeat({ ...listing, daysOnMarket: 300, relistCount: 0, previouslyFailedSale: false })).toBe("very-hot");
    expect(categoriseHeat({ ...listing, daysOnMarket: 400, relistCount: 0, previouslyFailedSale: false })).toBe("goldmine");
    expect(categoriseHeat(listing)).toBe("deep-gold");
  });

  it("scores a struggling listing as high pressure", () => {
    const pressure = sellerPressure(listing);
    expect(pressure.score).toBeGreaterThan(60);
    expect(pressure.factors.length).toBeGreaterThan(3);
  });

  it("scores a fresh listing as low pressure", () => {
    const pressure = sellerPressure({
      ...listing,
      daysOnMarket: 14,
      priceReductions: 0,
      relistCount: 0,
      agentCount: 1,
      previouslyFailedSale: false,
      appearsVacant: false,
      initialAskingPrice: fromMajor(205_000),
      currentAskingPrice: fromMajor(205_000),
    });
    expect(pressure.score).toBeLessThan(20);
  });

  it("diagnoses why a property has not sold, normalised to 100", () => {
    const reasons = diagnoseUnsold(listing, property);
    const total = reasons.reduce((t, r) => t + r.weight, 0);
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  it("produces a negotiating range below market value", () => {
    const result = scoreGoldMine(listing, property);
    expect(result.openingOffer).toBeLessThan(result.negotiationFloor);
    expect(result.negotiationFloor).toBeLessThan(result.negotiationCeiling);
    expect(result.negotiationCeiling).toBeLessThan(property.openMarketValue);
  });
});

describe("matching", () => {
  it("returns the criteria behind every match", () => {
    const scored = scoreDeal(inputs);
    const box = SEED_BUY_BOXES[0];
    if (box === undefined) throw new Error("seed buy box missing");
    const match = matchBuyBox(box, scored);
    expect(match.criteria.length).toBeGreaterThan(5);
    expect(match.criteria.every((c) => c.detail.length > 0)).toBe(true);
  });

  it("scores zero and lists blockers when a hard criterion fails", () => {
    const scored = scoreDeal(inputs);
    const box = SEED_BUY_BOXES[0];
    if (box === undefined) throw new Error("seed buy box missing");
    const match = matchBuyBox({ ...box, minPrice: fromMajor(500_000), maxPrice: fromMajor(900_000) }, scored);
    expect(match.eligible).toBe(false);
    expect(match.score).toBe(0);
    expect(match.blockers.length).toBeGreaterThan(0);
  });

  it("never matches a protection-blocked deal to anyone", () => {
    const blocked = scoreDeal({ ...inputs, purchasePrice: fromMajor(110_000) });
    for (const box of SEED_BUY_BOXES) {
      expect(matchBuyBox(box, blocked).eligible).toBe(false);
    }
    for (const box of SEED_FUNDING_BOXES) {
      expect(matchFundingBox(box, blocked, 10).eligible).toBe(false);
    }
  });

  it("enforces lender LTV ceilings", () => {
    const scored = scoreDeal({ ...inputs, finance: { ...finance, ltvBps: pct(78) } });
    const box = SEED_FUNDING_BOXES[0];
    if (box === undefined) throw new Error("seed funding box missing");
    const match = matchFundingBox(box, scored, 10);
    expect(match.blockers.some((b) => b.includes("LTV"))).toBe(true);
  });

  it("enforces borrower experience minimums", () => {
    const scored = scoreDeal(inputs);
    const box = SEED_FUNDING_BOXES[1];
    if (box === undefined) throw new Error("seed funding box missing");
    const match = matchFundingBox(box, scored, 0);
    expect(match.blockers.some((b) => b.includes("experience"))).toBe(true);
  });

  it("counts only genuinely eligible buyers for the seller-facing claim", () => {
    const scored = scoreDeal(inputs);
    const counts = countInterestedBuyers(SEED_BUY_BOXES, scored);
    expect(counts.total).toBeLessThanOrEqual(SEED_BUY_BOXES.length);
    expect(counts.fast).toBeLessThanOrEqual(counts.total);
  });

  it("counts no buyers for a blocked deal", () => {
    const blocked = scoreDeal({ ...inputs, purchasePrice: fromMajor(110_000) });
    expect(countInterestedBuyers(SEED_BUY_BOXES, blocked).total).toBe(0);
  });
});

describe("close report", () => {
  function build(overrides: Record<string, MilestoneStatus>): Milestone[] {
    return STANDARD_MILESTONES.map((m) => ({ ...m, status: overrides[m.key] ?? "not-started" }));
  }

  it("scores zero readiness at the start", () => {
    const report = buildCloseReport(build({}));
    expect(report.closeScore).toBe(0);
  });

  it("scores full readiness when everything is complete", () => {
    const all = Object.fromEntries(
      STANDARD_MILESTONES.map((m) => [m.key, "complete" as MilestoneStatus]),
    );
    const report = buildCloseReport(build(all));
    expect(report.closeScore).toBe(100);
    expect(report.blockers.length).toBe(0);
  });

  it("ranks blockers by how much they hold up", () => {
    const report = buildCloseReport(build({ "seller-id": "blocked", insurance: "blocked" }));
    expect(report.blockers[0]?.severity).toBe("red");
    // Seller ID gates the contract chain; insurance gates nothing downstream.
    expect(report.blockers[0]?.downstreamCount).toBeGreaterThan(
      report.blockers[report.blockers.length - 1]?.downstreamCount ?? 0,
    );
  });

  it("reduces completion probability for each hard blocker", () => {
    // Measured from a near-ready transaction: from an empty one both cases sit
    // on the 5% floor and the comparison proves nothing.
    const allComplete = Object.fromEntries(
      STANDARD_MILESTONES.map((m) => [m.key, "complete" as MilestoneStatus]),
    );
    const clean = buildCloseReport(build(allComplete));
    const blocked = buildCloseReport(
      build({ ...allComplete, "seller-id": "blocked", "lender-offer": "blocked" }),
    );
    expect(blocked.completionProbability).toBeLessThan(clean.completionProbability);
    expect(clean.completionProbability).toBeGreaterThan(80);
  });

  it("treats an expiring approval as a red blocker", () => {
    const report = buildCloseReport(
      STANDARD_MILESTONES.map((m) => ({
        ...m,
        status: (m.key === "valuation" ? "expiring" : "complete") as MilestoneStatus,
        expiresInDays: m.key === "valuation" ? 13 : undefined,
      })),
    );
    expect(report.blockers.some((b) => b.severity === "red")).toBe(true);
  });

  it("computes a critical path that shortens as work completes", () => {
    const early = buildCloseReport(build({}));
    const later = buildCloseReport(build({ searches: "complete", "lender-offer": "complete", valuation: "complete" }));
    expect(later.criticalPathDays).toBeLessThan(early.criticalPathDays);
  });

  it("terminates on a cyclic milestone graph", () => {
    const cyclic: Milestone[] = [
      { key: "a", label: "A", owner: "buyer", status: "not-started", weight: 1, blocks: ["b"], typicalDays: 1 },
      { key: "b", label: "B", owner: "buyer", status: "not-started", weight: 1, blocks: ["a"], typicalDays: 1 },
    ];
    expect(() => buildCloseReport(cyclic)).not.toThrow();
  });
});
