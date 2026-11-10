import type { TrendCandidate, TrendObservationSource } from "@shared/domain/trend/candidate";

export type {
  CandidateProfile,
  CandidateFamily,
  TrendCandidate,
  TrendObservationSource,
} from "@shared/domain/trend/candidate";

/**
 * The Trend Intelligence DEV-ONLY fixture source.
 *
 * The real, live source is `platformDemand` + `backend/trend/platformSignals`,
 * which read LODE's own first-party demand. This file exists only so the engine
 * can be exercised against a known, clearly-synthetic set when
 * `TREND_FIXTURES=1` is set (development, never production). The two dissimilar
 * profiles follow the §22 first-ticket requirement: a subscription service in
 * Canadian English measuring qualified trial starts, and a storefront in French
 * measuring completed orders, the latter on independent first-party evidence
 * alone. Nothing here is ever presented as live platform demand.
 */

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
