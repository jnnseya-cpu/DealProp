import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scoreCandidate, scoreObservationSource } from "@backend/trend/service";
import { trendObservationSource } from "@backend/trend/fixtureSource";
import { validateGrowthBrief } from "@shared/domain/trend/brief";

/**
 * Trend Intelligence headless scorer — the dev fixture source still exercises
 * the full scoring + brief-generation path (TI-16/TI-17/TI-21 and the readiness
 * veto). The live source is platformSignals; this proves the engine over known
 * data.
 */

describe("trendObservationSource (dev fixtures)", () => {
  const prev = process.env.TREND_FIXTURES;
  afterEach(() => {
    if (prev === undefined) delete process.env.TREND_FIXTURES;
    else process.env.TREND_FIXTURES = prev;
  });

  it("is empty unless explicitly enabled", () => {
    delete process.env.TREND_FIXTURES;
    expect(trendObservationSource("inst_a").candidates).toHaveLength(0);
  });

  it("serves the staff pilot only when enabled", () => {
    process.env.TREND_FIXTURES = "1";
    expect(trendObservationSource("inst_a").candidates.length).toBeGreaterThan(0);
  });
});

describe("scoreObservationSource with fixtures (TI-16/TI-17/TI-21)", () => {
  beforeEach(() => {
    process.env.TREND_FIXTURES = "1";
  });
  afterEach(() => {
    delete process.env.TREND_FIXTURES;
  });

  it("scores the subscription fixture to a reviewable brief with a valid draft", () => {
    const scored = scoreObservationSource(trendObservationSource("inst_a"), new Date("2026-11-10T10:00:00Z"));
    const sub = scored.find((o) => o.candidate.topicId === "simpler-team-onboarding");
    expect(sub?.scored.decision).toBe("brief");
    expect(validateGrowthBrief(sub?.brief).ok).toBe(true);
  });

  it("runs the French storefront on first-party evidence only (TI-17)", () => {
    const scored = scoreObservationSource(trendObservationSource("inst_a"), new Date("2026-11-10T10:00:00Z"));
    const store = scored.find((o) => o.candidate.topicId === "chaises-de-bureau-ergonomiques");
    expect(store?.candidate.locale).toBe("fr-FR");
    expect(store?.brief?.objective).toContain("commandes");
  });

  it("vetoes the out-of-stock topic: strong demand, no brief", () => {
    const scored = scoreObservationSource(trendObservationSource("inst_a"), new Date("2026-11-10T10:00:00Z"));
    const oos = scored.find((o) => o.candidate.topicId === "advanced-reporting-pack");
    expect(oos?.scored.vetoes).toContain("missing-readiness");
    expect(oos?.scored.decision).toBe("watch");
    expect(oos?.brief).toBeUndefined();
  });

  it("ranks by opportunity score", () => {
    const scored = scoreObservationSource(trendObservationSource("inst_a"), new Date("2026-11-10T10:00:00Z"));
    const scores = scored.map((o) => o.scored.opportunityScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("gives a persistent topic a seven-day brief window (§17)", () => {
    const source = trendObservationSource("inst_a");
    const persistent = source.candidates.find((c) => c.topicClass === "persistent" && c.profile.readiness > 0);
    expect(persistent).toBeDefined();
    if (persistent) {
      const scored = scoreCandidate(persistent, new Date("2026-11-10T10:00:00Z"));
      expect(scored.brief?.valid_from).toBe("2026-11-10T10:00:00Z");
      expect(scored.brief?.expires_at).toBe("2026-11-17T10:00:00Z");
    }
  });
});
