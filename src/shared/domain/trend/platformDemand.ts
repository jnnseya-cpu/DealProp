import type { MovementInput, TrendVeto } from "@shared/domain/trend/scoring";
import type { TrendCandidate, CandidateProfile } from "@shared/domain/trend/candidate";

/**
 * Trend Intelligence, embedded onto DealProp itself (not a separate installation).
 *
 * The engine reads LODE's OWN first-party demand — the deals and seller enquiries
 * people actually bring the platform — and scores where that demand is rising
 * against LODE's real capacity to serve it. There is no synthetic SaaS or
 * storefront profile here: the platform is LODE, the topics are its inbound
 * property demand by area, the channels are its real ones (SEO/blog, organic
 * social, the newsletter), and readiness is whether there are buyers to place
 * the deals (supply), not a made-up stock number.
 *
 * This module is the pure half: given timestamped demand, enquiries, page
 * attention and the live buyer count, it derives the observation windows and
 * assembles the candidates. The backend adapter reads the stores and calls it.
 *
 * Honesty rules carried from the rest of the platform:
 *  - **Demand is detected, not declared.** The count feed is real deals per
 *    complete seven-day window; the engine's own gates then decide whether a
 *    rise is real or noise, and fewer than four comparable windows is draft-only.
 *  - **Fit and intent are the profile's verified mapping** (spec §17), fixed
 *    constants for LODE's own service — the moving parts (demand, readiness) are
 *    the live figures, so nothing here is an invented number.
 *  - **No buyers, no activation.** Rising seller demand with no active Buy Box to
 *    place it is a readiness veto, not an opportunity — the same refusal LODE
 *    applies everywhere (you cannot serve demand you have no buyer for).
 *  - **No financial-promotion claim.** The profile's prohibited claims include
 *    guaranteed returns, yields and sale timescales (decision #59, FSMA s.21).
 */

export const PLATFORM_DEMAND_VERSION = "lode-trend-1";

/** Full readiness once this many active Buy Boxes exist to absorb demand. */
export const READINESS_TARGET_BUYERS = 5;
/** An area needs at least this many deals on record to be its own topic. */
export const MIN_AREA_DEALS = 8;
const DEMAND_WINDOWS = 8;
const WINDOW_DAYS = 7;
const STALE_AFTER_DAYS = 21;

/** LODE's real platform profile — its verified fit/intent mapping and channels. */
export const LODE_PROFILE: CandidateProfile = {
  // LODE's own inbound property demand definitionally fits its service.
  fit: 100,
  // A submitted deal or seller enquiry is explicit commercial intent.
  intent: 85,
  // Property demand has a reasonable actionable window.
  timing: 80,
  // Readiness is overwritten per candidate from the live buyer count.
  readiness: 0,
  audience: "Sellers and sourcing partners bringing property to LODE",
  intentText: "get a property appraised and placed with a buyer",
  objective: "qualified appraisal requests per eligible session",
  approvedClaimIds: ["claim_free_appraisal", "claim_sourcing_to_completion"],
  ctaId: "cta_free_appraisal",
  allowedChannels: ["seo", "organic_social", "lifecycle"],
  // No financial promotion — decision #59 / FSMA s.21.
  prohibitedClaims: [
    "guaranteed returns",
    "guaranteed yield",
    "guaranteed sale",
    "guaranteed timescale",
    "unsupported third-party endorsements",
  ],
  experimentId: "exp_lode_inbound",
  policyVersion: 1,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function msAt(ts: string): number {
  return Date.parse(ts);
}

/**
 * Count events into complete seven-day windows ending at `now`: the current
 * window [now-7d, now), then `DEMAND_WINDOWS` comparable windows before it. The
 * baseline is the median of those prior windows (spec §5.2 — this week vs the
 * median of prior comparable weeks).
 */
export function weeklyDemand(timestamps: readonly string[], now: Date): MovementInput {
  const end = now.getTime();
  const windowMs = WINDOW_DAYS * 86_400_000;
  const times = timestamps.map(msAt).filter((t) => Number.isFinite(t));

  const countWindow = (k: number): number => {
    const hi = end - k * windowMs;
    const lo = hi - windowMs;
    return times.filter((t) => t >= lo && t < hi).length;
  };

  const current = countWindow(0);
  const history: number[] = [];
  for (let k = 1; k <= DEMAND_WINDOWS; k += 1) history.push(countWindow(k));
  return { current, baseline: median(history), history };
}

/** Coverage proxy: the fraction of recent windows that carried any event (0–1). */
function coverage(timestamps: readonly string[], now: Date): number {
  const end = now.getTime();
  const windowMs = WINDOW_DAYS * 86_400_000;
  const times = timestamps.map(msAt).filter((t) => Number.isFinite(t));
  let withData = 0;
  const total = DEMAND_WINDOWS + 1;
  for (let k = 0; k < total; k += 1) {
    const hi = end - k * windowMs;
    const lo = hi - windowMs;
    if (times.some((t) => t >= lo && t < hi)) withData += 1;
  }
  return withData / total;
}

/** Freshness 100 at the latest event tapering to 0 at the stale limit (§17). */
function freshness(latest: string | undefined, now: Date): number {
  if (latest === undefined) return 0;
  const t = msAt(latest);
  if (!Number.isFinite(t)) return 0;
  const ageDays = (now.getTime() - t) / 86_400_000;
  return clamp(100 * (1 - ageDays / STALE_AFTER_DAYS), 0, 100);
}

function latestOf(timestamps: readonly string[]): string | undefined {
  let latest: string | undefined;
  let latestMs = -Infinity;
  for (const ts of timestamps) {
    const t = msAt(ts);
    if (Number.isFinite(t) && t > latestMs) {
      latestMs = t;
      latest = ts;
    }
  }
  return latest;
}

/** Readiness from the live buyer count: no buyers → 0 (veto); full at the target. */
export function readinessFromBuyers(activeBuyBoxes: number): number {
  if (activeBuyBoxes <= 0) return 0;
  return clamp(Math.round((100 * activeBuyBoxes) / READINESS_TARGET_BUYERS), 0, 100);
}

/** A real inbound deal, reduced to what demand derivation needs. */
export interface DemandDeal {
  readonly createdAt: string;
  readonly postcodeArea: string;
}

export interface PlatformDemandInput {
  readonly deals: readonly DemandDeal[];
  /** Seller enquiry timestamps (intake conversations) — a second family. */
  readonly enquiries: readonly string[];
  /** Total owned-page attention (blog views) — a context-only family. */
  readonly pageAttention: number;
  readonly pageAttentionLatest?: string;
  /** Active Buy Boxes available to place deals (readiness). */
  readonly activeBuyBoxes: number;
  readonly now: Date;
}

function buildCandidate(
  topicId: string,
  topicLabel: string,
  dealTimes: readonly string[],
  input: PlatformDemandInput,
  fitOverride?: number,
): TrendCandidate {
  const { enquiries, now } = input;
  const countFeed = weeklyDemand(dealTimes, now);

  const families = [
    {
      family: "first_party_events",
      quality: 90,
      coverage: coverage(dealTimes, now),
      freshness: freshness(latestOf(dealTimes), now),
    },
    {
      family: "crm_support",
      quality: 85,
      coverage: coverage(enquiries, now),
      freshness: freshness(latestOf(enquiries), now),
    },
    {
      family: "context_feed",
      quality: 60,
      coverage: input.pageAttention > 0 ? 1 : 0,
      freshness: freshness(input.pageAttentionLatest, now),
      contextOnly: true,
    },
  ];

  const readiness = readinessFromBuyers(input.activeBuyBoxes);
  const vetoes: TrendVeto[] = readiness <= 0 ? ["unavailable-inventory"] : [];

  return {
    installationId: "lode",
    platformId: "lode",
    market: "GB",
    locale: "en-GB",
    topicId,
    topicLabel,
    topicClass: "persistent",
    countFeed,
    families,
    // Evidence ids reference the live read models rather than fixture rows.
    evidenceIds: ["ev_lode_deals", "ev_lode_enquiries"],
    vetoes,
    profile: { ...LODE_PROFILE, readiness, ...(fitOverride !== undefined ? { fit: fitOverride } : {}) },
  };
}

/**
 * Assemble LODE's trend candidates from its real first-party demand: one
 * platform-wide inbound topic, plus a per-area topic for each postcode area with
 * enough deals on record to carry its own windowed signal. Pure — the backend
 * adapter supplies the store reads.
 */
export function buildPlatformCandidates(input: PlatformDemandInput): TrendCandidate[] {
  if (input.deals.length === 0) return [];

  const allTimes = input.deals.map((d) => d.createdAt);
  const candidates: TrendCandidate[] = [
    buildCandidate("lode-inbound-property-enquiries", "Inbound property enquiries (all areas)", allTimes, input),
  ];

  const byArea = new Map<string, string[]>();
  for (const d of input.deals) {
    const area = d.postcodeArea.trim();
    if (area === "") continue;
    const list = byArea.get(area) ?? [];
    list.push(d.createdAt);
    byArea.set(area, list);
  }

  for (const [area, times] of [...byArea.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (times.length < MIN_AREA_DEALS) continue;
    candidates.push(buildCandidate(`lode-area-${area.toLowerCase()}`, `Demand in ${area}`, times, input));
  }

  return candidates;
}
