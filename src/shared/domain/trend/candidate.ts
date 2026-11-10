import type { MovementInput, TrendVeto } from "@shared/domain/trend/scoring";
import type { BriefChannel } from "@shared/domain/trend/brief";

/**
 * Trend Intelligence — the candidate shape the engine scores.
 *
 * Pure types shared by every observation source: the real platform-signal
 * adapter (`platformDemand`) and the dev-only fixture source. A candidate is one
 * topic under consideration for an installation, carrying its detection feed,
 * its corroborating source families, and the verified profile mapping (§17) that
 * supplies fit, intent, timing, the audience, the approved claims and the
 * channels. Demand and readiness are the live figures; everything else on the
 * profile is a declared constant.
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
