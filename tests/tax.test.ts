import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import { stampDutyLandTax } from "@shared/domain/jurisdictions/gb-eng";
import { landAndBuildingsTransactionTax } from "@shared/domain/jurisdictions/gb-sct";
import { ukProfitTax } from "@shared/domain/jurisdictions/profitTax";

/**
 * These tests pin the encoded rate tables. They are expected to FAIL when the
 * rates change, which is the point: a silent rate change is the most dangerous
 * failure mode in the system, because every downstream number stays plausible.
 */

const base = {
  buyerOwnsOtherProperty: false,
  buyerIsCompany: false,
  buyerIsNonResident: false,
  isResidential: true,
};

describe("SDLT (England & NI)", () => {
  it("charges nothing below the nil-rate threshold", () => {
    expect(stampDutyLandTax({ ...base, price: fromMajor(125_000) })).toBe(0);
  });

  it("charges 2% on the slice between 125k and 250k", () => {
    // £250,000: 2% of the £125,000 slice = £2,500.
    expect(toMajor(stampDutyLandTax({ ...base, price: fromMajor(250_000) }))).toBe(2_500);
  });

  it("charges banded rates on a mid-market purchase", () => {
    // £300,000: £2,500 + 5% of £50,000 = £5,000.
    expect(toMajor(stampDutyLandTax({ ...base, price: fromMajor(300_000) }))).toBe(5_000);
  });

  it("applies the additional dwelling surcharge to the whole price", () => {
    // £300,000: £5,000 base + 5% surcharge on the full £300,000 = £20,000.
    const tax = stampDutyLandTax({ ...base, price: fromMajor(300_000), buyerOwnsOtherProperty: true });
    expect(toMajor(tax)).toBe(20_000);
  });

  it("treats a company as an additional-dwelling buyer from the first purchase", () => {
    const individual = stampDutyLandTax({ ...base, price: fromMajor(300_000) });
    const company = stampDutyLandTax({ ...base, price: fromMajor(300_000), buyerIsCompany: true });
    expect(company).toBeGreaterThan(individual);
    expect(toMajor(company)).toBe(20_000);
  });

  it("stacks the non-resident surcharge on top of the additional dwelling surcharge", () => {
    const tax = stampDutyLandTax({
      ...base,
      price: fromMajor(300_000),
      buyerOwnsOtherProperty: true,
      buyerIsNonResident: true,
    });
    // £5,000 base + 7% of £300,000 = £26,000.
    expect(toMajor(tax)).toBe(26_000);
  });

  it("applies the flat company rate above the threshold", () => {
    // £600,000 to a company: 17% flat = £102,000.
    const tax = stampDutyLandTax({ ...base, price: fromMajor(600_000), buyerIsCompany: true });
    expect(toMajor(tax)).toBe(102_000);
  });

  it("uses non-residential bands for commercial property", () => {
    // £300,000 non-residential: 2% of £100k + 5% of £50k = £4,500.
    const tax = stampDutyLandTax({ ...base, price: fromMajor(300_000), isResidential: false });
    expect(toMajor(tax)).toBe(4_500);
  });

  it("charges nothing on a zero or negative price", () => {
    expect(stampDutyLandTax({ ...base, price: fromMajor(0) })).toBe(0);
  });
});

describe("LBTT (Scotland)", () => {
  it("differs from SDLT at the same price, proving the packs are independent", () => {
    const sdlt = stampDutyLandTax({ ...base, price: fromMajor(300_000) });
    const lbtt = landAndBuildingsTransactionTax({ ...base, price: fromMajor(300_000) });
    expect(lbtt).not.toBe(sdlt);
  });

  it("charges banded LBTT on a mid-market purchase", () => {
    // £300,000: 2% of (250,000-145,000)=£2,100, plus 5% of £50,000 = £2,500. Total £4,600.
    expect(toMajor(landAndBuildingsTransactionTax({ ...base, price: fromMajor(300_000) }))).toBe(4_600);
  });

  it("applies the 8% additional dwelling supplement", () => {
    const tax = landAndBuildingsTransactionTax({
      ...base,
      price: fromMajor(300_000),
      buyerOwnsOtherProperty: true,
    });
    // £4,600 + 8% of £300,000 = £28,600.
    expect(toMajor(tax)).toBe(28_600);
  });

  it("has no non-resident surcharge", () => {
    const resident = landAndBuildingsTransactionTax({ ...base, price: fromMajor(300_000) });
    const nonResident = landAndBuildingsTransactionTax({
      ...base,
      price: fromMajor(300_000),
      buyerIsNonResident: true,
    });
    expect(nonResident).toBe(resident);
  });
});

describe("profit tax", () => {
  it("charges the small profits rate on modest company profit", () => {
    const result = ukProfitTax({
      profitBeforeTax: fromMajor(40_000),
      buyerIsCompany: true,
      isTrading: true,
      rentalProfit: fromMajor(0),
    });
    expect(toMajor(result.amount)).toBe(7_600); // 19% of £40,000
    expect(result.requiresProfessionalReview).toBe(true);
  });

  it("charges the main rate on large company profit", () => {
    const result = ukProfitTax({
      profitBeforeTax: fromMajor(300_000),
      buyerIsCompany: true,
      isTrading: true,
      rentalProfit: fromMajor(0),
    });
    expect(toMajor(result.amount)).toBe(75_000); // 25% of £300,000
  });

  it("taxes an individual's trading profit as income, not as a gain", () => {
    const trading = ukProfitTax({
      profitBeforeTax: fromMajor(50_000),
      buyerIsCompany: false,
      isTrading: true,
      rentalProfit: fromMajor(0),
    });
    const investing = ukProfitTax({
      profitBeforeTax: fromMajor(50_000),
      buyerIsCompany: false,
      isTrading: false,
      rentalProfit: fromMajor(0),
    });
    expect(trading.amount).toBeGreaterThan(investing.amount);
    expect(toMajor(trading.amount)).toBe(20_000); // 40%
    expect(toMajor(investing.amount)).toBe(12_000); // 24%
  });

  it("charges no tax when there is no profit", () => {
    const result = ukProfitTax({
      profitBeforeTax: fromMajor(-10_000),
      buyerIsCompany: true,
      isTrading: true,
      rentalProfit: fromMajor(0),
    });
    expect(result.amount).toBe(0);
  });

  it("always demands professional review", () => {
    const result = ukProfitTax({
      profitBeforeTax: fromMajor(80_000),
      buyerIsCompany: true,
      isTrading: false,
      rentalProfit: fromMajor(5_000),
    });
    expect(result.requiresProfessionalReview).toBe(true);
    expect(result.caveats.length).toBeGreaterThan(0);
  });
});
