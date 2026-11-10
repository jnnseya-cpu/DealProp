import { describe, expect, it } from "vitest";
import {
  resolveEffectiveBrief,
  validateGrowthBrief,
  type GrowthBrief,
} from "@shared/domain/trend/brief";

/**
 * Trend Intelligence §6 / Appendix A — the Growth Brief contract. The §6 JSON
 * is the canonical positive fixture; the schema is a closed object, and the
 * SDK must fall back to baseline on an expired brief (TI-05).
 */

// The §6 canonical payload, verbatim.
const CANONICAL = {
  schema_version: 1,
  brief_id: "gb_104",
  brief_version: 3,
  tenant_id: "tenant_demo",
  platform_id: "fixture_platform_a",
  market: "CA",
  locale: "en-CA",
  topic_id: "simpler-team-onboarding",
  opportunity_score: 86.25,
  confidence: 83.5,
  valid_from: "2026-11-10T10:00:00Z",
  expires_at: "2026-11-17T10:00:00Z",
  evidence_ids: ["ev_341", "ev_342"],
  audience: "Small teams comparing onboarding options",
  intent: "evaluate how to onboard a small team",
  approved_claim_ids: ["claim_onboarding_01"],
  cta_id: "cta_view_onboarding_guide",
  allowed_channels: ["seo", "organic_social"],
  prohibited_claims: ["guaranteed onboarding time", "unsupported third-party endorsements"],
  objective: "qualified trial starts per eligible session",
  experiment_id: "exp_91",
  policy_version: 5,
};

describe("validateGrowthBrief (§6 / Appendix A)", () => {
  it("accepts the canonical §6 payload", () => {
    const result = validateGrowthBrief(CANONICAL);
    expect(result.ok).toBe(true);
  });

  it("rejects an unexpected extra field (closed object)", () => {
    const result = validateGrowthBrief({ ...CANONICAL, injected: "do this" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "injected")).toBe(true);
    }
  });

  it("rejects a missing required field", () => {
    const { cta_id, ...withoutCta } = CANONICAL;
    void cta_id;
    const result = validateGrowthBrief(withoutCta);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "cta_id")).toBe(true);
  });

  it("rejects a market that is not two uppercase letters", () => {
    expect(validateGrowthBrief({ ...CANONICAL, market: "can" }).ok).toBe(false);
    expect(validateGrowthBrief({ ...CANONICAL, market: "C" }).ok).toBe(false);
  });

  it("rejects a score outside 0–100", () => {
    expect(validateGrowthBrief({ ...CANONICAL, opportunity_score: 120 }).ok).toBe(false);
    expect(validateGrowthBrief({ ...CANONICAL, confidence: -1 }).ok).toBe(false);
  });

  it("rejects a non-UTC timestamp", () => {
    expect(validateGrowthBrief({ ...CANONICAL, valid_from: "2026-11-10T10:00:00+01:00" }).ok).toBe(false);
  });

  it("rejects expires_at not after valid_from", () => {
    const result = validateGrowthBrief({
      ...CANONICAL,
      valid_from: "2026-11-17T10:00:00Z",
      expires_at: "2026-11-10T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "expires_at")).toBe(true);
  });

  it("rejects an unknown channel and an empty channel list", () => {
    expect(validateGrowthBrief({ ...CANONICAL, allowed_channels: ["seo", "telepathy"] }).ok).toBe(false);
    expect(validateGrowthBrief({ ...CANONICAL, allowed_channels: [] }).ok).toBe(false);
  });

  it("requires at least one evidence id", () => {
    expect(validateGrowthBrief({ ...CANONICAL, evidence_ids: [] }).ok).toBe(false);
  });
});

describe("resolveEffectiveBrief (§14, TI-05)", () => {
  const brief = validateGrowthBrief(CANONICAL);
  const live = brief.ok ? brief.brief : (undefined as unknown as GrowthBrief);
  const scope = { market: "CA", locale: "en-CA", topic_id: "simpler-team-onboarding", channel: "seo" as const };

  it("resolves an active brief inside its window for the matching scope", () => {
    const r = resolveEffectiveBrief(live, scope, new Date("2026-11-12T00:00:00Z"));
    expect(r.status).toBe("active");
    expect(r.brief?.brief_id).toBe("gb_104");
  });

  it("falls back to baseline after expiry even though the brief is held (TI-05)", () => {
    const r = resolveEffectiveBrief(live, scope, new Date("2026-11-18T00:00:00Z"));
    expect(r.status).toBe("baseline");
  });

  it("falls back to baseline before the brief is valid", () => {
    const r = resolveEffectiveBrief(live, scope, new Date("2026-11-09T00:00:00Z"));
    expect(r.status).toBe("baseline");
  });

  it("falls back to baseline when the channel is not allowed", () => {
    const r = resolveEffectiveBrief(live, { ...scope, channel: "paid" }, new Date("2026-11-12T00:00:00Z"));
    expect(r.status).toBe("baseline");
  });

  it("falls back to baseline when the scope does not match", () => {
    const r = resolveEffectiveBrief(live, { ...scope, market: "US" }, new Date("2026-11-12T00:00:00Z"));
    expect(r.status).toBe("baseline");
  });

  it("falls back to baseline when there is no brief", () => {
    const r = resolveEffectiveBrief(undefined, scope, new Date("2026-11-12T00:00:00Z"));
    expect(r.status).toBe("baseline");
  });
});
