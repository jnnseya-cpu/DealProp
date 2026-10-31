import { describe, expect, it } from "vitest";
import { verifyCounterparty } from "@shared/domain/counterparty";
import type { CheckResult } from "@shared/domain/screening";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function check(outcome: CheckResult["outcome"], at = "2026-05-01", method: CheckResult["method"] = "provider"): CheckResult {
  return { kind: "identity", outcome, method, at, reference: "ref-1", recordedBy: "A. Operator" };
}

describe("verifyCounterparty", () => {
  it("writes nothing when no key is connected — the platform is not blocked", () => {
    // The start state with no register reader and no screening provider: no
    // proprietor, no checks. Every field stays unset, so the seller reads as
    // unchecked rather than as a false pass.
    const v = verifyCounterparty({ ownershipReason: "No HM Land Registry reader is connected." }, NOW);
    expect(v.sellerUpdate).toEqual({});
    expect(v.complete).toBe(false);
    expect(v.ownershipConfirmed).toBe(false);
    expect(v.identityVerified).toBe(false);
    expect(v.screened).toBe(false);
    expect(v.outstanding.length).toBe(3);
    expect(v.line).toMatch(/Ownership: outstanding/);
  });

  it("confirms all three from a clear, current register and screening", () => {
    const v = verifyCounterparty(
      {
        proprietor: { name: "Jane Owner", isCompany: false },
        titleNumber: "WM123456",
        ownershipReason: "",
        identity: check("clear"),
        sanctions: { ...check("clear"), kind: "sanctions-pep" },
      },
      NOW,
    );
    expect(v.complete).toBe(true);
    expect(v.sellerUpdate.authorityEvidence).toMatch(/Jane Owner/);
    expect(v.sellerUpdate.authorityEvidence).toMatch(/WM123456/);
    expect(v.sellerUpdate.identityVerifiedAt).toBe("2026-05-01");
    expect(v.sellerUpdate.screenedAt).toBe("2026-05-01");
    expect(v.sellerUpdate.identityMethod).toMatch(/Electronic check/);
  });

  it("treats an inconclusive identity result as not verified, never a pass", () => {
    const v = verifyCounterparty(
      {
        proprietor: { name: "Jane Owner", isCompany: false },
        titleNumber: "WM123456",
        ownershipReason: "",
        identity: check("inconclusive"),
        sanctions: { ...check("clear"), kind: "sanctions-pep" },
      },
      NOW,
    );
    expect(v.ownershipConfirmed).toBe(true);
    expect(v.identityVerified).toBe(false);
    expect(v.sellerUpdate.identityVerifiedAt).toBeUndefined();
    expect(v.complete).toBe(false);
    expect(v.outstanding.some((o) => /inconclusive/i.test(o))).toBe(true);
  });

  it("treats a clear but stale identity as not current", () => {
    const v = verifyCounterparty(
      {
        proprietor: { name: "Jane Owner", isCompany: false },
        ownershipReason: "",
        identity: check("clear", "2024-01-01"),
      },
      NOW,
    );
    expect(v.identityVerified).toBe(false);
    expect(v.sellerUpdate.identityVerifiedAt).toBeUndefined();
  });
});
