import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import { borrowingCost, compareOffers, looksMispriced, netAdvance } from "@shared/domain/borrowing";
import { cashRequired, exitHeadroom, fundingMetrics, refinanceDscr } from "@shared/domain/fundingMetrics";
import { fundingReadiness, WEIGHTS } from "@shared/domain/fundingReadiness";
import { compareRecordedOffers, type OfferTerms } from "@shared/domain/offers";
import {
  checkPromotionLanguage,
  classifyRoute,
  type BorrowerFacts,
  type OperatorPermissions,
} from "@shared/domain/regulatoryRoute";

const finance: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(12),
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
  openMarketValue: fromMajor(280_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(25_000),
  postWorksValue: fromMajor(320_000),
  monthlyRent: fromMajor(1_400),
  knownIssues: [],
};

const seller: SellerProfile = {
  situation: "probate",
  priorities: ["speed"],
  targetDays: 30,
  screening: { hasIndependentLegalAdvice: true, hasReceivedIndependentValuation: true },
};

function deal(overrides: Partial<DealInputs> = {}): DealInputs {
  return {
    property,
    seller,
    purchasePrice: fromMajor(225_000),
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: "bridging-refurb-refinance",
    finance,
    exit: "sell",
    ...overrides,
  };
}

/* ------------------------------------------------------------- borrowing */

describe("what the borrowing really costs", () => {
  it("itemises every element of the total, not just the rate", () => {
    // Comparing on the advertised monthly rate picks the wrong lender routinely.
    const cost = borrowingCost(appraise(deal()));
    const labels = cost.lines.map((l) => l.label);
    expect(labels).toContain("Arrangement fee");
    expect(labels).toContain("Broker fee");
    expect(labels).toContain("Interest");
    expect(labels).toContain("Valuation and lender legals");
    expect(labels).toContain("Exit fee");
    expect(cost.total).toBe(
      cost.lines.reduce((sum, l) => sum + l.amount, 0),
    );
  });

  it("counts a broker fee that other comparisons leave out", () => {
    const without = borrowingCost(appraise(deal()));
    const withBroker = borrowingCost(
      appraise(deal({ finance: { ...finance, brokerFeeBps: pct(2) } })),
    );
    expect(withBroker.total).toBeGreaterThan(without.total);
  });

  it("treats retained interest as money that never arrives", () => {
    // Acceptance test 4: retained interest reduces the net advance without
    // reducing what is ultimately repayable.
    const retained = appraise(deal());
    const serviced = appraise(deal({ finance: { ...finance, interestRolledUp: false } }));

    const retainedAdvance = netAdvance(retained);
    const servicedAdvance = netAdvance(serviced);

    expect(retainedAdvance.received).toBeLessThan(servicedAdvance.received);
    expect(retainedAdvance.facility).toBe(servicedAdvance.facility);
    // The facility itself is unchanged; only what is handed over differs.
    expect(borrowingCost(retained).facility).toBe(borrowingCost(serviced).facility);
  });

  it("never reports a negative advance", () => {
    // A facility swallowed entirely by its own deductions pays out nothing, not
    // less than nothing.
    const brutal = appraise(
      deal({
        holdMonths: 240,
        finance: { ...finance, annualRateBps: pct(40), arrangementFeeBps: pct(30) },
      }),
    );
    expect(netAdvance(brutal).received).toBeGreaterThanOrEqual(0);
  });

  it("says what has to be found in cash because of the deductions", () => {
    const appraisal = appraise(deal());
    const advance = netAdvance(appraisal);
    expect(advance.deducted).toBeGreaterThan(0);
    expect(advance.reason).toContain("deducted at drawdown");
    // cashRequired() is the one place this is derived; there is no second
    // function computing the same thing from the same inputs.
    expect(cashRequired(appraisal)).toBeGreaterThan(0);
  });

  it("compares two offers on total cost rather than headline rate", () => {
    // The cheaper rate carrying a heavy fee is the dearer loan.
    const cheapRateHeavyFees = borrowingCost(
      appraise(deal({ finance: { ...finance, annualRateBps: pct(9), arrangementFeeBps: pct(8) } })),
    );
    const dearRateNoFees = borrowingCost(
      appraise(deal({ finance: { ...finance, annualRateBps: pct(12), arrangementFeeBps: pct(0), exitFeeBps: pct(0) } })),
    );

    const result = compareOffers(
      { label: "9% with 8% fees", cost: cheapRateHeavyFees },
      { label: "12% with none", cost: dearRateNoFees },
    );
    expect(result.cheaper).toBe("b");
    expect(result.reason).toContain("whatever the headline rates say");
  });

  it("flags a total that looks too cheap to be complete", () => {
    const barelyAnything = borrowingCost(
      appraise(
        deal({
          holdMonths: 1,
          finance: { ...finance, annualRateBps: pct(1), arrangementFeeBps: pct(0), exitFeeBps: pct(0), lenderCosts: fromMajor(0) },
        }),
      ),
    );
    expect(looksMispriced(barelyAnything)).toContain("cheap for bridging");
  });
});

/* --------------------------------------------------------------- metrics */

describe("the ratios a funder decides on", () => {
  it("distinguishes leverage against price from leverage against value", () => {
    // Where a deal is bought below value the two differ, and which one a lender
    // uses is the difference between a case working and not.
    const metrics = fundingMetrics(appraise(deal()));
    const onPrice = metrics.metrics.find((m) => m.key === "ltv-purchase");
    const onValue = metrics.metrics.find((m) => m.key === "ltv-market");
    expect(onPrice?.bps).toBeGreaterThan(onValue?.bps ?? 0);
    expect(onPrice?.against).toContain("price");
    expect(onValue?.against).toContain("value");
  });

  it("carries its formula version, so a stored ratio stays interpretable", () => {
    expect(fundingMetrics(appraise(deal())).formulaVersion).not.toBe("");
  });

  it("computes the cash requirement from the net advance, not the facility", () => {
    const appraisal = appraise(deal());
    const fromNet = cashRequired(appraisal);
    const naive = appraisal.costs.total - appraisal.funding.seniorDebt;
    expect(fromNet).toBeGreaterThan(naive);
  });

  it("reports the gap against cash actually committed", () => {
    const appraisal = appraise(deal());
    const required = cashRequired(appraisal);
    const withNothing = fundingMetrics(appraisal).metrics.find((m) => m.key === "funding-gap");
    const withAll = fundingMetrics(appraisal, required).metrics.find((m) => m.key === "funding-gap");
    expect(withNothing?.amount).toBe(required);
    expect(withAll?.amount).toBe(0);
  });

  it("says plainly when the exit does not repay the debt", () => {
    const doomed = appraise(
      deal({ purchasePrice: fromMajor(300_000), property: { ...property, postWorksValue: fromMajor(200_000) } }),
    );
    const metrics = fundingMetrics(doomed);
    expect(metrics.exitRepaysDebt).toBe(false);
    expect(exitHeadroom(doomed)).toBeLessThan(0);
    expect(metrics.summary).toContain("does not repay");
  });

  it("marks each metric with how it should be read", () => {
    // A cover of 0.53x rendered as "52.6%" says the opposite of what it means:
    // a lender reads the first as unfundable and the second as comfortable.
    const held = fundingMetrics(appraise(deal({ exit: "refinance-and-hold" })));
    expect(held.metrics.find((m) => m.key === "refinance-dscr")?.display).toBe("times");
    expect(held.metrics.find((m) => m.key === "ltv-purchase")?.display).toBe("percent");
    expect(held.metrics.find((m) => m.key === "funding-gap")?.display).toBe("amount");
    for (const metric of held.metrics) {
      if (metric.display === "amount") expect(metric.amount, metric.key).toBeDefined();
      else expect(metric.bps, metric.key).toBeDefined();
    }
  });

  it("has no debt service ratio on a sale exit", () => {
    // A sale leaves no ongoing debt, so a cover ratio would be meaningless.
    expect(refinanceDscr(appraise(deal({ exit: "sell" })))).toBeUndefined();
  });

  it("measures debt service cover on a refinance exit", () => {
    const held = appraise(deal({ exit: "refinance-and-hold" }));
    const dscr = refinanceDscr(held);
    expect(dscr).toBeDefined();
    expect(dscr).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- readiness */

describe("the readiness score", () => {
  it("weights to exactly one hundred", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("scores an empty pack near zero rather than assuming the best", () => {
    // The most expensive way to find a pack is incomplete is for a lender to
    // find out first, after charging for a valuation.
    const report = fundingReadiness(appraise(deal()));
    expect(report.score).toBeLessThan(30);
    expect(report.band).toBe("not-ready");
  });

  it("scores a complete pack as fundable", () => {
    const appraisal = appraise(deal());
    const report = fundingReadiness(appraisal, {
      titleNumber: "WM123456",
      tenureConfirmed: true,
      legalPackReviewed: true,
      searchesOrdered: true,
      titleDefectsResolved: true,
      independentValuation: true,
      valuationDate: "2026-08-01",
      valuerFirm: "Example Surveyors LLP",
      comparablesRecorded: true,
      planningStatus: "not-required",
      borrowerIdentityVerified: true,
      sourceOfFundsEvidenced: true,
      trackRecordRecorded: true,
      adverseCreditDeclared: false,
      committedCash: cashRequired(appraisal),
      scheduleOfWorks: true,
      costPlanFromQs: true,
      contractorAppointed: true,
      programmeAgreed: true,
      exitEvidence: true,
      backupExitRecorded: true,
      solicitorInstructed: true,
      expiredDocuments: 0,
    });
    expect(report.score).toBeGreaterThanOrEqual(75);
    expect(report.band).toBe("fundable-pack");
    expect(report.blockers).toEqual([]);
  });

  it("tells the sponsor what is missing, not just the number", () => {
    const report = fundingReadiness(appraise(deal()));
    const title = report.components.find((c) => c.key === "legalTitle");
    expect(title?.missing.length).toBeGreaterThan(0);
    expect(title?.missing.join(" ")).toContain("title number");
  });

  it("blocks on an exit that cannot repay, whatever the rest of the pack says", () => {
    const doomed = appraise(
      deal({ purchasePrice: fromMajor(300_000), property: { ...property, postWorksValue: fromMajor(200_000) } }),
    );
    const report = fundingReadiness(doomed, { titleNumber: "X", independentValuation: true });
    expect(report.blockers.join(" ")).toContain("does not repay");
  });

  it("blocks where the regulatory route is not cleared", () => {
    const route = classifyRoute(
      borrower({ securityIncludesOwnerOccupiedDwelling: true }),
      "regulated-lender",
      permissions({ regulatedMortgageIntroductions: false }),
    );
    const report = fundingReadiness(appraise(deal()), {}, route);
    expect(report.blockers.join(" ")).toContain("REGULATED_ROUTE");
  });

  it("counts expired documents as a blocker, not a deduction", () => {
    const report = fundingReadiness(appraise(deal()), { expiredDocuments: 2 });
    expect(report.blockers.join(" ")).toContain("expired");
  });

  it("never presents itself as a credit decision", () => {
    expect(fundingReadiness(appraise(deal())).caveat).toContain("not approval");
  });

  it("does not penalise a sale exit for having no debt service ratio", () => {
    const sale = fundingReadiness(appraise(deal({ exit: "sell" })), { exitEvidence: true, backupExitRecorded: true });
    const exit = sale.components.find((c) => c.key === "exit");
    expect(exit?.missing.join(" ")).not.toContain("service its own interest");
  });
});

/* ------------------------------------------------------------ regulatory */

function borrower(overrides: Partial<BorrowerFacts> = {}): BorrowerFacts {
  return {
    legalForm: "spv",
    businessPurposeDeclared: true,
    businessPurposeEvidenced: true,
    securityIncludesOwnerOccupiedDwelling: false,
    consumerBuyToLetIndicators: false,
    borrowerJurisdiction: "GB",
    assetJurisdiction: "GB",
    ...overrides,
  };
}

function permissions(overrides: Partial<OperatorPermissions> = {}): OperatorPermissions {
  return {
    regulatedMortgageIntroductions: false,
    creditBroking: false,
    promotionApprover: false,
    ...overrides,
  };
}

describe("which regulatory route applies", () => {
  it("lets a corporate business borrower through, secured on nothing residentialised", () => {
    const decision = classifyRoute(borrower(), "unregulated-business-lender", permissions());
    expect(decision.route).toBe("BUSINESS_UNREGULATED_ROUTE");
    expect(decision.mayIntroduce).toBe(true);
  });

  it("treats a loan on the borrower's own home as regulated, whatever was declared", () => {
    // Purpose does not move a loan secured on the borrower's dwelling outside
    // the perimeter. This is the test that overrides every declaration.
    const decision = classifyRoute(
      borrower({ securityIncludesOwnerOccupiedDwelling: true, businessPurposeDeclared: true }),
      "unregulated-business-lender",
      permissions(),
    );
    expect(decision.route).toBe("REGULATED_ROUTE");
    expect(decision.mayIntroduce).toBe(false);
  });

  it("allows the regulated route only where the permission is recorded", () => {
    // Acceptance test 1: no regulated introduction while permission is absent.
    const facts = borrower({ securityIncludesOwnerOccupiedDwelling: true });
    expect(classifyRoute(facts, "regulated-lender", permissions()).mayIntroduce).toBe(false);
    expect(
      classifyRoute(facts, "regulated-lender", permissions({ regulatedMortgageIntroductions: true }))
        .mayIntroduce,
    ).toBe(true);
  });

  it("sends consumer buy-to-let indicators to review", () => {
    expect(classifyRoute(borrower({ consumerBuyToLetIndicators: true }), "unregulated-business-lender", permissions()).route)
      .toBe("CBTL_REVIEW");
  });

  it("treats an equity or JV offer as a promotion, and never auto-clears it", () => {
    const decision = classifyRoute(borrower(), "equity-or-jv-investor", permissions({ promotionApprover: true }));
    expect(decision.route).toBe("EQUITY_PROMOTION_REVIEW");
    expect(decision.mayIntroduce).toBe(false);
    expect(decision.blockers.join(" ")).toContain("categorisation");
  });

  it("sends a private-lender introduction to review even with credit broking recorded", () => {
    const decision = classifyRoute(borrower(), "private-lender", permissions({ creditBroking: true }));
    expect(decision.route).toBe("PRIVATE_DEBT_REVIEW");
    expect(decision.mayIntroduce).toBe(false);
  });

  it("refuses to classify a declared purpose with nothing behind it", () => {
    const decision = classifyRoute(
      borrower({ businessPurposeEvidenced: false }),
      "unregulated-business-lender",
      permissions(),
    );
    expect(decision.route).toBe("LEGAL_REVIEW_REQUIRED");
  });

  it("refers anything outside the jurisdiction these rules cover", () => {
    expect(classifyRoute(borrower({ assetJurisdiction: "IE" }), "unregulated-business-lender", permissions()).route)
      .toBe("LEGAL_REVIEW_REQUIRED");
  });

  it("always gives a reason and never a bare classification", () => {
    for (const type of ["regulated-lender", "unregulated-business-lender", "private-lender", "equity-or-jv-investor"] as const) {
      expect(classifyRoute(borrower(), type, permissions()).reason, type).not.toBe("");
    }
  });
});

describe("language that must not reach an investor", () => {
  it("catches the claims that turn a description into a misleading promotion", () => {
    for (const phrase of [
      "a guaranteed 12% return",
      "this is risk-free",
      "a no-risk opportunity",
      "you can't lose",
      "safe as houses",
      "an assured return of 10%",
      "a fixed return of 8%",
    ]) {
      expect(checkPromotionLanguage(phrase).clean, phrase).toBe(false);
    }
  });

  it("passes an honest description", () => {
    const honest =
      "The projected return is 14% over nine months. Property values can fall and the exit may take longer than modelled, in which case the return would be lower or capital could be lost.";
    expect(checkPromotionLanguage(honest).clean).toBe(true);
  });

  it("says why, not merely that it failed", () => {
    const finding = checkPromotionLanguage("a guaranteed return").findings[0];
    expect(finding?.why).toContain("guaranteed");
  });
});

/* ---------------------------------------------------------------- offers */

function offer(overrides: Partial<OfferTerms> = {}): OfferTerms {
  return {
    id: "o1",
    lender: "Lender A",
    annualRateBps: 1_200,
    arrangementFeeBps: 200,
    brokerFeeBps: 0,
    exitFeeBps: 100,
    ltvBps: 7_000,
    lenderCosts: 150_000,
    interestRolledUp: true,
    termMonths: 9,
    confidence: "indicative",
    ...overrides,
  };
}

describe("comparing the offers received", () => {
  it("asks for three when none are recorded", () => {
    const report = compareRecordedOffers(deal(), []);
    expect(report.offers).toEqual([]);
    expect(report.summary).toContain("three");
  });

  it("says a single quote is a price, not a market", () => {
    expect(compareRecordedOffers(deal(), [offer()]).summary).toContain("not a market");
  });

  it("ranks by total cost, not by rate", () => {
    // The cheap rate carrying heavy fees is the dearer loan.
    const report = compareRecordedOffers(deal(), [
      offer({ id: "cheap-rate", lender: "Heavy fees", annualRateBps: 900, arrangementFeeBps: 800 }),
      offer({ id: "dear-rate", lender: "No fees", annualRateBps: 1_300, arrangementFeeBps: 0, exitFeeBps: 0 }),
    ]);
    expect(report.cheapest?.terms.lender).toBe("No fees");
    expect(report.offers[0]?.terms.lender).toBe("No fees");
  });

  it("counts a broker fee that a rate comparison would miss", () => {
    const report = compareRecordedOffers(deal(), [
      offer({ id: "a", lender: "With broker", brokerFeeBps: 200 }),
      offer({ id: "b", lender: "Without" }),
    ]);
    expect(report.cheapest?.terms.lender).toBe("Without");
  });

  it("warns where the cheapest loan is not the one that completes", () => {
    // Retained interest on a large facility can leave less on the day than a
    // dearer loan that services monthly.
    const report = compareRecordedOffers(deal(), [
      offer({ id: "a", lender: "Cheapest", ltvBps: 6_000, interestRolledUp: true }),
      offer({ id: "b", lender: "Biggest advance", ltvBps: 7_500, interestRolledUp: false, annualRateBps: 1_500 }),
    ]);
    if (report.cheapest?.terms.id !== report.largestAdvance?.terms.id) {
      expect(report.summary).toContain("does not complete");
    }
    expect(report.largestAdvance?.netAdvance).toBeGreaterThanOrEqual(report.cheapest?.netAdvance ?? 0);
  });

  it("reports the sponsor cash each offer leaves to find", () => {
    const report = compareRecordedOffers(deal(), [offer()]);
    expect(report.offers[0]?.sponsorCash).toBeGreaterThan(0);
    expect(report.offers[0]?.netAdvance).toBeLessThan(report.offers[0]?.cost.facility ?? 0);
  });

  it("keeps each offer's confidence, because indicative is not binding", () => {
    const report = compareRecordedOffers(deal(), [offer({ confidence: "binding" })]);
    expect(report.offers[0]?.confidence).toBe("binding");
  });
});
