import { describe, expect, it } from "vitest";
import {
  createWatch,
  issueWatchEvents,
  pauseWatch,
  type WatchCandidate,
} from "@shared/domain/watchCursor";

function watch() {
  return createWatch({
    id: "w1",
    tenantId: "lode",
    ownerId: "inv-1",
    queryId: "q1",
    queryRevision: 1,
    scope: "search",
    now: "2026-06-01T00:00:00.000Z",
  });
}

const cand = (propertyId: string, episodeKey: string, at: string, changeToken?: string): WatchCandidate => ({
  propertyId,
  episodeKey,
  at,
  ...(changeToken !== undefined ? { changeToken } : {}),
});

describe("saved watches (Deal Hunt §7 / WatchCursor §5 / IND13)", () => {
  it("alerts on a new qualifying episode and advances the cursor", () => {
    const { events, watch: next } = issueWatchEvents(
      watch(),
      [cand("p1", "e1", "2026-06-05T00:00:00.000Z")],
      "2026-06-05T01:00:00.000Z",
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("new-qualifying");
    expect(next.watermark).toBe("2026-06-05T00:00:00.000Z");
    expect(next.dedupeKeys).toHaveLength(1);
  });

  it("emits one alert per episode even when the observation is replayed (IND13)", () => {
    const first = issueWatchEvents(watch(), [cand("p1", "e1", "2026-06-05T00:00:00.000Z")], "t1");
    // The same episode arrives again — a duplicate observation replay.
    const second = issueWatchEvents(first.watch, [cand("p1", "e1", "2026-06-05T00:00:00.000Z")], "t2");
    expect(second.events).toHaveLength(0);
    expect(second.watch.dedupeKeys).toHaveLength(1); // unchanged
  });

  it("alerts once more on a material change within the same episode, then not again", () => {
    const first = issueWatchEvents(watch(), [cand("p1", "e1", "2026-06-05T00:00:00.000Z")], "t1");
    const changed = issueWatchEvents(first.watch, [cand("p1", "e1", "2026-06-09T00:00:00.000Z", "drop-2")], "t2");
    expect(changed.events).toHaveLength(1);
    expect(changed.events[0]!.kind).toBe("materially-changed");
    const again = issueWatchEvents(changed.watch, [cand("p1", "e1", "2026-06-09T00:00:00.000Z", "drop-2")], "t3");
    expect(again.events).toHaveLength(0);
  });

  it("notifies nothing while paused", () => {
    const paused = pauseWatch(watch(), "t0");
    const { events } = issueWatchEvents(paused, [cand("p9", "e9", "2026-06-05T00:00:00.000Z")], "t1");
    expect(events).toHaveLength(0);
  });
});
