import { describe, expect, it } from "vitest";
import { mayResell, type ResaleConsent } from "@shared/domain/reseller";
import type { SourcerCompliance } from "@shared/domain/accounts";

/**
 * The reseller / sub-agent capability.
 *
 * Two gates, and the tests worth having prove it refuses when either is
 * missing: no owner authority, and no verified regulated standing of the
 * reseller's own. Neither is optional and neither substitutes for the other.
 */

const NOW = new Date("2026-06-01T00:00:00.000Z");

const CONSENT: ResaleConsent = { grantedAt: "2026-05-01T00:00:00.000Z", grantedBy: "A. Okafor" };

/** AML + redress recorded, current, and verified by a named operator. */
const VERIFIED: SourcerCompliance = {
  amlRegistration: "XAML00000000",
  amlConfirmedAt: "2026-01-01T00:00:00.000Z",
  redressScheme: "property-ombudsman",
  redressMembership: "TPO-12345",
  verification: {
    verifiedAt: "2026-01-15T00:00:00.000Z",
    verifiedBy: "Jo Bloggs",
    evidence: "HMRC AML register + TPO membership",
  },
};

describe("who may resell", () => {
  it("refuses without the owner's authority, however compliant the reseller", () => {
    const decision = mayResell({ compliance: VERIFIED, resaleConsent: undefined, now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.blockers.join(" ")).toContain("owner has not authorised");
  });

  it("refuses without the reseller's own verified AML and redress", () => {
    // Owner said yes, but the reseller has recorded nothing of their own.
    const none = mayResell({ compliance: undefined, resaleConsent: CONSENT, now: NOW });
    expect(none.allowed).toBe(false);
    expect(none.blockers.join(" ")).toContain("estate-agency work you do in your own name");

    // Recorded but not yet verified by Lode — still not enough.
    const unverified = mayResell({
      compliance: { ...VERIFIED, verification: undefined },
      resaleConsent: CONSENT,
      now: NOW,
    });
    expect(unverified.allowed).toBe(false);
  });

  it("allows only when the owner authorised it and the reseller is verified", () => {
    const decision = mayResell({ compliance: VERIFIED, resaleConsent: CONSENT, now: NOW });
    expect(decision.allowed).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    // The cut is stated from the catalogue, on the fee, never the price.
    expect(decision.terms).toMatch(/20%/);
    expect(decision.reason).toContain("20%");
  });

  it("reports both gates at once when both are missing", () => {
    const decision = mayResell({ compliance: undefined, resaleConsent: undefined, now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toHaveLength(2);
  });
});
