import {
  detectMovement,
  scoreTrend,
  type Movement,
  type ScoredTrend,
  type SourceFamilyEvidence,
  type TrendVeto,
} from "@shared/domain/trend/scoring";
import {
  validateGrowthBrief,
  ACTIVE_CHANNELS_V1,
  type BriefChannel,
  type GrowthBrief,
} from "@shared/domain/trend/brief";
import type { TrendCandidate, TrendObservationSource } from "@shared/domain/trend/candidate";

/**
 * Trend Intelligence — the headless scorer.
 *
 * It takes candidates from an observation source (the live platform-signal
 * adapter, or the dev fixture source) and scores each one end to end, producing
 * a validated Growth Brief draft where the decision is eligible. There is no UI
 * here and no page consumes it: the engine runs invisibly, driven by the trend
 * cron, and its output is recorded and made resolvable for the existing agents
 * (decision #42 — a live call site, not a visible feature).
 *
 * Deterministic: no model is called. Fit, intent, timing and readiness come from
 * the candidate's verified profile mapping, demand from the detection math, and
 * the brief is validated against the §6 contract before it is emitted.
 */

export interface ScoredOpportunity {
  readonly candidate: TrendCandidate;
  readonly movement: Movement;
  readonly scored: ScoredTrend;
  /** A validated Growth Brief draft, present only when the decision is `brief`. */
  readonly brief?: GrowthBrief;
}

/** Persistent topics get a seven-day brief; breaking topics 24 hours (§17). */
function briefWindow(klass: TrendCandidate["topicClass"], now: Date): { validFrom: string; expiresAt: string } {
  const hours = klass === "breaking" ? 24 : 24 * 7;
  return {
    validFrom: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function toFamilyEvidence(c: TrendCandidate): SourceFamilyEvidence[] {
  return c.families.map((f) => ({
    family: f.family,
    quality: f.quality,
    coverage: f.coverage,
    freshness: f.freshness,
    ...(f.contextOnly ? { contextOnly: true } : {}),
  }));
}

/**
 * Score one candidate end to end: detect movement over its count feed, score
 * opportunity + confidence, decide, and — only when eligible — assemble and
 * validate a Growth Brief draft. A brief that fails its own contract is a bug,
 * so it is dropped rather than emitted (the opportunity stays without one).
 */
export function scoreCandidate(candidate: TrendCandidate, now: Date): ScoredOpportunity {
  const movement = detectMovement(candidate.countFeed);

  const vetoes: TrendVeto[] = [...candidate.vetoes];
  const scored = scoreTrend({
    opportunity: {
      demand: movement.demandScore,
      fit: candidate.profile.fit,
      intent: candidate.profile.intent,
      timing: candidate.profile.timing,
      readiness: candidate.profile.readiness,
    },
    families: toFamilyEvidence(candidate),
    vetoes,
    autoOptIn: candidate.profile.autoOptIn,
    insufficientHistory: movement.insufficientHistory,
  });

  let brief: GrowthBrief | undefined;
  if (scored.decision === "brief" || scored.decision === "auto") {
    const window = briefWindow(candidate.topicClass, now);
    const channels = candidate.profile.allowedChannels.filter((c): c is BriefChannel =>
      ACTIVE_CHANNELS_V1.includes(c),
    );
    const draft = {
      schema_version: 1 as const,
      brief_id: `gb_${candidate.topicId}`.slice(0, 128),
      brief_version: 1,
      tenant_id: candidate.installationId,
      platform_id: candidate.platformId,
      market: candidate.market,
      locale: candidate.locale,
      topic_id: candidate.topicId,
      opportunity_score: scored.opportunityScore,
      confidence: scored.confidence,
      valid_from: window.validFrom,
      expires_at: window.expiresAt,
      evidence_ids: candidate.evidenceIds,
      audience: candidate.profile.audience,
      intent: candidate.profile.intentText,
      approved_claim_ids: candidate.profile.approvedClaimIds,
      cta_id: candidate.profile.ctaId,
      allowed_channels: channels.length > 0 ? channels : ["seo"],
      prohibited_claims: candidate.profile.prohibitedClaims,
      objective: candidate.profile.objective,
      experiment_id: candidate.profile.experimentId,
      policy_version: candidate.profile.policyVersion,
    };
    const validated = validateGrowthBrief(draft);
    if (validated.ok) brief = validated.brief;
  }

  return { candidate, movement, scored, ...(brief ? { brief } : {}) };
}

/**
 * Score every candidate in an observation source, ranked by opportunity score
 * (deterministic tie-break by topic id). With no candidates the result is empty
 * — the honest coverage boundary.
 */
export function scoreObservationSource(source: TrendObservationSource, now: Date): readonly ScoredOpportunity[] {
  return source.candidates
    .map((c) => scoreCandidate(c, now))
    .sort((a, b) => {
      const byScore = b.scored.opportunityScore - a.scored.opportunityScore;
      return byScore !== 0 ? byScore : a.candidate.topicId.localeCompare(b.candidate.topicId);
    });
}
