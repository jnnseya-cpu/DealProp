import { describe, expect, it } from "vitest";
import {
  buildPlatformCandidates,
  readinessFromBuyers,
  weeklyDemand,
  LODE_PROFILE,
  MIN_AREA_DEALS,
  type PlatformDemandInput,
} from "@shared/domain/trend/platformDemand";
import { scoreTrend } from "@shared/domain/trend/scoring";

const DAY = 86_400_000;
const now = new Date("2026-11-10T00:00:00Z");

/** n timestamps spread across the window k weeks before `now`. */
function week(k: number, n: number): string[] {
  const base = now.getTime() - (k * 7 + 3) * DAY; // mid-window
  return Array.from({ length: n }, (_, i) => new Date(base - i * 3600_000).toISOString());
}

describe("weeklyDemand (§5.2, real series)", () => {
  it("counts the current complete week and prior comparable weeks", () => {
    const ts = [...week(0, 12), ...week(1, 4), ...week(2, 5), ...week(3, 4), ...week(4, 6)];
    const m = weeklyDemand(ts, now);
    expect(m.current).toBe(12);
    expect(m.history.length).toBe(8);
    expect(m.history.slice(0, 4)).toEqual([4, 5, 4, 6]);
  });
});

describe("readinessFromBuyers (real capacity)", () => {
  it("is zero with no active Buy Box (a veto)", () => {
    expect(readinessFromBuyers(0)).toBe(0);
  });
  it("is full at or above the target buyer count", () => {
    expect(readinessFromBuyers(5)).toBe(100);
    expect(readinessFromBuyers(9)).toBe(100);
  });
});

function input(over: Partial<PlatformDemandInput> = {}): PlatformDemandInput {
  const deals = [
    ...week(0, 10).map((createdAt) => ({ createdAt, postcodeArea: "B23" })),
    ...week(1, 2).map((createdAt) => ({ createdAt, postcodeArea: "B23" })),
    ...week(2, 2).map((createdAt) => ({ createdAt, postcodeArea: "B23" })),
    ...week(3, 2).map((createdAt) => ({ createdAt, postcodeArea: "B23" })),
    ...week(4, 2).map((createdAt) => ({ createdAt, postcodeArea: "CV1" })),
  ];
  return {
    deals,
    enquiries: [...week(0, 6), ...week(1, 3), ...week(2, 3), ...week(3, 3)],
    pageAttention: 400,
    pageAttentionLatest: now.toISOString(),
    activeBuyBoxes: 5,
    now,
    ...over,
  };
}

describe("buildPlatformCandidates (embedded on LODE's real demand)", () => {
  it("produces a platform-wide candidate from real deals", () => {
    const candidates = buildPlatformCandidates(input());
    expect(candidates[0]?.topicId).toBe("lode-inbound-property-enquiries");
    expect(candidates[0]?.platformId).toBe("lode");
    expect(candidates[0]?.market).toBe("GB");
  });

  it("returns nothing when there is no demand (honest empty, not zero interest)", () => {
    expect(buildPlatformCandidates(input({ deals: [] }))).toHaveLength(0);
  });

  it("adds a per-area topic only for areas above the deal threshold", () => {
    const candidates = buildPlatformCandidates(input());
    const b23 = candidates.find((c) => c.topicId === "lode-area-b23");
    const cv1 = candidates.find((c) => c.topicId === "lode-area-cv1");
    expect(b23).toBeDefined(); // 16 deals ≥ MIN_AREA_DEALS
    expect(cv1).toBeUndefined(); // 2 deals < MIN_AREA_DEALS
    expect(MIN_AREA_DEALS).toBeGreaterThan(2);
  });

  it("vetoes activation when there are no buyers to place the demand", () => {
    const candidates = buildPlatformCandidates(input({ activeBuyBoxes: 0 }));
    expect(candidates[0]?.vetoes).toContain("unavailable-inventory");
    const scored = scoreTrend({
      opportunity: { ...candidates[0]!.profile, demand: 90 },
      families: candidates[0]!.families,
      vetoes: candidates[0]!.vetoes,
    });
    expect(scored.decision).toBe("watch");
  });

  it("carries LODE's real channels and no financial-promotion claim", () => {
    expect(LODE_PROFILE.allowedChannels).toContain("seo");
    expect(LODE_PROFILE.prohibitedClaims).toContain("guaranteed returns");
    expect(LODE_PROFILE.objective).toContain("appraisal");
  });

  it("builds confidence from two independent families (deals + enquiries), not capped", () => {
    const candidates = buildPlatformCandidates(input());
    const independent = candidates[0]!.families.filter((f) => f.contextOnly !== true);
    expect(independent.length).toBe(2);
  });
});
