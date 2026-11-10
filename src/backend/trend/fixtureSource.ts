import type { MovementInput, TrendVeto } from "@shared/domain/trend/scoring";
import type { BriefChannel } from "@shared/domain/trend/brief";

/**
 * The Trend Intelligence observation source.
 *
 * By default a clean installation has NO connected signal feed, so the
 * candidate list is empty and the console shows an honest coverage boundary —
 * never a synthetic opportunity presented as live. This is the same posture as
 * the Deal Hunt source (`EMPTY_SOURCES`): data is gated at the source, not the
 * UI. Only when `TREND_FIXTURES=1` is set (a staff pilot / development, never
 * production) does it serve a small, clearly-synthetic set — labelled as
 * fixtures by their platform ids — so the real detection, scoring and
 * brief-generation path can be exercised against known data.
 *
 * Two dissimilar profiles, per the §22 first-ticket requirement: a subscription
 * service in Canadian English measuring qualified trial starts, and a storefront
 * in French measuring completed orders. Fixture B carries only first-party
 * families (no public feed), proving a deployment can run on independent
 * first-party evidence alone.
 */

/** The verified profile mapping for a candidate (spec §17 — never model-set). */
export interface CandidateProfile {
  readonly fit: number;
  readonly intent: number;
  readonly timing: number;
  readonly readiness: number;
  readonly audience: string;
  readonly intentText: string;
  readonly objective: string;
  readonly approvedClaimIds: readonly string[];
  readonly ctaId: string;
  readonly allowedChannels: readonly BriefChannel[];
  readonly prohibitedClaims: readonly string[];
  readonly experimentId: string;
  readonly policyVersion: number;
  readonly autoOptIn?: boolean;
}

export interface CandidateFamily {
  readonly family: string;
  readonly quality: number;
  readonly coverage: number;
  readonly freshness: number;
  readonly contextOnly?: boolean;
}

/** One topic under consideration for an installation. */
export interface TrendCandidate {
  readonly installationId: string;
  readonly platformId: string;
  readonly market: string;
  readonly locale: string;
  readonly topicId: string;
  readonly topicLabel: string;
  readonly topicClass: "persistent" | "breaking";
  readonly countFeed: MovementInput;
  readonly families: readonly CandidateFamily[];
  readonly evidenceIds: readonly string[];
  readonly vetoes: readonly TrendVeto[];
  readonly profile: CandidateProfile;
}

export interface TrendObservationSource {
  readonly feedConnected: boolean;
  readonly candidates: readonly TrendCandidate[];
}

/** True when the staff-pilot fixtures are switched on (never in production). */
export function fixturesEnabled(): boolean {
  return process.env.TREND_FIXTURES === "1";
}

function fixtureCandidates(installationId: string): TrendCandidate[] {
  return [
    // Fixture A — subscription service, Canadian English, qualified trials.
    {
      installationId,
      platformId: "fixture_platform_a",
      market: "CA",
      locale: "en-CA",
      topicId: "simpler-team-onboarding",
      topicLabel: "Simpler team onboarding",
      topicClass: "persistent",
      countFeed: { current: 64, baseline: 12, history: [10, 12, 11, 13, 12, 14, 11, 12] },
      families: [
        { family: "first_party_events", quality: 90, coverage: 0.7, freshness: 90 },
        { family: "crm_support", quality: 90, coverage: 0.7, freshness: 90 },
      ],
      evidenceIds: ["ev_341", "ev_342"],
      vetoes: [],
      profile: {
        fit: 95,
        intent: 85,
        timing: 90,
        readiness: 80,
        audience: "Small teams comparing onboarding options",
        intentText: "evaluate how to onboard a small team",
        objective: "qualified trial starts per eligible session",
        approvedClaimIds: ["claim_onboarding_01"],
        ctaId: "cta_view_onboarding_guide",
        allowedChannels: ["seo", "organic_social"],
        prohibitedClaims: ["guaranteed onboarding time", "unsupported third-party endorsements"],
        experimentId: "exp_91",
        policyVersion: 5,
      },
    },
    // Fixture B — storefront, French in France, completed orders. First-party
    // families only (no public feed), proving independent first-party evidence.
    {
      installationId,
      platformId: "fixture_platform_b",
      market: "FR",
      locale: "fr-FR",
      topicId: "chaises-de-bureau-ergonomiques",
      topicLabel: "Chaises de bureau ergonomiques",
      topicClass: "persistent",
      countFeed: { current: 52, baseline: 14, history: [13, 15, 14, 12, 16, 13, 14, 15] },
      families: [
        { family: "first_party_events", quality: 88, coverage: 0.8, freshness: 85 },
        { family: "first_party_orders", quality: 92, coverage: 0.75, freshness: 88 },
      ],
      evidenceIds: ["ev_501", "ev_502"],
      vetoes: [],
      profile: {
        fit: 90,
        intent: 88,
        timing: 80,
        readiness: 85,
        audience: "Acheteurs comparant des chaises de bureau",
        intentText: "comparer des chaises de bureau ergonomiques",
        objective: "commandes complétées par session éligible",
        approvedClaimIds: ["claim_chaise_01"],
        ctaId: "cta_voir_collection_chaises",
        allowedChannels: ["seo", "organic_social"],
        prohibitedClaims: ["garantie de livraison non vérifiée"],
        experimentId: "exp_fr_12",
        policyVersion: 3,
      },
    },
    // Fixture C — a strong demand signal with NO stock: readiness 0 must veto
    // live activation and the console must show the veto, not a brief.
    {
      installationId,
      platformId: "fixture_platform_a",
      market: "CA",
      locale: "en-CA",
      topicId: "advanced-reporting-pack",
      topicLabel: "Advanced reporting pack (out of stock)",
      topicClass: "persistent",
      countFeed: { current: 70, baseline: 10, history: [9, 11, 10, 12, 10, 11, 9, 10] },
      families: [
        { family: "first_party_events", quality: 90, coverage: 0.8, freshness: 92 },
        { family: "crm_support", quality: 88, coverage: 0.7, freshness: 90 },
      ],
      evidenceIds: ["ev_601", "ev_602"],
      vetoes: [],
      profile: {
        fit: 92,
        intent: 90,
        timing: 85,
        readiness: 0,
        audience: "Teams asking for advanced reporting",
        intentText: "evaluate advanced reporting",
        objective: "qualified trial starts per eligible session",
        approvedClaimIds: ["claim_reporting_01"],
        ctaId: "cta_reporting",
        allowedChannels: ["seo"],
        prohibitedClaims: [],
        experimentId: "exp_93",
        policyVersion: 5,
      },
    },
  ];
}

/**
 * Resolve the observation source for an installation. Empty (no feed) unless the
 * staff-pilot fixtures are explicitly enabled.
 */
export function trendObservationSource(installationId: string): TrendObservationSource {
  if (!fixturesEnabled()) return { feedConnected: false, candidates: [] };
  return { feedConnected: true, candidates: fixtureCandidates(installationId) };
}
