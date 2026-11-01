import { describe, expect, it } from "vitest";
import { feeExemptionCurrent, isFeeExempt, type FeeExemption } from "@shared/domain/accounts";

/**
 * Who pays nothing.
 *
 * The house always plays free (a connected party), and so does any account an
 * admin has comped with a current grant. An expired grant is no grant. The
 * decision changes price only — nothing here touches a gate.
 */

const NOW = new Date("2026-06-01T00:00:00.000Z");

const base = { connectedParty: undefined, feeExemption: undefined } as const;

const grant = (over: Partial<FeeExemption> = {}): FeeExemption => ({
  grantedAt: "2026-05-01T00:00:00.000Z",
  grantedBy: "An Admin",
  reason: "Launch partner",
  ...over,
});

describe("fee exemption", () => {
  it("is held by the house (a connected party), grant or no grant", () => {
    expect(isFeeExempt({ connectedParty: true, feeExemption: undefined }, NOW)).toBe(true);
  });

  it("is held by an account with a current admin grant", () => {
    expect(isFeeExempt({ ...base, feeExemption: grant() }, NOW)).toBe(true);
    // An expiry in the future is still current.
    expect(isFeeExempt({ ...base, feeExemption: grant({ expiresAt: "2026-12-31" }) }, NOW)).toBe(true);
  });

  it("is not held once the grant has lapsed, nor with no grant at all", () => {
    expect(isFeeExempt({ ...base, feeExemption: grant({ expiresAt: "2026-01-01" }) }, NOW)).toBe(false);
    expect(isFeeExempt(base, NOW)).toBe(false);
  });

  it("treats an unparseable expiry as lapsed — fails closed on price in our favour", () => {
    expect(feeExemptionCurrent(grant({ expiresAt: "not-a-date" }), NOW)).toBe(false);
  });

  it("no expiry means no expiry", () => {
    expect(feeExemptionCurrent(grant(), NOW)).toBe(true);
    expect(feeExemptionCurrent(undefined, NOW)).toBe(false);
  });
});
