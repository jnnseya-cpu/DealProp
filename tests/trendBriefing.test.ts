import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveBriefFor, platformBriefing } from "@backend/trend/briefing";

/**
 * Trend Intelligence — the invisible control layer. With the dev fixtures
 * enabled, platformBriefing produces eligible briefs and effectiveBriefFor
 * resolves them for the agents (active in scope, baseline out of scope / past
 * expiry, TI-05). The live path reads LODE's real stores instead.
 */

describe("platformBriefing + effectiveBriefFor (§4 resolver)", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  beforeEach(() => {
    process.env.TREND_FIXTURES = "1";
  });
  afterEach(() => {
    delete process.env.TREND_FIXTURES;
  });

  it("produces eligible briefs over the fixture demand", async () => {
    const briefing = await platformBriefing(now);
    expect(briefing.opportunities.length).toBeGreaterThan(0);
    expect(briefing.briefs.length).toBeGreaterThan(0);
  });

  it("resolves an active brief for a matching scope and channel", async () => {
    const eff = await effectiveBriefFor(
      { market: "CA", locale: "en-CA", topicId: "simpler-team-onboarding", channel: "seo" },
      now,
    );
    expect(eff.status).toBe("active");
    expect(eff.brief?.topic_id).toBe("simpler-team-onboarding");
  });

  it("falls back to baseline for an out-of-scope market", async () => {
    const eff = await effectiveBriefFor(
      { market: "US", locale: "en-CA", topicId: "simpler-team-onboarding", channel: "seo" },
      now,
    );
    expect(eff.status).toBe("baseline");
  });

  it("falls back to baseline for a channel the brief does not allow", async () => {
    const eff = await effectiveBriefFor(
      { market: "CA", locale: "en-CA", topicId: "simpler-team-onboarding", channel: "paid" },
      now,
    );
    expect(eff.status).toBe("baseline");
  });
});
