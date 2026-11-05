import { describe, expect, it } from "vitest";
import { fromMajor } from "@shared/money";
import { bps } from "@shared/money";
import { buildResultClaims, decisionFromResult } from "@shared/domain/dealHuntDecision";
import type { DealHuntResult } from "@shared/domain/dealHuntRun";
import type { ComparableBundle } from "@shared/domain/comparableBundle";

function result(): DealHuntResult {
  return {
    id: "r1",
    runId: "run1",
    propertyId: "p1",
    listingId: "l1",
    episodeKey: "o3",
    baselineObservationId: "o1",
    currentObservationId: "o3",
    returnEventObservationId: "o3",
    reason: "returned_to_market_reason_unverified",
    baselinePence: fromMajor(214_950),
    currentPence: fromMajor(199_950),
    dropPence: fromMajor(15_000),
    dropBps: bps(698),
    rank: 1,
    resultWatermark: "2026-06-07T00:00:00.000Z",
    matchReasons: ["Returned to market (reason unverified)."],
    provenance: ["fixture"],
    stale: false,
    enrichment: { sold: "ready", rent: "missing" },
  };
}

function bundleWithComparables(): ComparableBundle {
  return {
    policyVersion: "comparable-policy-1",
    asOf: "2026-06-15",
    sold: {
      used: [],
      rejected: [],
      widened: false,
      confidence: "high",
      requiresReview: false,
      reason: "4 defensible comparables.",
      asIs: { low: fromMajor(230_000), mid: fromMajor(240_000), high: fromMajor(250_000) },
      asOf: "2026-06-15",
    },
    rental: { unavailable: true, asOf: "2026-06-15" },
    coverage: { soldCount: 4, soldThin: false, advertisedRentCount: 0, agreedRentCount: 0, rentUnavailable: true },
  };
}

describe("buildResultClaims", () => {
  it("records confirmed price claims and marks absent comparable evidence missing", () => {
    const claims = buildResultClaims(result(), undefined, "lode", "2026-06-15T12:00:00.000Z");
    const byField = Object.fromEntries(claims.map((c) => [c.field, c]));
    expect(byField.asking_price!.confidence).toBe("confirmed");
    expect(byField.previous_baseline!.confidence).toBe("confirmed");
    expect(byField.sold_comparables!.confidence).toBe("missing");
    expect(byField.rental_evidence!.confidence).toBe("missing");
    // Deterministic ids: a re-run upserts.
    expect(byField.asking_price!.id).toBe("ec-run1-p1-asking_price");
  });
});

describe("decisionFromResult (§3 live composition)", () => {
  it("is 'Needs evidence' with no comparable feed — never a fabricated price", () => {
    const claims = buildResultClaims(result(), undefined, "lode", "2026-06-15T12:00:00.000Z");
    const d = decisionFromResult(result(), undefined, claims);
    expect(d.verdict).toBe("needs-evidence");
    expect(d.evidenceCoverage.missing).toContain("sold_comparables");
  });

  it("computes headroom from defensible comparables and lands within target", () => {
    const bundle = bundleWithComparables();
    const claims = buildResultClaims(result(), bundle, "lode", "2026-06-15T12:00:00.000Z");
    const d = decisionFromResult(result(), bundle, claims);
    // supported (as-is low 230k) is above the current ask (199.95k) → within target.
    expect(d.verdict).toBe("within-target");
    expect(Number(d.economics.headroomPence)).toBeGreaterThan(0);
  });
});
