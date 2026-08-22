import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, toMajor } from "@shared/money";
import { appraise, financeInterest, maxViablePrice } from "@shared/domain/economics";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";

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

const inputs: DealInputs = {
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
};

describe("finance interest", () => {
  it("computes simple interest when serviced", () => {
    // £100,000 at 12% for 6 months, serviced = £6,000.
    const interest = financeInterest(fromMajor(100_000), 1_200, 6, false);
    expect(toMajor(interest)).toBe(6_000);
  });

  it("compounds rolled-up interest above the serviced equivalent", () => {
    const serviced = financeInterest(fromMajor(100_000), 1_200, 12, false);
    const rolled = financeInterest(fromMajor(100_000), 1_200, 12, true);
    expect(rolled).toBeGreaterThan(serviced);
    // 1% monthly compounded over 12 months ≈ 12.68%.
    expect(toMajor(rolled)).toBeCloseTo(12_682.5, 0);
  });

  it("returns zero for a zero facility or zero term", () => {
    expect(financeInterest(fromMajor(0), 1_200, 12, true)).toBe(0);
    expect(financeInterest(fromMajor(100_000), 1_200, 0, true)).toBe(0);
  });
});

describe("appraisal", () => {
  it("includes every cost, not just purchase and works", () => {
    const a = appraise(inputs);
    expect(a.costs.transferTax).toBeGreaterThan(0);
    expect(a.costs.financeArrangement).toBeGreaterThan(0);
    expect(a.costs.financeInterest).toBeGreaterThan(0);
    expect(a.costs.contingency).toBeGreaterThan(0);
    expect(a.costs.holdingCosts).toBeGreaterThan(0);
    expect(a.costs.sellingCosts).toBeGreaterThan(0);
    // The naive "buy 225, sell 320 = 95k profit" is wrong by a wide margin.
    expect(toMajor(a.profit)).toBeLessThan(95_000);
  });

  it("charges profit tax and reports profit after it", () => {
    const a = appraise(inputs);
    expect(a.profitTax).toBeGreaterThan(0);
    expect(a.profit).toBe(a.profitBeforeTax - a.profitTax);
    expect(a.profit).toBeLessThan(a.profitBeforeTax);
  });

  it("reports a true discount lower than the headline discount", () => {
    const a = appraise(inputs);
    // Headline: 225k against 280k value. True: everything spent against value.
    expect(a.discountToOmvBps).toBeGreaterThan(a.trueDiscountBps);
  });

  it("can show a headline discount that is not a real discount", () => {
    // 20% "BMV" that costs more than the property is worth once transacted.
    const expensive = appraise({
      ...inputs,
      purchasePrice: fromMajor(224_000),
      property: { ...property, refurbishmentEstimate: fromMajor(45_000) },
    });
    expect(expensive.discountToOmvBps).toBeGreaterThan(1_500);
    expect(expensive.trueDiscountBps).toBeLessThan(0);
  });

  it("does not charge selling costs on a refinance exit", () => {
    const sold = appraise({ ...inputs, exit: "sell" });
    const refinanced = appraise({ ...inputs, exit: "refinance-and-hold" });
    expect(sold.costs.sellingCosts).toBeGreaterThan(0);
    expect(refinanced.costs.sellingCosts).toBe(0);
  });

  it("computes capital left in on a refinance", () => {
    const a = appraise({ ...inputs, exit: "refinance-and-hold" });
    expect(a.exit.refinanceAdvance).toBeDefined();
    expect(a.exit.capitalLeftIn).toBeDefined();
    // 75% of £320,000 = £240,000 advance.
    expect(toMajor(a.exit.refinanceAdvance ?? fromMajor(0))).toBe(240_000);
  });

  it("measures return against equity, not total cost", () => {
    const a = appraise(inputs);
    expect(a.funding.equityRequired).toBeLessThan(a.costs.total);
    // 70% of £225,000 purchase, plus a 100% tranche against £25,000 of works.
    expect(a.funding.seniorDebt).toBe(fromMajor(157_500 + 25_000));
  });

  it("funds the refurbishment when the lender advances against works", () => {
    const withWorks = appraise(inputs);
    const purchaseOnly = appraise({
      ...inputs,
      finance: { ...finance, refurbAdvanceBps: pct(0) },
    });
    expect(withWorks.funding.seniorDebt).toBeGreaterThan(purchaseOnly.funding.seniorDebt);
    // Funding the works is what makes a BRR deal reachable without large equity.
    expect(withWorks.funding.equityRequired).toBeLessThan(purchaseOnly.funding.equityRequired);
  });

  it("charges interest on roughly half the works tranche, not all of it", () => {
    // Works are drawn in arrears tranches, so charging day-one interest on the
    // full budget would overstate the cost of every phased project.
    const phased = appraise(inputs);
    const drawnUpfront = appraise({
      ...inputs,
      property: { ...property, refurbishmentEstimate: fromMajor(0) },
      purchasePrice: fromMajor(225_000),
    });
    expect(phased.costs.financeInterest).toBeGreaterThan(drawnUpfront.costs.financeInterest);
  });

  it("annualises return by the hold period", () => {
    const short = appraise({ ...inputs, holdMonths: 6 });
    expect(short.annualisedRoiBps).toBeGreaterThan(short.roiOnCashBps);
  });

  it("turns a marginal deal into a loss as the price rises", () => {
    const overpriced = appraise({ ...inputs, purchasePrice: fromMajor(300_000) });
    expect(overpriced.profit).toBeLessThan(0);
  });

  it("rejects invalid inputs", () => {
    expect(() => appraise({ ...inputs, purchasePrice: fromMajor(0) })).toThrow(RangeError);
    expect(() => appraise({ ...inputs, holdMonths: -1 })).toThrow(RangeError);
  });
});

describe("maxViablePrice", () => {
  it("finds a price that clears the target margin", () => {
    const ceiling = maxViablePrice(inputs, 1_500);
    expect(ceiling).toBeGreaterThan(0);
    const atCeiling = appraise({ ...inputs, purchasePrice: ceiling });
    expect(atCeiling.marginOnGdvBps).toBeGreaterThanOrEqual(1_500);
  });

  it("finds no viable price when the target is unachievable", () => {
    const ceiling = maxViablePrice(inputs, 9_000);
    expect(ceiling).toBe(0);
  });

  it("returns a ceiling below the current price when the deal is overpriced", () => {
    const ceiling = maxViablePrice({ ...inputs, purchasePrice: fromMajor(300_000) }, 1_500);
    expect(ceiling).toBeLessThan(fromMajor(300_000));
  });
});
