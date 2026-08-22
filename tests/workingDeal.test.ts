import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, ZERO } from "@shared/money";
import { isUnpriced, toWorkingDeal } from "@shared/domain/workingDeal";
import { appraise } from "@shared/domain/economics";
import { scoreDeal } from "@shared/domain/dealScore";
import { buildIntake } from "@shared/domain/intake";
import type { DealInputs } from "@shared/domain/types";

/** An enquiry as seller intake stores it: no leverage, price at full value. */
function enquiry(): DealInputs {
  const intake = buildIntake({
    situation: "landlord-exit",
    priorities: ["convenience"],
    narrative: "Winding down.",
    postcodeArea: "B29",
    locality: "Selly Oak",
    jurisdiction: "GB-ENG",
    propertyType: "house",
    tenure: "freehold",
    bedrooms: 4,
    occupancy: "vacant",
    knownIssues: [],
    sellerValuation: fromMajor(245_000),
    condition: "needs-major-work",
    screening: { hasIndependentLegalAdvice: true, hasReceivedIndependentValuation: true },
  });

  return {
    property: intake.property,
    seller: intake.seller,
    purchasePrice: intake.property.openMarketValue,
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
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
  };
}

/** A negotiated deal: leverage in place, price agreed below value. */
function priced(): DealInputs {
  const base = enquiry();
  return {
    ...base,
    purchasePrice: fromMajor(180_000),
    structure: "bridging-refurb-refinance",
    exit: "refinance-and-hold",
    finance: {
      ltvBps: pct(70),
      refurbAdvanceBps: pct(100),
      annualRateBps: pct(9.6),
      arrangementFeeBps: pct(2),
      exitFeeBps: pct(1),
      interestRolledUp: true,
      lenderCosts: fromMajor(1_500),
    },
  };
}

describe("working deal", () => {
  it("recognises an unpriced enquiry", () => {
    expect(isUnpriced(enquiry())).toBe(true);
  });

  it("does not treat a negotiated deal as unpriced", () => {
    expect(isUnpriced(priced())).toBe(false);
  });

  it("leaves a negotiated deal exactly as stored", () => {
    const deal = priced();
    const working = toWorkingDeal(deal);
    expect(working.modelled).toBe(false);
    expect(working.inputs).toBe(deal);
  });

  it("prices an enquiry below open market value", () => {
    const working = toWorkingDeal(enquiry());
    expect(working.modelled).toBe(true);
    expect(working.inputs.purchasePrice).toBeLessThan(working.inputs.property.openMarketValue);
  });

  it("turns a rejected enquiry into a workable deal", () => {
    // The whole point: appraised as stored, an enquiry is a cash purchase at
    // full asking price and loses money. The Deal Room must not show that.
    const raw = enquiry();
    expect(appraise(raw).profit).toBeLessThanOrEqual(0);

    const working = toWorkingDeal(raw);
    expect(appraise(working.inputs).profit).toBeGreaterThan(0);
  });

  it("clears the target margin at the modelled price", () => {
    const working = toWorkingDeal(enquiry());
    expect(appraise(working.inputs).marginOnGdvBps).toBeGreaterThanOrEqual(1_500);
  });

  it("always explains that the price was derived, not agreed", () => {
    const working = toWorkingDeal(enquiry());
    expect(working.note).toBeDefined();
    expect(working.note).toContain("No price has been agreed");
  });

  it("still applies seller protection to a modelled price", () => {
    // Modelling a price must not become a way around the safeguards: the
    // protection engine runs against whatever price is actually shown.
    const raw = enquiry();
    const vulnerable: DealInputs = {
      ...raw,
      seller: {
        ...raw.seller,
        screening: { ...raw.seller.screening, reportsHealthOrCapacityConcern: true },
      },
    };
    const working = toWorkingDeal(vulnerable);
    expect(scoreDeal(working.inputs).protection.blocked).toBe(true);
  });

  it("reports honestly when no price works at all", () => {
    const hopeless = enquiry();
    const working = toWorkingDeal({
      ...hopeless,
      property: {
        ...hopeless.property,
        refurbishmentEstimate: hopeless.property.openMarketValue,
        postWorksValue: hopeless.property.openMarketValue,
      },
    });
    expect(working.note).toContain("No price produces an acceptable margin");
  });
});
