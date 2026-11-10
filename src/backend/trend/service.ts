import {
  detectMovement,
  scoreTrend,
  round1,
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
import { trendObservationSource, type TrendCandidate } from "@backend/trend/fixtureSource";

/**
 * Trend Intelligence — the server-side producer that runs the deterministic
 * engine over an installation's observations and yields scored opportunities
 * and, where eligible, a validated Growth Brief draft.
 *
 * This is the live call site that stops the engine being inert (decision #42).
 * It is deliberately the same posture as Deal Hunt: with no connected feed the
 * installation has no observations and the console shows an honest empty state
 * (the coverage boundary), and only a `TREND_FIXTURES=1` staff pilot drives a
 * small, clearly-synthetic candidate set so the real scoring, detection and
 * brief-generation path can be exercised against known data. Nothing here
 * fabricates a "live" number — the engine's output is shown over whatever
 * observations are actually present.
 *
 * Deterministic mode, as the spec permits (§2): no model is called. Fit, intent,
 * timing and readiness come from the platform profile's verified mapping, demand
 * comes from the detection math over the count feed, and the brief is assembled
 * from those and validated against the §6 contract before it is shown.
 */

export interface ScoredOpportunity {
  readonly candidate: TrendCandidate;
  readonly movement: Movement;
  readonly scored: ScoredTrend;
  /** A validated Growth Brief draft, present only when the decision is `brief`. */
  readonly brief?: GrowthBrief;
}

export interface TrendConsoleView {
  readonly feedConnected: boolean;
  readonly opportunities: readonly ScoredOpportunity[];
}

/** Persistent topics get a seven-day brief; breaking topics 24 hours (§17). */
function briefWindow(klass: TrendCandidate["topicClass"], now: Date): { validFrom: string; expiresAt: string } {
  const hours = klass === "breaking" ? 24 : 24 * 7;
  return {
    validFrom: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function toFamilyEvidence(c: TrendCandidate, demand: number): SourceFamilyEvidence[] {
  // The demand family carries the computed demand as its quality proxy is not
  // used for demand; demand is supplied to scoreTrend separately. Here we build
  // the confidence families straight from the candidate's declared families.
  void demand;
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
 * so it is dropped rather than shown (and the opportunity stays visible without
 * one).
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
    families: toFamilyEvidence(candidate, movement.demandScore),
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
 * The console view: every candidate the installation currently has, scored and
 * ranked by opportunity score (deterministic tie-break by topic id). With no
 * feed connected the candidate list is empty and the caller shows the coverage
 * boundary.
 */
export function trendConsole(installationId: string, now: Date = new Date()): TrendConsoleView {
  const source = trendObservationSource(installationId);
  const opportunities = source.candidates
    .map((c) => scoreCandidate(c, now))
    .sort((a, b) => {
      const byScore = b.scored.opportunityScore - a.scored.opportunityScore;
      return byScore !== 0 ? byScore : a.candidate.topicId.localeCompare(b.candidate.topicId);
    });
  return { feedConnected: source.feedConnected, opportunities };
}

/** Re-export for the surface so it need not reach into the scoring module. */
export { round1 };
