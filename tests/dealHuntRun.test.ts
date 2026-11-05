import { describe, expect, it } from "vitest";
import { bps, fromMajor } from "@shared/money";
import {
  advanceRun,
  isTerminalRun,
  queueRun,
  rankResults,
  type DealHuntResult,
} from "@shared/domain/dealHuntRun";

const base = {
  id: "run-1",
  queryId: "q-1",
  investorId: "inv-1",
  sourceWatermark: "2026-06-15T00:00:00.000Z",
  runAt: "2026-06-15T12:00:00.000Z",
  correlationId: "corr-1",
  now: "2026-06-15T12:00:00.000Z",
};

describe("Deal Hunt run lifecycle", () => {
  it("queues, then advances and counts one attempt on first search", () => {
    const q = queueRun(base);
    expect(q.state).toBe("queued");
    expect(q.attempts).toBe(0);
    const searching = advanceRun(q, "searching", { now: "2026-06-15T12:00:01.000Z" });
    expect(searching.state).toBe("searching");
    expect(searching.attempts).toBe(1);
  });

  it("refuses to change a terminal run (a cancelled job stays cancelled)", () => {
    const q = queueRun(base);
    const cancelled = advanceRun(q, "cancelled", { now: "2026-06-15T12:00:02.000Z" });
    expect(isTerminalRun(cancelled.state)).toBe(true);
    const attempted = advanceRun(cancelled, "completed", { now: "2026-06-15T12:00:03.000Z" });
    expect(attempted).toBe(cancelled); // unchanged, no rewrite
  });

  it("carries counts and coverage onto completion", () => {
    const q = advanceRun(queueRun(base), "searching", { now: base.now });
    const done = advanceRun(q, "completed", {
      now: "2026-06-15T12:01:00.000Z",
      counts: { eligible: 3, excluded: 7, capped: false },
      coverage: "3 matches in pilot-birmingham.",
    });
    expect(done.counts?.eligible).toBe(3);
    expect(done.coverage).toMatch(/3 matches/);
  });
});

describe("result ranking (§3.6)", () => {
  it("ranks by newest return, then larger reduction, then stable id", () => {
    const r = (id: string, watermark: string, drop: number): Omit<DealHuntResult, "rank"> => ({
      id,
      runId: "run-1",
      propertyId: id,
      listingId: `l-${id}`,
      episodeKey: `ep-${id}`,
      baselineObservationId: "o1",
      currentObservationId: "o3",
      returnEventObservationId: "o3",
      reason: "returned_to_market_reason_unverified",
      baselinePence: fromMajor(214_950),
      currentPence: fromMajor(214_950 - drop),
      dropPence: fromMajor(drop),
      dropBps: bps(0),
      resultWatermark: watermark,
      matchReasons: [],
      provenance: ["fixture"],
      stale: false,
      enrichment: { sold: "pending", rent: "pending" },
    });
    const ranked = rankResults([
      r("b", "2026-06-01", 20_000),
      r("a", "2026-06-07", 10_000),
      r("c", "2026-06-07", 15_000),
    ]);
    // Newest return first (a,c tie on date → larger drop c before a), then b.
    expect(ranked.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(ranked.map((x) => x.rank)).toEqual([1, 2, 3]);
  });
});
