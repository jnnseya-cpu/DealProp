import { describe, expect, it } from "vitest";
import { fromMajor, money, pct } from "@shared/money";
import {
  disclosureFor,
  MAIN_CONTRACTOR_THRESHOLD,
  referTradePartners,
  TRADE_PARTNERS,
} from "@shared/domain/partners";
import type { PropertyFacts, PropertyIssue, SellerProfile } from "@shared/domain/types";

function property(overrides: Partial<PropertyFacts> = {}): PropertyFacts {
  return {
    id: "p1",
    jurisdiction: "GB-ENG",
    postcodeArea: "B23",
    locality: "Erdington",
    propertyType: "house",
    tenure: "freehold",
    bedrooms: 3,
    occupancy: "vacant",
    openMarketValue: fromMajor(212_000),
    valuationConfidence: pct(80),
    refurbishmentEstimate: fromMajor(40_000),
    postWorksValue: fromMajor(275_000),
    monthlyRent: fromMajor(1_100),
    knownIssues: [],
    ...overrides,
  };
}

function seller(overrides: Partial<SellerProfile> = {}): SellerProfile {
  return {
    situation: "probate",
    priorities: ["speed"],
    targetDays: 60,
    ...overrides,
  };
}

describe("trade partner referrals", () => {
  // The specific trades, with AxionOS (the works platform) always recorded first
  // whenever works are implied. `trades` drops it to test the contractor choice.
  const trades = (report: { referrals: readonly { partner: { key: string } }[] }) =>
    report.referrals.map((r) => r.partner.key).filter((k) => k !== "axionos");

  it("records AxionOS as the works platform on any property with works", () => {
    const report = referTradePartners(property());
    expect(report.referrals[0]?.partner.key).toBe("axionos");
    expect(report.referrals[0]?.reasons.join(" ")).toContain("escrow");
    expect(report.worksImplied).toBe(true);
  });

  it("sends a full refurbishment programme to the renovation contractor", () => {
    const report = referTradePartners(property());
    expect(report.referrals.map((r) => r.partner.key)).toEqual(["axionos", "jnseya"]);
    expect(report.worksImplied).toBe(true);
  });

  it("folds a small job into the AxionOS referral rather than a duplicate card", () => {
    const report = referTradePartners(property({ refurbishmentEstimate: fromMajor(6_000) }));
    expect(report.referrals.map((r) => r.partner.key)).toEqual(["axionos"]);
    expect(report.referrals[0]?.reasons.join(" ")).toContain(
      "small enough to be handled by individual trades",
    );
  });

  it("treats the threshold as inclusive of the main contractor", () => {
    const at = referTradePartners(property({ refurbishmentEstimate: MAIN_CONTRACTOR_THRESHOLD }));
    expect(trades(at)[0]).toBe("jnseya");
    const below = referTradePartners(
      property({ refurbishmentEstimate: money(MAIN_CONTRACTOR_THRESHOLD - 1) }),
    );
    // Below the threshold there is no separate trade: the small job goes
    // through AxionOS, which is the only referral.
    expect(trades(below)).toHaveLength(0);
    expect(below.referrals.map((r) => r.partner.key)).toEqual(["axionos"]);
  });

  it("folds a specialist report into AxionOS alongside the main contractor", () => {
    const issues: PropertyIssue[] = ["damp", "structural"];
    const report = referTradePartners(property({ knownIssues: issues }));
    expect(report.referrals.map((r) => r.partner.key)).toEqual(["axionos", "jnseya"]);
    // Two defects are joined into one grammatical sentence, not a comma list.
    expect(report.referrals.find((r) => r.partner.key === "axionos")?.reasons.join(" ")).toContain(
      "Damp and structural movement need specialist reports",
    );
  });

  it("refers nobody when the property needs no work", () => {
    const report = referTradePartners(property({ refurbishmentEstimate: fromMajor(0) }));
    expect(report.referrals).toHaveLength(0);
    expect(report.worksImplied).toBe(false);
  });

  it("still refers when the seller says the property needs work but no budget is set", () => {
    // The seller's own account of the property is evidence even before anyone
    // has costed it. Treating a zero estimate as "no work" would drop exactly
    // the seller who most needs a builder.
    const report = referTradePartners(
      property({ refurbishmentEstimate: fromMajor(0) }),
      seller({ situation: "needs-major-works" }),
    );
    expect(report.worksImplied).toBe(true);
    expect(report.referrals.map((r) => r.partner.key)).toEqual(["axionos"]);
  });

  it("uses the singular for one defect", () => {
    const report = referTradePartners(property({ knownIssues: ["damp"] }));
    expect(report.referrals.find((r) => r.partner.key === "axionos")?.reasons.join(" ")).toContain(
      "Damp needs a specialist report",
    );
  });

  it("never returns a referral without a reason", () => {
    const report = referTradePartners(property({ knownIssues: ["damp"] }));
    for (const r of report.referrals) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("never returns a referral without a disclosure", () => {
    // Introducing a consumer to a contractor is disclosable whether or not the
    // platform has an interest. The disclosure is built from the partner
    // record so no rendering surface can omit it.
    const report = referTradePartners(property({ knownIssues: ["damp"] }));
    for (const r of report.referrals) {
      expect(r.disclosure.length).toBeGreaterThan(0);
      expect(r.disclosure).toContain("free to use any contractor");
    }
  });
});

describe("partner disclosures", () => {
  it("declares an ownership interest for a connected party", () => {
    const connected = TRADE_PARTNERS.find((p) => p.relationship === "connected-party");
    if (connected === undefined) throw new Error("no connected partner configured");
    expect(disclosureFor(connected)).toContain("common ownership");
  });

  it("does not claim independence for a connected party, or a connection for an independent one", () => {
    for (const p of TRADE_PARTNERS) {
      const text = disclosureFor(p);
      if (p.relationship === "connected-party") {
        expect(text).not.toContain("independent business");
      } else {
        expect(text).not.toContain("common ownership");
      }
    }
  });

  it("states that no fee is taken while none is charged", () => {
    for (const p of TRADE_PARTNERS.filter((x) => x.feeArrangement === "none")) {
      expect(disclosureFor(p)).toContain("No fee is paid or received");
    }
  });

  it("gives every partner a unique key and an https address", () => {
    const keys = TRADE_PARTNERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of TRADE_PARTNERS) {
      expect(p.url.startsWith("https://")).toBe(true);
    }
  });
});
