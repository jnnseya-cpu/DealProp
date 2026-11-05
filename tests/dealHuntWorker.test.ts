import { describe, expect, it, beforeEach } from "vitest";
import { fromMajor } from "@shared/money";
import { validateCriteria, type DealHuntCriteria } from "@shared/domain/dealHunt";
import type { ListingObservationRecord } from "@shared/domain/marketWatch";
import {
  evaluateHunt,
  runDealHuntJob,
  EMPTY_SOURCES,
  type DealHuntSources,
  type PropertyHistory,
} from "@backend/dealHunt/worker";
import type { DealHuntQuery } from "@shared/domain/dealHuntRun";
import { listDealHuntResults, getDealHuntRun } from "@backend/store/repository";

const RUN_AT = new Date("2026-06-15T12:00:00.000Z");
const daysBefore = (n: number): string => new Date(RUN_AT.getTime() - n * 86_400_000).toISOString();

function obs(over: Partial<ListingObservationRecord> & Pick<ListingObservationRecord, "id" | "observedAt" | "status">): ListingObservationRecord {
  return { propertyId: "p1", listingId: "l1", priceQualifier: "asking", source: "fixture", ...over };
}

/** The DH03 qualifying history: returned 8 days ago, 214,950 → 199,950. */
function qualifying(propertyId: string, sources: string[]): PropertyHistory {
  return {
    propertyId,
    listingId: `l-${propertyId}`,
    propertyType: "house",
    bedrooms: 2,
    sources,
    observations: [
      obs({ id: `${propertyId}-o1`, propertyId, observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }),
      obs({ id: `${propertyId}-o2`, propertyId, observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
      obs({ id: `${propertyId}-o3`, propertyId, observedAt: daysBefore(8), status: "available", pricePence: fromMajor(199_950) }),
    ],
  };
}

function criteria(over: Parameters<typeof validateCriteria>[0] = {}): DealHuntCriteria {
  const v = validateCriteria({
    geographyId: "pilot-birmingham",
    askingPriceLimitPence: fromMajor(225_000),
    propertyTypes: ["house"],
    bedroomsMin: 2,
    bedroomsMax: 3,
    minimumDropBps: 500,
    ...over,
  });
  if (!v.ok) throw new Error(`bad criteria: ${v.errors.join(", ")}`);
  return v.criteria;
}

describe("evaluateHunt", () => {
  it("matches a qualifying property and excludes a non-returner (DH03/DH04)", () => {
    const histories: PropertyHistory[] = [
      qualifying("match", ["fixture"]),
      // DH04: a cut BEFORE under offer, unchanged after — not eligible.
      {
        propertyId: "nope",
        listingId: "l-nope",
        propertyType: "house",
        bedrooms: 2,
        sources: ["fixture"],
        observations: [
          obs({ id: "n-o1", propertyId: "nope", observedAt: daysBefore(150), status: "available", pricePence: fromMajor(220_000) }),
          obs({ id: "n-o2", propertyId: "nope", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }),
          obs({ id: "n-o3", propertyId: "nope", observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
          obs({ id: "n-o4", propertyId: "nope", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(214_950) }),
        ],
      },
    ];
    const ev = evaluateHunt(criteria(), histories, RUN_AT);
    expect(ev.matches.map((m) => m.propertyId)).toEqual(["match"]);
    expect(ev.eligibleCount).toBe(1);
    expect(ev.excludedCount).toBe(1);
  });

  it("merges one property on two feeds into a single result with provenance (DH09)", () => {
    const histories = [qualifying("dup", ["zoopla"]), qualifying("dup", ["rightmove"])];
    const ev = evaluateHunt(criteria(), histories, RUN_AT);
    expect(ev.matches).toHaveLength(1);
    expect([...ev.matches[0]!.provenance].sort()).toEqual(["rightmove", "zoopla"]);
  });

  it("excludes an ambiguous cross-agent identity pending review (DH05)", () => {
    const h = { ...qualifying("amb", ["fixture"]), ambiguousIdentity: true };
    const ev = evaluateHunt(criteria(), [h], RUN_AT);
    expect(ev.matches).toHaveLength(0);
    expect(ev.excludedCount).toBe(1);
  });

  it("excludes a match above the price ceiling", () => {
    const ev = evaluateHunt(criteria({ askingPriceLimitPence: fromMajor(190_000) }), [qualifying("over", ["fixture"])], RUN_AT);
    expect(ev.matches).toHaveLength(0); // current 199,950 is above a 190,000 ceiling
  });

  it("rejects a listing whose explicit type filter cannot be satisfied", () => {
    const h = { ...qualifying("flat", ["fixture"]), propertyType: "flat" };
    const ev = evaluateHunt(criteria(), [h], RUN_AT);
    expect(ev.matches).toHaveLength(0);
  });

  it("caps to the result limit and reports it (DH16 otherwise)", () => {
    const many: PropertyHistory[] = Array.from({ length: 5 }, (_, i) => qualifying(`m${i}`, ["fixture"]));
    const ev = evaluateHunt(criteria({ resultLimit: 3 }), many, RUN_AT);
    expect(ev.matches).toHaveLength(3);
    expect(ev.capped).toBe(true);
    expect(ev.eligibleCount).toBe(5);
  });

  it("returns an explicit zero-match coverage statement (DH16)", () => {
    const ev = evaluateHunt(criteria(), [], RUN_AT);
    expect(ev.matches).toHaveLength(0);
    expect(ev.coverage).toMatch(/No qualifying matches/i);
    expect(ev.coverage).toMatch(/monitored set/i);
  });
});

describe("runDealHuntJob (end to end through the store)", () => {
  let n = 0;
  const newId = () => `id-${(n += 1)}`;
  const query: DealHuntQuery = {
    id: "q-1",
    tenantId: "lode",
    investorId: "inv-1",
    revision: 1,
    criteria: criteria(),
    policyVersion: "deal-hunt-1",
    confirmedAt: RUN_AT.toISOString(),
  };

  beforeEach(() => {
    n = 0;
  });

  const liveSources = (over: Partial<DealHuntSources> = {}): DealHuntSources => ({
    listingsAvailable: () => true,
    histories: async () => [qualifying("p1", ["fixture"])],
    soldComparables: async () => [],
    rentalComparables: async () => null,
    subjectFor: () => ({ sold: { acceptableTypes: ["terraced"], tenure: "freehold" }, rent: { acceptableTypes: ["terraced"], bedrooms: 2 } }),
    ...over,
  });

  it("with no licensed feed, completes with a zero-match coverage boundary (IND02)", async () => {
    let notified = 0;
    const { run, results } = await runDealHuntJob(query, EMPTY_SOURCES, { now: RUN_AT, newId, notify: () => { notified += 1; } });
    expect(run.state).toBe("completed");
    expect(run.counts?.eligible).toBe(0);
    expect(run.coverage).toMatch(/No licensed listing feed/i);
    expect(results).toHaveLength(0);
    expect(notified).toBe(1);
  });

  it("completes a live hunt, persists results and notifies once (DH12)", async () => {
    let notified = 0;
    const { run, results } = await runDealHuntJob(query, liveSources(), { now: RUN_AT, newId, notify: () => { notified += 1; } });
    expect(run.state).toBe("completed");
    expect(results).toHaveLength(1);
    expect(results[0]!.enrichment.rent).toBe("missing"); // rent_unavailable
    expect(results[0]!.enrichment.sold).toBe("ready");
    expect(notified).toBe(1);
    const persisted = await listDealHuntResults(run.id);
    expect(persisted).toHaveLength(1);
    expect((await getDealHuntRun(run.id))?.state).toBe("completed");
  });

  it("returns a retryable failure when the listing feed is unavailable, not an empty shortlist", async () => {
    const { run, results } = await runDealHuntJob(
      query,
      liveSources({ histories: async () => { throw new Error("timeout"); } }),
      { now: RUN_AT, newId },
    );
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("listing-feed-unavailable");
    expect(results).toHaveLength(0);
  });

  it("returns a partial shortlist when comparable enrichment fails (DH11)", async () => {
    const { run, results } = await runDealHuntJob(
      query,
      liveSources({ soldComparables: async () => { throw new Error("comparable outage"); } }),
      { now: RUN_AT, newId },
    );
    expect(run.state).toBe("partial");
    expect(results).toHaveLength(1);
    expect(results[0]!.enrichment.sold).toBe("failed");
    expect(run.coverage).toMatch(/retried/i);
  });
});
