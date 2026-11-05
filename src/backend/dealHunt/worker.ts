import { randomUUID } from "node:crypto";
import type { Bps, Money } from "@shared/money";
import { gbp } from "@shared/format";
import {
  matchReturnedAndReduced,
  type ListingObservationRecord,
  type ReturnedAndReducedCriteria,
} from "@shared/domain/marketWatch";
import type { DealHuntCriteria } from "@shared/domain/dealHunt";
import { withinPriceCeiling } from "@shared/domain/dealHunt";
import {
  advanceRun,
  queueRun,
  rankResults,
  type DealHuntQuery,
  type DealHuntResult,
  type DealHuntRun,
  type EnrichmentStatus,
  type ReturnReasonClass,
} from "@shared/domain/dealHuntRun";
import {
  buildComparableBundle,
  type ComparableBundle,
} from "@shared/domain/comparableBundle";
import type { Comparable, ComparableSubject } from "@shared/domain/comparables";
import type { RentalComparable, RentalSubject } from "@shared/domain/comparableBundle";
import type { StoredComparableBundle } from "@backend/store/schema";
import {
  saveComparableBundle,
  saveDealHuntResult,
  saveDealHuntRun,
} from "@backend/store/repository";

/**
 * The deterministic Deal Hunt worker (Deal Hunt spec §5).
 *
 * The model never reaches this. The worker freezes a source watermark, runs the
 * §3 matcher over each resolved property's observation history, applies the
 * remaining filters (price ceiling, type, bedrooms), deduplicates by property
 * keeping provenance (DH09), ranks and caps (§3.6), then enriches the capped set
 * with comparable bundles and persists immutable result snapshots. A clean
 * install with commercial adapters disabled returns an explicit zero-match
 * coverage boundary, never a synthetic opportunity (IND01/IND02/DH16).
 *
 * Data comes through an injected {@link DealHuntSources} so the core runs with
 * no live feed (the default is "nothing licensed, nothing to search") and a
 * fixture adapter can drive it in development and tests.
 */

/** One resolved property's marketing history, from a licensed source. */
export interface PropertyHistory {
  readonly propertyId: string;
  readonly listingId: string;
  readonly propertyType?: string;
  readonly bedrooms?: number;
  /** Source keys the property appeared on — merged into provenance (DH09). */
  readonly sources: readonly string[];
  /** Unresolved cross-agent identity: excluded pending review (DH05). */
  readonly ambiguousIdentity?: boolean;
  readonly observations: readonly ListingObservationRecord[];
}

export interface DealHuntSources {
  /** False where no licensed listing feed is enabled for the geography. */
  listingsAvailable(geographyId: string): boolean;
  /** Resolved property histories up to the watermark. Throws on a feed outage. */
  histories(geographyId: string, watermark: string): Promise<readonly PropertyHistory[]>;
  /** Sold candidates, or null when no licensed sold source exists. */
  soldComparables(propertyId: string): Promise<readonly Comparable[] | null>;
  /** Rental candidates, or null when no licensed rental feed exists. */
  rentalComparables(propertyId: string): Promise<readonly RentalComparable[] | null>;
  /** The comparable subject descriptors for a property. */
  subjectFor(propertyId: string): { sold: ComparableSubject; rent: RentalSubject };
}

/** The "nothing licensed" default — a clean core with adapters disabled. */
export const EMPTY_SOURCES: DealHuntSources = {
  listingsAvailable: () => false,
  histories: async () => [],
  soldComparables: async () => null,
  rentalComparables: async () => null,
  subjectFor: () => ({ sold: { acceptableTypes: [], tenure: "unknown" }, rent: { acceptableTypes: [] } }),
};

/** A match before it becomes a stored result (no id/run/enrichment yet). */
export interface MatchDraft {
  readonly propertyId: string;
  readonly listingId: string;
  readonly episodeKey: string;
  readonly baselineObservationId: string;
  readonly currentObservationId: string;
  readonly returnEventObservationId: string;
  readonly reason: ReturnReasonClass;
  readonly baselinePence: Money;
  readonly currentPence: Money;
  readonly dropPence: Money;
  readonly dropBps: Bps;
  readonly resultWatermark: string;
  readonly matchReasons: readonly string[];
  readonly provenance: readonly string[];
}

export interface HuntEvaluation {
  /** Ranked and capped to the result limit. */
  readonly matches: readonly MatchDraft[];
  /** How many eligible before the cap, so "capped" and counts are honest. */
  readonly eligibleCount: number;
  readonly excludedCount: number;
  readonly capped: boolean;
  readonly coverage: string;
}

function toReturnCriteria(c: DealHuntCriteria): ReturnedAndReducedCriteria {
  return {
    returnedWithinDays: c.returnedWithinDays,
    minimumDropBps: c.minimumDropBps,
    requireConfirmedFallThrough: c.eventRequirement === "confirmed_fall_through",
  };
}

/** An explicit filter rejects a listing whose attribute is missing or incompatible (§2). */
function passesAttributeFilters(c: DealHuntCriteria, h: PropertyHistory): boolean {
  if (c.propertyTypes.length > 0) {
    if (h.propertyType === undefined) return false;
    if (!c.propertyTypes.includes(h.propertyType)) return false;
  }
  if (c.bedroomsMin !== undefined || c.bedroomsMax !== undefined) {
    if (h.bedrooms === undefined) return false;
    if (c.bedroomsMin !== undefined && h.bedrooms < c.bedroomsMin) return false;
    if (c.bedroomsMax !== undefined && h.bedrooms > c.bedroomsMax) return false;
  }
  return true;
}

/**
 * Merge histories that resolve to the same property (one card, provenance kept),
 * so a property on two feeds is matched once over the union of its observations.
 */
function mergeByProperty(histories: readonly PropertyHistory[]): PropertyHistory[] {
  const byId = new Map<string, PropertyHistory>();
  for (const h of histories) {
    const held = byId.get(h.propertyId);
    if (held === undefined) {
      byId.set(h.propertyId, h);
      continue;
    }
    byId.set(h.propertyId, {
      ...held,
      ambiguousIdentity: held.ambiguousIdentity === true || h.ambiguousIdentity === true,
      sources: [...new Set([...held.sources, ...h.sources])],
      observations: [...held.observations, ...h.observations],
      propertyType: held.propertyType ?? h.propertyType,
      bedrooms: held.bedrooms ?? h.bedrooms,
    });
  }
  return [...byId.values()];
}

/**
 * The deterministic evaluation (pure): run the §3 matcher over each property,
 * apply the remaining filters, rank and cap. No store, no model.
 */
export function evaluateHunt(
  criteria: DealHuntCriteria,
  histories: readonly PropertyHistory[],
  runAt: Date,
): HuntEvaluation {
  const rr = toReturnCriteria(criteria);
  const merged = mergeByProperty(histories);

  const drafts: MatchDraft[] = [];
  let excluded = 0;

  for (const h of merged) {
    if (h.ambiguousIdentity === true) {
      excluded += 1; // DH05: unresolved cross-agent identity, excluded pending review
      continue;
    }
    if (!passesAttributeFilters(criteria, h)) {
      excluded += 1;
      continue;
    }
    const m = matchReturnedAndReduced(h.observations, rr, runAt);
    if (!m.eligible) {
      excluded += 1;
      continue;
    }
    if (!withinPriceCeiling(m.currentPence, criteria)) {
      excluded += 1; // over the asking ceiling
      continue;
    }
    drafts.push({
      propertyId: h.propertyId,
      listingId: h.listingId,
      episodeKey: m.returnEventObservationId,
      baselineObservationId: m.baselineObservationId,
      currentObservationId: m.currentObservationId,
      returnEventObservationId: m.returnEventObservationId,
      reason: m.returnReason as ReturnReasonClass,
      baselinePence: m.baselinePence,
      currentPence: m.currentPence,
      dropPence: m.dropPence,
      dropBps: m.dropBps,
      resultWatermark: m.returnedAt,
      matchReasons: m.matchReasons,
      provenance: h.sources,
    });
  }

  const ranked = rankResults(drafts.map((d) => ({ ...d, runId: "", id: "", stale: false, enrichment: { sold: "pending" as EnrichmentStatus, rent: "pending" as EnrichmentStatus } })));
  const eligibleCount = ranked.length;
  const capped = eligibleCount > criteria.resultLimit;
  const limited = ranked.slice(0, criteria.resultLimit).map((r): MatchDraft => ({
    propertyId: r.propertyId,
    listingId: r.listingId,
    episodeKey: r.episodeKey,
    baselineObservationId: r.baselineObservationId,
    currentObservationId: r.currentObservationId,
    returnEventObservationId: r.returnEventObservationId,
    reason: r.reason,
    baselinePence: r.baselinePence,
    currentPence: r.currentPence,
    dropPence: r.dropPence,
    dropBps: r.dropBps,
    resultWatermark: r.resultWatermark,
    matchReasons: r.matchReasons,
    provenance: r.provenance,
  }));

  const coverage =
    eligibleCount === 0
      ? `No qualifying matches in ${criteria.geographyId} ${criteria.priceOperator === "lt" ? "under" : "at or under"} ${gbp(criteria.askingPriceLimitPence)} that returned within ${criteria.returnedWithinDays} days. Searched ${merged.length} propert${merged.length === 1 ? "y" : "ies"} in the monitored set.`
      : `${eligibleCount} qualifying match${eligibleCount === 1 ? "" : "es"}${capped ? `, showing the top ${criteria.resultLimit}` : ""}, from ${merged.length} propert${merged.length === 1 ? "y" : "ies"} in the monitored set.`;

  return { matches: limited, eligibleCount, excludedCount: excluded, capped, coverage };
}

export interface RunDealHuntOptions {
  readonly now?: Date;
  readonly newId?: () => string;
  /** Emits the single in-app completion notification (DH12). */
  readonly notify?: (run: DealHuntRun) => Promise<void> | void;
}

export interface RunDealHuntOutcome {
  readonly run: DealHuntRun;
  readonly results: readonly DealHuntResult[];
}

/**
 * Execute a confirmed hunt end to end: create and advance the run, evaluate,
 * enrich the capped set and persist immutable results, then emit exactly one
 * completion notification. A listing-feed outage is a retryable failure, not an
 * empty shortlist; a comparable-enrichment outage returns a partial shortlist
 * with the gap named.
 */
export async function runDealHuntJob(
  query: DealHuntQuery,
  sources: DealHuntSources,
  opts: RunDealHuntOptions = {},
): Promise<RunDealHuntOutcome> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const newId = opts.newId ?? (() => randomUUID());
  const watermark = nowIso;

  let run = queueRun({
    id: newId(),
    queryId: query.id,
    investorId: query.investorId,
    sourceWatermark: watermark,
    runAt: nowIso,
    correlationId: newId(),
    now: nowIso,
  });
  await saveDealHuntRun(run);

  // No licensed listing feed: an explicit, honest zero with a coverage boundary.
  if (!sources.listingsAvailable(query.criteria.geographyId)) {
    run = advanceRun(run, "completed", {
      now: new Date().toISOString(),
      counts: { eligible: 0, excluded: 0, capped: false },
      coverage: `No licensed listing feed is enabled for ${query.criteria.geographyId}; there is nothing to search yet.`,
      notifiedAt: new Date().toISOString(),
    });
    await saveDealHuntRun(run);
    await opts.notify?.(run);
    return { run, results: [] };
  }

  run = advanceRun(run, "searching", { now: new Date().toISOString() });
  await saveDealHuntRun(run);

  let histories: readonly PropertyHistory[];
  try {
    histories = await sources.histories(query.criteria.geographyId, watermark);
  } catch {
    // A feed failure that prevents matching is a retryable failure, not a zero.
    run = advanceRun(run, "failed", {
      now: new Date().toISOString(),
      errorCode: "listing-feed-unavailable",
      coverage: "The listing feed could not be read; the hunt can be retried.",
    });
    await saveDealHuntRun(run);
    return { run, results: [] };
  }

  const evaluation = evaluateHunt(query.criteria, histories, now);

  run = advanceRun(run, "enriching", { now: new Date().toISOString() });
  await saveDealHuntRun(run);

  let anyEnrichmentFailed = false;
  const results: DealHuntResult[] = [];
  for (let i = 0; i < evaluation.matches.length; i += 1) {
    const d = evaluation.matches[i]!;
    const resultId = newId();
    let evidenceBundleId: string | undefined;
    let soldStatus: EnrichmentStatus = "pending";
    let rentStatus: EnrichmentStatus = "pending";

    try {
      const subject = sources.subjectFor(d.propertyId);
      const sold = await sources.soldComparables(d.propertyId);
      const rent = await sources.rentalComparables(d.propertyId);
      const bundle: ComparableBundle = buildComparableBundle(
        { subject: subject.sold, candidates: sold ?? [] },
        { subject: subject.rent, candidates: rent },
        { now },
      );
      const stored: StoredComparableBundle = {
        id: newId(),
        tenantId: query.tenantId,
        propertyId: d.propertyId,
        useType: query.criteria.propertyTypes[0] ?? "property",
        policyVersion: bundle.policyVersion,
        bundle,
        createdAt: new Date().toISOString(),
      };
      await saveComparableBundle(stored);
      evidenceBundleId = stored.id;
      soldStatus = sold === null ? "missing" : "ready";
      rentStatus = bundle.coverage.rentUnavailable ? "missing" : "ready";
    } catch {
      anyEnrichmentFailed = true;
      soldStatus = "failed";
      rentStatus = "failed";
    }

    const result: DealHuntResult = {
      id: resultId,
      runId: run.id,
      propertyId: d.propertyId,
      listingId: d.listingId,
      episodeKey: d.episodeKey,
      baselineObservationId: d.baselineObservationId,
      currentObservationId: d.currentObservationId,
      returnEventObservationId: d.returnEventObservationId,
      reason: d.reason,
      baselinePence: d.baselinePence,
      currentPence: d.currentPence,
      dropPence: d.dropPence,
      dropBps: d.dropBps,
      rank: i + 1,
      resultWatermark: d.resultWatermark,
      matchReasons: d.matchReasons,
      provenance: d.provenance,
      stale: false,
      ...(evidenceBundleId !== undefined ? { evidenceBundleId } : {}),
      enrichment: { sold: soldStatus, rent: rentStatus },
    };
    await saveDealHuntResult(result);
    results.push(result);
  }

  const finalState = anyEnrichmentFailed ? "partial" : "completed";
  const completedIso = new Date().toISOString();
  run = advanceRun(run, finalState, {
    now: completedIso,
    counts: { eligible: evaluation.eligibleCount, excluded: evaluation.excludedCount, capped: evaluation.capped },
    coverage: anyEnrichmentFailed
      ? `${evaluation.coverage} Some comparable evidence could not be fetched and can be retried.`
      : evaluation.coverage,
    notifiedAt: completedIso,
  });
  await saveDealHuntRun(run);
  await opts.notify?.(run);

  return { run, results };
}
