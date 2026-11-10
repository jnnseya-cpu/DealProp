import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { trendConsole, scoreCandidate } from "@backend/trend/service";
import { trendObservationSource } from "@backend/trend/fixtureSource";
import { validateGrowthBrief } from "@shared/domain/trend/brief";

/**
 * Trend Intelligence producer — the live call site (decision #42). Verifies the
 * engine is reachable, that it is empty with no feed (the honest coverage
 * boundary), and that the staff-pilot fixtures exercise the real path:
 * TI-16/TI-21 (a reviewable draft from first-party evidence) and the readiness
 * veto.
 */

describe("trendObservationSource (keyless default)", () => {
  const prev = process.env.TREND_FIXTURES;
  afterEach(() => {
    if (prev === undefined) delete process.env.TREND_FIXTURES;
    else process.env.TREND_FIXTURES = prev;
  });

  it("is empty with no feed connected", () => {
    delete process.env.TREND_FIXTURES;
    const source = trendObservationSource("inst_a");
    expect(source.feedConnected).toBe(false);
    expect(source.candidates).toHaveLength(0);
  });

  it("serves the staff pilot only when explicitly enabled", () => {
    process.env.TREND_FIXTURES = "1";
    const source = trendObservationSource("inst_a");
    expect(source.feedConnected).toBe(true);
    expect(source.candidates.length).toBeGreaterThan(0);
  });
});

describe("trendConsole with fixtures (TI-16/TI-21, TI-17)", () => {
  beforeEach(() => {
    process.env.TREND_FIXTURES = "1";
  });
  afterEach(() => {
    delete process.env.TREND_FIXTURES;
  });

  it("scores the subscription fixture to a reviewable brief with a valid draft", () => {
    const view = trendConsole("inst_a", new Date("2026-11-10T10:00:00Z"));
    const sub = view.opportunities.find((o) => o.candidate.topicId === "simpler-team-onboarding");
    expect(sub).toBeDefined();
    expect(sub?.scored.decision).toBe("brief");
    expect(sub?.brief).toBeDefined();
    // The generated brief conforms to the §6 contract.
    expect(validateGrowthBrief(sub?.brief).ok).toBe(true);
  });

  it("runs the French storefront on first-party evidence only, with its own locale and outcome (TI-17)", () => {
    const view = trendConsole("inst_a", new Date("2026-11-10T10:00:00Z"));
    const store = view.opportunities.find((o) => o.candidate.topicId === "chaises-de-bureau-ergonomiques");
    expect(store?.candidate.locale).toBe("fr-FR");
    expect(store?.candidate.market).toBe("FR");
    expect(store?.brief?.objective).toContain("commandes");
  });

  it("vetoes the out-of-stock topic: strong demand, no brief", () => {
    const view = trendConsole("inst_a", new Date("2026-11-10T10:00:00Z"));
    const oos = view.opportunities.find((o) => o.candidate.topicId === "advanced-reporting-pack");
    expect(oos?.scored.vetoes).toContain("missing-readiness");
    expect(oos?.scored.decision).toBe("watch");
    expect(oos?.brief).toBeUndefined();
  });

  it("ranks by opportunity score", () => {
    const view = trendConsole("inst_a", new Date("2026-11-10T10:00:00Z"));
    const scores = view.opportunities.map((o) => o.scored.opportunityScore);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});

describe("scoreCandidate brief window (§17)", () => {
  it("gives a persistent topic a seven-day brief", () => {
    process.env.TREND_FIXTURES = "1";
    const source = trendObservationSource("inst_a");
    const persistent = source.candidates.find((c) => c.topicClass === "persistent" && c.profile.readiness > 0);
    expect(persistent).toBeDefined();
    if (persistent) {
      const scored = scoreCandidate(persistent, new Date("2026-11-10T10:00:00Z"));
      expect(scored.brief?.valid_from).toBe("2026-11-10T10:00:00Z");
      expect(scored.brief?.expires_at).toBe("2026-11-17T10:00:00Z");
    }
    delete process.env.TREND_FIXTURES;
  });
});
