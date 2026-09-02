import { describe, expect, it } from "vitest";
import {
  BENEFICIAL_OWNER_THRESHOLD_PERCENT,
  ENHANCED_TRIGGERS,
  SELLER_CHECK_VALID_MONTHS,
  SELLER_KINDS,
  sellerDueDiligence,
  sellerKindDefinition,
  type SellerDueDiligence,
} from "@shared/domain/sellerDueDiligence";

/**
 * Checking the seller.
 *
 * The Regulations make an estate agency business responsible for both parties,
 * not the one who happens to be paying. The failure being prevented is a
 * transaction that reaches exchange before anybody asked whether the person on
 * the telephone may sell the house.
 */

const NOW = new Date("2026-09-01T00:00:00.000Z");

const COMPLETE: SellerDueDiligence = {
  kind: "individual",
  identityVerifiedAt: "2026-08-01T00:00:00.000Z",
  identityMethod: "Photo ID and proof of address",
  screenedAt: "2026-08-01T00:00:00.000Z",
  authorityEvidencedAt: "2026-08-01T00:00:00.000Z",
  authorityEvidence: "Sole registered proprietor on title WM123456.",
  riskAssessedAt: "2026-08-01T00:00:00.000Z",
  riskAssessedBy: "Jo Bloggs",
};

describe("nothing recorded is unchecked, not clear", () => {
  it("refuses to market a seller nobody has looked at", () => {
    const nothing = sellerDueDiligence(undefined, NOW);
    expect(nothing.mayGoToMarket).toBe(false);
    expect(nothing.blockers.length).toBeGreaterThanOrEqual(4);
    expect(nothing.summary).toContain("exactly the seller the Money Laundering Regulations exist for");
  });

  it("clears once identity, screening, authority and a risk assessment are recorded", () => {
    const done = sellerDueDiligence(COMPLETE, NOW);
    expect(done.mayGoToMarket).toBe(true);
    expect(done.blockers).toEqual([]);
  });
});

describe("may they actually sell it", () => {
  it("asks a different question of each kind of seller", () => {
    // An executor needs a grant, an attorney a registered power, a company a
    // director. Asking all of them for a passport and stopping there is the
    // failure that lets a shell own a house.
    for (const kind of SELLER_KINDS) {
      expect(kind.authorityEvidence.length, kind.kind).toBeGreaterThan(30);
    }
    expect(sellerKindDefinition("estate").authorityEvidence).toContain("probate");
    expect(sellerKindDefinition("attorney").authorityEvidence).toContain("power of attorney");
    expect(sellerKindDefinition("joint-owners").authorityEvidence).toContain("every one of them");
  });

  it("wants the evidence described, not merely dated", () => {
    const dated = sellerDueDiligence({ ...COMPLETE, authorityEvidence: "  " }, NOW);
    expect(dated.mayGoToMarket).toBe(false);
    expect(dated.blockers.join(" ")).toContain("Authority to sell");
  });

  it("names what a grant of probate is for when it is missing", () => {
    const executor = sellerDueDiligence(
      { ...COMPLETE, kind: "estate", authorityEvidencedAt: undefined },
      NOW,
    );
    expect(executor.blockers.join(" ")).toContain("nobody who may sell");
  });
});

describe("who is behind the entity", () => {
  it("needs beneficial owners for a company or a trust and not for an individual", () => {
    expect(sellerKindDefinition("company").needsBeneficialOwners).toBe(true);
    expect(sellerKindDefinition("trust").needsBeneficialOwners).toBe(true);
    expect(sellerKindDefinition("individual").needsBeneficialOwners).toBe(false);
  });

  it("blocks a company with nobody identified behind it", () => {
    const shell = sellerDueDiligence({ ...COMPLETE, kind: "company" }, NOW);
    expect(shell.mayGoToMarket).toBe(false);
    expect(shell.blockers.join(" ")).toContain("not the name that matters");
  });

  it("counts only holdings over the statutory threshold, and wants each verified", () => {
    const small = sellerDueDiligence(
      {
        ...COMPLETE,
        kind: "company",
        beneficialOwners: [{ name: "A Minor Shareholder", holdingPercent: 10, verifiedAt: "2026-08-01T00:00:00.000Z" }],
      },
      NOW,
    );
    // Nobody over 25% identified is the same as nobody identified.
    expect(small.mayGoToMarket).toBe(false);

    const unverified = sellerDueDiligence(
      {
        ...COMPLETE,
        kind: "company",
        beneficialOwners: [{ name: "The Owner", holdingPercent: 80 }],
      },
      NOW,
    );
    expect(unverified.mayGoToMarket).toBe(false);

    const done = sellerDueDiligence(
      {
        ...COMPLETE,
        kind: "company",
        beneficialOwners: [
          { name: "The Owner", holdingPercent: 80, verifiedAt: "2026-08-01T00:00:00.000Z" },
        ],
      },
      NOW,
    );
    expect(done.mayGoToMarket).toBe(true);
    expect(BENEFICIAL_OWNER_THRESHOLD_PERCENT).toBe(25);
  });
});

describe("enhanced due diligence", () => {
  it("wants a trigger from a closed list, and what was done about it", () => {
    // "Enhanced because it felt odd" is not a documented risk-based decision.
    const triggered = sellerDueDiligence(
      { ...COMPLETE, enhancedTriggers: ["politically-exposed"] },
      NOW,
    );
    expect(triggered.enhanced).toBe(true);
    expect(triggered.mayGoToMarket).toBe(false);
    expect(triggered.blockers.join(" ")).toContain(ENHANCED_TRIGGERS["politically-exposed"]);

    const handled = sellerDueDiligence(
      {
        ...COMPLETE,
        enhancedTriggers: ["politically-exposed"],
        enhancedMeasures: "Source of wealth evidenced; approved by the nominated officer.",
      },
      NOW,
    );
    expect(handled.mayGoToMarket).toBe(true);
  });
});

describe("checks go stale", () => {
  it("treats a lapsed identity check as no check", () => {
    const old = sellerDueDiligence(
      { ...COMPLETE, identityVerifiedAt: "2024-01-01T00:00:00.000Z" },
      NOW,
    );
    expect(old.mayGoToMarket).toBe(false);
    expect(SELLER_CHECK_VALID_MONTHS).toBe(12);
  });

  it("treats a date in the future as a fabrication rather than a check", () => {
    const ahead = sellerDueDiligence({ ...COMPLETE, screenedAt: "2027-01-01T00:00:00.000Z" }, NOW);
    expect(ahead.mayGoToMarket).toBe(false);
  });

  it("says why screening matters, because knowledge is no defence", () => {
    const unscreened = sellerDueDiligence({ ...COMPLETE, screenedAt: undefined }, NOW);
    expect(unscreened.blockers.join(" ")).toContain("regardless of what anybody knew");
  });

  it("reads the date passed in, never the wall clock", () => {
    const later = new Date("2028-01-01T00:00:00.000Z");
    expect(sellerDueDiligence(COMPLETE, NOW).mayGoToMarket).toBe(true);
    expect(sellerDueDiligence(COMPLETE, later).mayGoToMarket).toBe(false);
  });
});
