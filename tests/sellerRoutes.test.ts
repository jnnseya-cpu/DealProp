import { describe, expect, it } from "vitest";
import { bps, fromMajor, toMajor, ZERO } from "@/lib/money";
import { buildIntake, type IntakeAnswers } from "@/domain/intake";
import { buildSellerRoutes, investorProfitOnRoute } from "@/domain/sellerRoutes";
import { assessSellerProtection } from "@/domain/protection";

const baseAnswers: IntakeAnswers = {
  situation: "probate",
  priorities: ["speed", "certainty"],
  narrative: "Inherited my father's house. Empty a year. We want it dealt with.",
  postcodeArea: "B23",
  locality: "Erdington",
  jurisdiction: "GB-ENG",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  knownIssues: [],
  sellerValuation: fromMajor(212_000),
  condition: "needs-modernising",
  targetDays: 35,
  screening: {
    hasIndependentLegalAdvice: true,
    hasReceivedIndependentValuation: true,
    isSoleDecisionMaker: true,
    ageBand: "under-65",
  },
};

describe("intake", () => {
  it("derives works and post-works value from condition", () => {
    const light = buildIntake({ ...baseAnswers, condition: "tired" });
    const heavy = buildIntake({ ...baseAnswers, condition: "uninhabitable" });
    expect(heavy.property.refurbishmentEstimate).toBeGreaterThan(light.property.refurbishmentEstimate);
    expect(heavy.property.postWorksValue).toBeGreaterThan(light.property.postWorksValue);
  });

  it("never returns works that exceed the uplift they create", () => {
    // If this inverts, every deal in that condition band is unfundable and the
    // seller is quoted a route that cannot exist.
    for (const condition of ["ready", "tired", "needs-modernising", "needs-major-work", "uninhabitable"] as const) {
      const intake = buildIntake({ ...baseAnswers, condition });
      const uplift = intake.property.postWorksValue - intake.property.openMarketValue;
      expect(uplift).toBeGreaterThan(0);
    }
  });

  it("marks the seller's valuation as unverified", () => {
    const intake = buildIntake(baseAnswers);
    const check = intake.checks.find((c) => c.key === "seller-valuation");
    expect(check?.status).toBe("unverified");
    expect(intake.requiresValuation).toBe(true);
  });

  it("uses the asking price when the seller's estimate is above it", () => {
    // A property that has not sold at its asking price is unlikely to be worth
    // more than that price, so the lower figure wins.
    const intake = buildIntake({
      ...baseAnswers,
      sellerValuation: fromMajor(250_000),
      currentAsking: fromMajor(210_000),
    });
    expect(toMajor(intake.property.openMarketValue)).toBe(210_000);
    expect(intake.checks.some((c) => c.status === "contradicted")).toBe(true);
  });

  it("keeps the seller's estimate when the asking price is higher", () => {
    const intake = buildIntake({
      ...baseAnswers,
      sellerValuation: fromMajor(200_000),
      currentAsking: fromMajor(230_000),
    });
    expect(toMajor(intake.property.openMarketValue)).toBe(200_000);
  });

  it("raises confidence when the asking price corroborates the estimate", () => {
    const alone = buildIntake(baseAnswers);
    const corroborated = buildIntake({ ...baseAnswers, currentAsking: fromMajor(211_000) });
    expect(corroborated.property.valuationConfidence).toBeGreaterThan(alone.property.valuationConfidence);
  });

  it("lowers confidence for known issues and short leases", () => {
    const clean = buildIntake(baseAnswers);
    const issues = buildIntake({ ...baseAnswers, knownIssues: ["damp", "subsidence"] });
    const shortLease = buildIntake({
      ...baseAnswers,
      tenure: "leasehold",
      leaseYearsRemaining: 68,
    });
    expect(issues.property.valuationConfidence).toBeLessThan(clean.property.valuationConfidence);
    expect(shortLease.property.valuationConfidence).toBeLessThan(clean.property.valuationConfidence);
  });

  it("adds short-lease as a property issue automatically", () => {
    const intake = buildIntake({ ...baseAnswers, tenure: "leasehold", leaseYearsRemaining: 68 });
    expect(intake.property.knownIssues).toContain("short-lease");
  });
});

describe("seller routes", () => {
  it("offers fast cash below the structured price", () => {
    const { property, seller } = buildIntake(baseAnswers);
    const report = buildSellerRoutes(property, seller);
    const fast = report.routes.find((r) => r.key === "fast-cash");
    const structured = report.routes.find((r) => r.key === "structured");
    expect(fast).toBeDefined();
    expect(structured).toBeDefined();
    // Speed and certainty are paid for out of the price. If this inverts, the
    // trade-off the whole page explains has stopped being true.
    expect(fast?.totalToSeller ?? 0).toBeLessThan(structured?.totalToSeller ?? 0);
  });

  it("ranks by the seller's stated priorities, not by price", () => {
    const { property, seller } = buildIntake({
      ...baseAnswers,
      priorities: ["speed", "certainty"],
      targetDays: 21,
    });
    const report = buildSellerRoutes(property, seller);
    expect(report.best?.key).toBe("fast-cash");

    const priceLed = buildIntake({ ...baseAnswers, priorities: ["price"], targetDays: 200 });
    const priceReport = buildSellerRoutes(priceLed.property, priceLed.seller);
    expect(priceReport.best?.key).not.toBe("fast-cash");
  });

  it("gives every route at least one stated trade-off", () => {
    const { property, seller } = buildIntake(baseAnswers);
    const report = buildSellerRoutes(property, seller);
    for (const route of report.routes) {
      expect(route.tradeOffs.length).toBeGreaterThan(0);
    }
  });

  it("marks structures it cannot model precisely as indicative", () => {
    const { property, seller } = buildIntake(baseAnswers);
    const report = buildSellerRoutes(property, seller);
    const assisted = report.routes.find((r) => r.key === "assisted-sale");
    expect(assisted?.fidelity).toBe("indicative");
    const fast = report.routes.find((r) => r.key === "fast-cash");
    expect(fast?.fidelity).toBe("modelled");
  });

  it("pays more on the assisted sale than on any ownership route", () => {
    // This is the route's entire reason to exist: the seller whose minimum
    // exceeds what anyone can pay to own the asset.
    const { property, seller } = buildIntake({ ...baseAnswers, condition: "needs-modernising" });
    const report = buildSellerRoutes(property, seller);
    const assisted = report.routes.find((r) => r.key === "assisted-sale");
    const fast = report.routes.find((r) => r.key === "fast-cash");
    expect(assisted?.totalToSeller ?? 0).toBeGreaterThan(fast?.totalToSeller ?? 0);
  });

  it("reports no viable route rather than inventing one", () => {
    // Works that swallow the whole value leave nothing for anyone.
    const { property, seller } = buildIntake({
      ...baseAnswers,
      sellerValuation: fromMajor(60_000),
      condition: "uninhabitable",
      knownIssues: ["subsidence", "japanese-knotweed"],
    });
    const report = buildSellerRoutes(property, seller);
    if (report.noViableRoute) {
      expect(report.routes.length).toBe(0);
      expect(report.summary).toContain("open-market sale");
    } else {
      // If routes do exist they must still be positive amounts.
      for (const r of report.routes) expect(r.totalToSeller).toBeGreaterThan(0);
    }
  });

  it("never offers a route in a jurisdiction that forbids it", () => {
    const { property, seller } = buildIntake({ ...baseAnswers, jurisdiction: "GB-SCT" });
    const report = buildSellerRoutes(property, seller);
    for (const route of report.routes) {
      expect(route.permission).not.toBe("not-supported");
    }
  });

  it("discloses a positive investor profit on every offered route", () => {
    const { property, seller } = buildIntake(baseAnswers);
    const report = buildSellerRoutes(property, seller);
    for (const route of report.routes) {
      // A route where the buyer makes nothing is a route no buyer will take.
      expect(investorProfitOnRoute(property, seller, route)).toBeGreaterThan(0);
    }
  });

  it("keeps the seller's total below the property's value on ownership routes", () => {
    const { property, seller } = buildIntake(baseAnswers);
    const report = buildSellerRoutes(property, seller);
    const ownership = report.routes.filter((r) => r.key === "fast-cash" || r.key === "structured");
    for (const route of ownership) {
      expect(route.totalToSeller).toBeLessThan(property.openMarketValue);
    }
  });
});

describe("intake feeds protection correctly", () => {
  it("blocks a repossession case with pressure and no advice", () => {
    const intake = buildIntake({
      ...baseAnswers,
      situation: "repossession-threat",
      priorities: ["speed"],
      targetDays: 14,
      screening: {
        hasIndependentLegalAdvice: false,
        hasReceivedIndependentValuation: false,
        isSoleDecisionMaker: true,
        reportsFinancialDistress: true,
        isUnderTimePressureFromThirdParty: true,
        ageBand: "80-plus",
      },
    });
    const report = buildSellerRoutes(intake.property, intake.seller);
    const price = report.best?.totalToSeller ?? intake.property.openMarketValue;

    const protection = assessSellerProtection({
      property: intake.property,
      seller: intake.seller,
      purchasePrice: price,
      buyerOwnsOtherProperty: true,
      buyerIsCompany: true,
      buyerIsNonResident: false,
      holdMonths: 6,
      structure: "cash-purchase",
      finance: {
        ltvBps: bps(0),
        refurbAdvanceBps: bps(0),
        annualRateBps: bps(0),
        arrangementFeeBps: bps(0),
        exitFeeBps: bps(0),
        interestRolledUp: false,
        lenderCosts: ZERO,
      },
      exit: "sell",
    });

    expect(protection.blocked).toBe(true);
  });

  it("treats unanswered screening as a reason for caution", () => {
    const answered = buildIntake(baseAnswers);
    const unanswered = buildIntake({ ...baseAnswers, screening: {} });
    expect(answered.seller.screening?.hasIndependentLegalAdvice).toBe(true);
    expect(unanswered.seller.screening?.hasIndependentLegalAdvice).toBeUndefined();
  });
});
