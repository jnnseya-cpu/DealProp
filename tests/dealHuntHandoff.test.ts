import { describe, expect, it } from "vitest";
import { fromMajor } from "@shared/money";
import { bps } from "@shared/money";
import { buildAppraisalSeed, appraisalDraftIdFor } from "@shared/domain/dealHuntHandoff";
import type { DealHuntResult } from "@shared/domain/dealHuntRun";
import { openAppraisalFromResult } from "@backend/dealHunt/handoff";
import { saveDealHuntResult, getDealHuntResult } from "@backend/store/repository";

function result(over: Partial<DealHuntResult> = {}): DealHuntResult {
  return {
    id: "res-1",
    runId: "run-1",
    propertyId: "p-1",
    listingId: "l-1",
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
    matchReasons: [],
    provenance: ["zoopla", "rightmove"],
    stale: false,
    evidenceBundleId: "cb-1",
    enrichment: { sold: "ready", rent: "missing" },
    ...over,
  };
}

describe("buildAppraisalSeed (§6)", () => {
  it("carries the asking price as an observed input and requires confirmation", () => {
    const seed = buildAppraisalSeed({ investorId: "inv-1", result: result(), entitled: () => true });
    expect(seed.observedAskingPence).toBe(result().currentPence);
    expect(seed.requiresPurchasePriceConfirmation).toBe(true);
    expect(seed.evidenceBundleId).toBe("cb-1");
    expect(seed.provenanceTransferred).toEqual(["zoopla", "rightmove"]);
  });

  it("withholds evidence from a source whose licence no longer permits display (DH13)", () => {
    const entitled = (k: string) => k === "zoopla"; // rightmove revoked
    const seed = buildAppraisalSeed({ investorId: "inv-1", result: result(), entitled });
    expect(seed.withheldSources).toEqual(["rightmove"]);
    expect(seed.provenanceTransferred).toEqual(["zoopla"]);
  });

  it("does not transfer the bundle when nothing is entitled (DH13)", () => {
    const seed = buildAppraisalSeed({ investorId: "inv-1", result: result(), entitled: () => false });
    expect(seed.evidenceBundleId).toBeUndefined();
    expect(seed.withheldSources).toEqual(["zoopla", "rightmove"]);
  });

  it("flags a stale snapshot and a changed or unavailable listing (DH07/§6)", () => {
    const seed = buildAppraisalSeed({
      investorId: "inv-1",
      result: result({ stale: true }),
      entitled: () => true,
      listingState: { available: false, currentAskPence: fromMajor(195_000) },
    });
    expect(seed.listingAvailable).toBe(false);
    expect(seed.observedAskingPence).toBe(fromMajor(195_000));
    expect(seed.staleInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("derives a stable draft id per investor and result (DH15)", () => {
    expect(appraisalDraftIdFor("inv-1", "res-1")).toBe("dh-draft-inv-1-res-1");
  });
});

describe("openAppraisalFromResult (DH15, through the store)", () => {
  it("links one draft and is idempotent when opened twice", async () => {
    await saveDealHuntResult(result({ id: "ho-1", runId: "ho-run" }));
    const first = await openAppraisalFromResult("ho-1", "inv-9");
    expect(first.ok).toBe(true);
    expect(first.alreadyLinked).toBe(false);
    expect(first.seed?.draftId).toBe("dh-draft-inv-9-ho-1");

    const second = await openAppraisalFromResult("ho-1", "inv-9");
    expect(second.alreadyLinked).toBe(true);
    expect(second.seed?.draftId).toBe("dh-draft-inv-9-ho-1");

    const stored = await getDealHuntResult("ho-1");
    expect(stored?.appraisalDraftId).toBe("dh-draft-inv-9-ho-1");
  });
});
