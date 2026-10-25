import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import {
  assessSellerProtection,
  publicProtectionSummary,
} from "@shared/domain/protection";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";

/**
 * Dedicated unit tests for the Seller Protection Engine.
 *
 * Until now its individual rules were only exercised indirectly (through the
 * deal score, the routes and the negotiation). This is the engine whose entire
 * job is protecting vulnerable people, so each rule is pinned here: which flags
 * fire, at what severity, whether they block, whether they are about the
 * transaction (publishable) or the person (never published), and the two places
 * the current design gates on discount size — which is the documented blind
 * spot, pinned here as the behaviour it is today so a later change is visible.
 */

const FINANCE: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(10),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

const OMV = 212_000;

/** Clean screening: everything a well-protected seller would have. */
const CLEAN: NonNullable<SellerProfile["screening"]> = {
  hasIndependentLegalAdvice: true,
  hasReceivedIndependentValuation: true,
  isSoleDecisionMaker: true,
  ageBand: "under-65",
};

function deal(opts: {
  purchase: number;
  situation?: SellerProfile["situation"];
  structure?: DealInputs["structure"];
  screening?: Partial<NonNullable<SellerProfile["screening"]>>;
}): DealInputs {
  const property: PropertyFacts = {
    id: "test",
    jurisdiction: "GB-ENG",
    postcodeArea: "B23",
    locality: "Erdington",
    propertyType: "house",
    tenure: "freehold",
    bedrooms: 3,
    occupancy: "vacant",
    openMarketValue: fromMajor(OMV),
    valuationConfidence: bps(8_500),
    refurbishmentEstimate: fromMajor(30_000),
    postWorksValue: fromMajor(285_000),
    monthlyRent: fromMajor(1_250),
    knownIssues: [],
  };
  const seller: SellerProfile = {
    // "downsizing" carries no vulnerability signal, so the baseline is clean.
    situation: opts.situation ?? "downsizing",
    priorities: ["speed"],
    targetDays: 60,
    screening: { ...CLEAN, ...(opts.screening ?? {}) },
  };
  return {
    property,
    seller,
    purchasePrice: fromMajor(opts.purchase),
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: opts.structure ?? "bridging-refurb-refinance",
    finance: FINANCE,
    exit: "refinance-and-hold",
  };
}

const keys = (o: ReturnType<typeof assessSellerProtection>) => o.flags.map((f) => f.key);
const flag = (o: ReturnType<typeof assessSellerProtection>, key: string) =>
  o.flags.find((f) => f.key === key);

describe("seller protection — discount severity", () => {
  // ~5.7% discount at £200k against £212k.
  it("raises nothing about the discount on a modest, well-advised deal", () => {
    const o = assessSellerProtection(deal({ purchase: 200_000 }));
    expect(o.blocked).toBe(false);
    expect(o.flags.every((f) => f.severity !== "block")).toBe(true);
    expect(keys(o)).not.toContain("high-discount");
    expect(keys(o)).not.toContain("extreme-discount");
  });

  // ~29% discount at £150k: over HIGH (25%), under EXTREME (35%).
  it("cautions on a substantial (25–35%) discount without blocking", () => {
    const o = assessSellerProtection(deal({ purchase: 150_000 }));
    const f = flag(o, "high-discount");
    expect(f?.severity).toBe("caution");
    expect(f?.subject).toBe("transaction");
    expect(o.blocked).toBe(false);
  });

  // ~38.7% discount at £130k: over EXTREME (35%).
  it("blocks on an extreme (≥35%) discount, as a transaction fact", () => {
    const o = assessSellerProtection(deal({ purchase: 130_000 }));
    const f = flag(o, "extreme-discount");
    expect(f?.severity).toBe("block");
    expect(f?.subject).toBe("transaction");
    expect(o.blocked).toBe(true);
  });
});

describe("seller protection — vulnerability blocks", () => {
  it("blocks on a reported capacity concern REGARDLESS of discount", () => {
    const o = assessSellerProtection(
      deal({ purchase: 200_000, screening: { reportsHealthOrCapacityConcern: true } }),
    );
    const f = flag(o, "capacity-concern");
    expect(f?.severity).toBe("block");
    expect(f?.subject).toBe("seller");
    expect(o.blocked).toBe(true);
  });

  it("blocks on third-party pressure REGARDLESS of discount", () => {
    const o = assessSellerProtection(
      deal({ purchase: 200_000, screening: { isUnderTimePressureFromThirdParty: true } }),
    );
    expect(flag(o, "third-party-pressure")?.severity).toBe("block");
    expect(flag(o, "third-party-pressure")?.subject).toBe("seller");
    expect(o.blocked).toBe(true);
  });

  it("blocks an 80-plus seller ONLY once the discount is substantial (the documented gate)", () => {
    const low = assessSellerProtection(deal({ purchase: 200_000, screening: { ageBand: "80-plus" } }));
    expect(keys(low)).not.toContain("age-and-discount");

    const high = assessSellerProtection(deal({ purchase: 150_000, screening: { ageBand: "80-plus" } }));
    expect(flag(high, "age-and-discount")?.severity).toBe("block");
    expect(flag(high, "age-and-discount")?.subject).toBe("seller");
    expect(high.blocked).toBe(true);
  });
});

describe("seller protection — cautions", () => {
  it("cautions when the seller is not the sole decision maker", () => {
    const o = assessSellerProtection(deal({ purchase: 200_000, screening: { isSoleDecisionMaker: false } }));
    expect(flag(o, "multiple-owners")?.severity).toBe("caution");
    expect(o.blocked).toBe(false);
  });

  it("cautions on financial distress ONLY with a substantial discount (the documented gate)", () => {
    const low = assessSellerProtection(deal({ purchase: 200_000, screening: { reportsFinancialDistress: true } }));
    expect(keys(low)).not.toContain("distress-and-discount");
    const high = assessSellerProtection(deal({ purchase: 150_000, screening: { reportsFinancialDistress: true } }));
    expect(flag(high, "distress-and-discount")?.severity).toBe("caution");
  });

  it("flags a non-standard structure with two extra disclosures", () => {
    const o = assessSellerProtection(deal({ purchase: 180_000, structure: "lease-option" }));
    expect(flag(o, "creative-structure")?.severity).toBe("caution");
    expect(o.requiredDisclosures.some((d) => /security you hold if the buyer fails to pay/i.test(d))).toBe(true);
    expect(o.requiredDisclosures.some((d) => /insolvent before completing/i.test(d))).toBe(true);
  });
});

describe("seller protection — missing safeguards escalate with discount", () => {
  it("makes missing legal advice a caution at low discount and a block at high", () => {
    const low = assessSellerProtection(deal({ purchase: 200_000, screening: { hasIndependentLegalAdvice: false } }));
    expect(flag(low, "no-independent-advice")?.severity).toBe("caution");
    expect(low.blocked).toBe(false);

    const high = assessSellerProtection(deal({ purchase: 150_000, screening: { hasIndependentLegalAdvice: false } }));
    expect(flag(high, "no-independent-advice")?.severity).toBe("block");
    expect(high.blocked).toBe(true);
  });

  it("flags a missing independent valuation only at a substantial discount", () => {
    const low = assessSellerProtection(deal({ purchase: 200_000, screening: { hasReceivedIndependentValuation: false } }));
    expect(keys(low)).not.toContain("no-independent-valuation");
    const high = assessSellerProtection(deal({ purchase: 150_000, screening: { hasReceivedIndependentValuation: false } }));
    expect(flag(high, "no-independent-valuation")?.severity).toBe("caution");
    expect(flag(high, "no-independent-valuation")?.subject).toBe("transaction");
  });
});

describe("seller protection — outcome composition", () => {
  it("requires human review when three cautions stack without a block", () => {
    const o = assessSellerProtection(
      deal({
        purchase: 150_000, // high-discount caution + no-independent-valuation caution
        screening: { isSoleDecisionMaker: false, hasReceivedIndependentValuation: false },
      }),
    );
    expect(o.blocked).toBe(false);
    expect(o.flags.filter((f) => f.severity === "caution").length).toBeGreaterThanOrEqual(3);
    expect(o.requiresHumanReview).toBe(true);
  });

  it("requires human review whenever blocked", () => {
    const o = assessSellerProtection(deal({ purchase: 130_000 }));
    expect(o.blocked).toBe(true);
    expect(o.requiresHumanReview).toBe(true);
  });

  it("always attaches the three universal disclosures", () => {
    const o = assessSellerProtection(deal({ purchase: 200_000 }));
    expect(o.requiredDisclosures.some((d) => /open market value/i.test(d))).toBe(true);
    expect(o.requiredDisclosures.some((d) => /projected profit/i.test(d))).toBe(true);
    expect(o.requiredDisclosures.some((d) => /sell on the open market instead/i.test(d))).toBe(true);
  });
});

describe("seller protection — public summary never leaks a person's circumstances", () => {
  it("withholds seller-subject flags and publishes only transaction facts", () => {
    // Extreme discount (transaction, publishable) + capacity concern (seller, withheld).
    const o = assessSellerProtection(
      deal({ purchase: 130_000, screening: { reportsHealthOrCapacityConcern: true } }),
    );
    const summary = publicProtectionSummary(o);

    expect(summary.blocked).toBe(true);
    // Nothing about the person is in the publishable set.
    expect(summary.publishable.every((f) => f.subject === "transaction")).toBe(true);
    expect(summary.publishable.some((f) => f.key === "capacity-concern")).toBe(false);
    expect(summary.withheld).toBeGreaterThanOrEqual(1);
    // The sentence says a block happened and that it caps the score — without naming the person's circumstance.
    expect(summary.summary).toMatch(/blocked/i);
    expect(summary.summary).toMatch(/35/);
    expect(summary.summary.toLowerCase()).not.toContain("capacity");
  });

  it("says plainly when nothing was raised", () => {
    const summary = publicProtectionSummary(assessSellerProtection(deal({ purchase: 200_000 })));
    expect(summary.blocked).toBe(false);
    expect(summary.summary).toMatch(/raised nothing/i);
  });
});
