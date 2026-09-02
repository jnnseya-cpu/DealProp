import { describe, expect, it } from "vitest";
import { fromMajor, toMajor, ZERO } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import { isTrackableRoute } from "@shared/domain/analytics";
import {
  APPRAISAL_JURISDICTIONS,
  DEFAULT_HOLD_MONTHS,
  hasSubmission,
  parseAppraisal,
  toQuery,
} from "@shared/domain/appraisalRequest";

/**
 * The free appraisal.
 *
 * The tests that matter are about what it refuses to do: invent a figure
 * nobody entered, flatter a refurbishment, offer a jurisdiction whose rates
 * have not been verified, or let a visitor's deal reach an ad network.
 */

const MINIMUM = { purchasePrice: "172,000", marketValue: "212,000" };

describe("what it accepts", () => {
  it("reads money the way a person types it", () => {
    const parsed = parseAppraisal({ ...MINIMUM, refurbishment: "£34,000.00" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toMajor(parsed.inputs.purchasePrice)).toBe(172_000);
    expect(toMajor(parsed.inputs.property.refurbishmentEstimate)).toBe(34_000);
  });

  it("does nothing at all until something has been entered", () => {
    expect(hasSubmission({})).toBe(false);
    expect(hasSubmission({ jurisdiction: "GB-SCT" })).toBe(false);
    expect(hasSubmission({ purchasePrice: "1" })).toBe(true);
  });

  it("round-trips through a query string, so a result has a URL", () => {
    const query = toQuery({ ...MINIMUM, refurbishment: "", holdMonths: "12" });
    expect(query).toContain("purchasePrice=172%2C000");
    expect(query).not.toContain("refurbishment");
  });
});

describe("what it refuses", () => {
  it("will not appraise without a price and a market value", () => {
    const noPrice = parseAppraisal({ marketValue: "212,000" });
    expect(noPrice.ok).toBe(false);
    if (noPrice.ok) return;
    expect(noPrice.problems.map((p) => p.field)).toContain("purchasePrice");

    const noValue = parseAppraisal({ purchasePrice: "172,000" });
    expect(noValue.ok).toBe(false);
  });

  it("treats an unparseable figure as absent rather than as zero", () => {
    // Zero is a figure. A figure nobody entered must never reach the engine.
    const parsed = parseAppraisal({ purchasePrice: "about two hundred grand", marketValue: "212,000" });
    expect(parsed.ok).toBe(false);
  });

  it("wants the rent before it will judge a refinance exit", () => {
    const parsed = parseAppraisal({ ...MINIMUM, exit: "refinance-and-hold" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems[0]?.field).toBe("monthlyRent");
  });

  it("offers only jurisdictions whose rate tables have been verified", () => {
    const codes = APPRAISAL_JURISDICTIONS.map((j) => j.code);
    expect(codes).toContain("GB-ENG");
    expect(codes).not.toContain("GB-WLS");
    expect(codes).not.toContain("US-GEN");

    // An unknown code falls back to England rather than being taken on trust.
    const parsed = parseAppraisal({ ...MINIMUM, jurisdiction: "GB-WLS" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.inputs.property.jurisdiction).toBe("GB-ENG");
  });
});

describe("what it assumes, and says it assumed", () => {
  it("never assumes a refurbishment adds more than it costs", () => {
    const parsed = parseAppraisal({ ...MINIMUM, refurbishment: "34,000" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Assuming an uplift nobody entered is how a refurb appraisal flatters
    // itself. Works add exactly their cost until somebody says otherwise.
    expect(parsed.inputs.property.postWorksValue).toBe(fromMajor(212_000 + 34_000));
    expect(parsed.assumptions.join(" ")).toContain("adding exactly what they cost");
  });

  it("uses a given post-works value in preference to the assumption", () => {
    const parsed = parseAppraisal({ ...MINIMUM, refurbishment: "34,000", postWorksValue: "285,000" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.inputs.property.postWorksValue).toBe(fromMajor(285_000));
    expect(parsed.assumptions.join(" ")).not.toContain("adding exactly what they cost");
  });

  it("declares every default it applied", () => {
    const parsed = parseAppraisal(MINIMUM);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const said = parsed.assumptions.join(" ");
    expect(parsed.inputs.holdMonths).toBe(DEFAULT_HOLD_MONTHS);
    expect(said).toContain(`${DEFAULT_HOLD_MONTHS}-month hold`);
    expect(said).toContain("England");
    expect(said).toContain("not a quote");
    expect(said).toContain("higher rate of transfer tax");
  });

  it("declares nothing it did not assume", () => {
    const parsed = parseAppraisal({
      ...MINIMUM,
      jurisdiction: "GB-SCT",
      holdMonths: "12",
      ltv: "65",
      rate: "9.5",
      company: "on",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.inputs.property.jurisdiction).toBe("GB-SCT");
    expect(parsed.inputs.buyerIsCompany).toBe(true);
  });

  it("charges nothing for finance on a cash purchase", () => {
    const parsed = parseAppraisal({ ...MINIMUM, structure: "cash-purchase" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.inputs.finance.ltvBps).toBe(0);
    expect(parsed.inputs.finance.lenderCosts).toBe(ZERO);
  });
});

describe("the figures it produces", () => {
  it("computes a true discount that is worse than the headline", () => {
    // The whole argument of the page, checked against the engine rather than
    // asserted in prose.
    const parsed = parseAppraisal({
      purchasePrice: "172,000",
      marketValue: "212,000",
      refurbishment: "34,000",
      postWorksValue: "285,000",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const a = appraise(parsed.inputs);
    expect(a.discountToOmvBps).toBeGreaterThan(0);
    expect(a.trueDiscountBps).toBeLessThan(a.discountToOmvBps);
  });
});

describe("the visitor's deal never reaches an ad network", () => {
  it("is never a trackable route, because the deal is in the URL", () => {
    // Both vendors read location.href themselves. Allowlisting this route
    // would ship the visitor's purchase price and refurbishment budget to an
    // ad network from the one page that asks for no account and stores nothing.
    expect(isTrackableRoute("/appraise")).toBe(false);
    expect(isTrackableRoute("/appraise?purchasePrice=172000&marketValue=212000")).toBe(false);
  });

  it("still tracks the page the click came from", () => {
    expect(isTrackableRoute("/")).toBe(true);
  });
});
