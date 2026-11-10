/**
 * Trend Intelligence — the source registry and observation model (spec §3, §5).
 *
 * Before a signal can be scored it has to be accounted for: where it came from,
 * under what terms, how fresh it is, and whether we are even allowed to read it
 * without a new credential. This module is that accounting. It is the trend
 * engine's equivalent of DealProp's own rule that no data source is read
 * without a recorded licence (decision #14) — here the licence travels on the
 * registry entry, and a source with no key-free path and no authorised host
 * integration is simply unavailable, never guessed at.
 *
 * Four rules are load-bearing and each is pinned by a conformance scenario:
 *
 *  - **Keyless or unavailable.** A `public_keyless` source needs no credential.
 *    A `host_mediated` source is available only when the host already operates
 *    the integration — the module never takes possession of the connector's
 *    secrets. If neither holds, the capability shows unavailable with a reason
 *    and the workflow continues on what is available (TI-20, TI-22).
 *  - **A replay cannot inflate a count.** An observation carries a unique
 *    source-version key. The same key with the same evidence hash is a
 *    duplicate; the same key with a *different* hash is a conflict, not an
 *    overwrite (TI-01).
 *  - **Syndication is one family.** Mirrors, syndications and amendments of one
 *    story corroborate as a single source family at most, so four copies of a
 *    story can never manufacture independent corroboration (TI-04).
 *  - **A gap is unknown, not zero.** A missing or stale feed is recorded as
 *    unknown data; it never reads as "no interest", and a stale source can give
 *    dated context but cannot support a fresh automated action.
 */

export const TREND_SOURCES_VERSION = "trend-sources-1";

/** How a source is reached without the module holding third-party secrets. */
export type AccessPath = "public_keyless" | "host_mediated" | "file_import";

/** The evidence family a source belongs to (spec §3). */
export type SourceFamily =
  | "first_party_events"
  | "crm_support"
  | "search_console"
  | "public_trends"
  | "trends_api"
  | "sector_public_data"
  | "context_feed"
  | "keyword_social";

/**
 * A registered source adapter. Every field the spec §3 requires an adapter to
 * declare before it may contribute an observation.
 */
export interface SourceRegistryEntry {
  readonly sourceId: string;
  readonly family: SourceFamily;
  readonly accessPath: AccessPath;
  readonly owner: string;
  readonly termsVersion: string;
  readonly permittedUses: readonly string[];
  readonly territories: readonly string[];
  readonly locales: readonly string[];
  /** Nominal refresh cadence in minutes. */
  readonly cadenceMinutes: number;
  /** Expected delay between an event happening and it being observable. */
  readonly ingestionLagMinutes: number;
  /** Beyond this age an observation is stale: context only, no fresh action. */
  readonly staleAfterMinutes: number;
  /** Context-only families (pageviews, bulletins) cannot corroborate (§3/§5). */
  readonly contextOnly?: boolean;
  /** 0–100 configured quality score for this family (feeds confidence, §17). */
  readonly quality: number;
}

/** The §5 observation record. Public records live read-only; tenant rows scoped. */
export interface Observation {
  readonly tenantScope: string;
  readonly sourceId: string;
  readonly sourceFamily: SourceFamily;
  readonly sourceRecordId: string;
  readonly observedAt: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly ingestedAt: string;
  readonly geography: string;
  readonly locale: string;
  readonly segment: string;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly scalingScope: string;
  readonly coverage: number;
  readonly evidenceUri: string;
  readonly evidenceHash: string;
  readonly termsVersion: string;
  /**
   * The syndication group, when a story reaches us through several mirrors.
   * Observations sharing a group collapse to one source family (TI-04).
   */
  readonly syndicationGroup?: string;
}

// --- keyless availability (§2, §3, TI-20, TI-22) ------------------------------

/** What the host already lets this installation reach without a new credential. */
export interface HostCapabilities {
  /** Capability identifiers of host integrations already authorised (§14). */
  readonly authorisedIntegrations: readonly string[];
}

export interface SourceAvailability {
  readonly sourceId: string;
  readonly available: boolean;
  readonly reason: string;
}

/**
 * Decide whether a source can be used right now without asking for a new key.
 * `public_keyless` and `file_import` are always available (no third-party
 * secret involved). `host_mediated` is available only when the host already
 * operates an integration whose capability id matches the source id — the
 * engine never prompts for, or receives, a provider credential (TI-22).
 */
export function sourceAvailability(
  entry: SourceRegistryEntry,
  host: HostCapabilities,
): SourceAvailability {
  switch (entry.accessPath) {
    case "public_keyless":
      return { sourceId: entry.sourceId, available: true, reason: "permitted key-free access" };
    case "file_import":
      return { sourceId: entry.sourceId, available: true, reason: "manual or batch import" };
    case "host_mediated": {
      const ok = host.authorisedIntegrations.includes(entry.sourceId);
      return {
        sourceId: entry.sourceId,
        available: ok,
        reason: ok
          ? "host integration already authorised"
          : "no authorised host integration — unavailable, not prompted for a new credential",
      };
    }
  }
}

/** Only the sources this installation can actually use, keylessly (§2). */
export function availableSources(
  registry: readonly SourceRegistryEntry[],
  host: HostCapabilities,
): readonly SourceRegistryEntry[] {
  return registry.filter((e) => sourceAvailability(e, host).available);
}

// --- freshness (§3, §17) ------------------------------------------------------

/**
 * A source is stale once the newest observation is older than its stale-after
 * window. A stale source can still provide dated context; it cannot support a
 * fresh automated action (spec §3).
 */
export function isStale(entry: SourceRegistryEntry, newestObservedAt: string, now: Date): boolean {
  const observed = Date.parse(newestObservedAt);
  if (!Number.isFinite(observed)) return true;
  const ageMinutes = (now.getTime() - observed) / 60000;
  return ageMinutes > entry.staleAfterMinutes;
}

// --- replay and conflict reconciliation (§5, §15, TI-01) ----------------------

/**
 * The unique source-version key. A replay of the exact same observation shares
 * this key AND its evidence hash; a changed value shares the key but not the
 * hash. Scoped by tenant so one tenant's record can never collide with
 * another's.
 */
export function sourceVersionKey(obs: Pick<Observation, "tenantScope" | "sourceId" | "sourceRecordId">): string {
  return `${obs.tenantScope}::${obs.sourceId}::${obs.sourceRecordId}`;
}

export type IngestStatus = "accepted" | "duplicate" | "conflict";

export interface IngestResult {
  readonly status: IngestStatus;
  readonly key: string;
  readonly reason: string;
}

/**
 * Reconcile one incoming observation against what is already stored for its
 * version key (TI-01):
 *  - nothing stored        → accepted
 *  - stored, same hash     → duplicate (a replay; counted once)
 *  - stored, different hash → conflict (409; never a silent overwrite)
 */
export function reconcileObservation(
  incoming: Observation,
  existingHash: string | undefined,
): IngestResult {
  const key = sourceVersionKey(incoming);
  if (existingHash === undefined) return { status: "accepted", key, reason: "new observation" };
  if (existingHash === incoming.evidenceHash) {
    return { status: "duplicate", key, reason: "exact replay of a stored version" };
  }
  return { status: "conflict", key, reason: "same source version, different evidence hash" };
}

export interface BatchCounts {
  readonly accepted: number;
  readonly duplicate: number;
  readonly conflict: number;
  readonly rejected: number;
}

export interface BatchItemResult {
  readonly index: number;
  readonly status: IngestStatus | "rejected";
  readonly key?: string;
  readonly reason: string;
}

export interface BatchReconciliation {
  readonly counts: BatchCounts;
  readonly items: readonly BatchItemResult[];
}

/**
 * Reconcile a batch (§16 POST /v1/observations:batch). `knownHashes` maps a
 * version key to the evidence hash already stored for it; `isRegistered` says
 * whether a source id is in the registry (an unregistered source is rejected,
 * §16). Duplicates within the same batch resolve as duplicates after the first.
 *
 * Pure: the caller does the atomic write. This returns the counts the endpoint
 * reports and a per-item result for indexed validation errors.
 */
export function reconcileBatch(
  incoming: readonly Observation[],
  knownHashes: ReadonlyMap<string, string>,
  isRegistered: (sourceId: string) => boolean,
): BatchReconciliation {
  const seen = new Map<string, string>(knownHashes);
  const items: BatchItemResult[] = [];
  let accepted = 0;
  let duplicate = 0;
  let conflict = 0;
  let rejected = 0;

  incoming.forEach((obs, index) => {
    if (!isRegistered(obs.sourceId)) {
      rejected += 1;
      items.push({ index, status: "rejected", reason: "unregistered source" });
      return;
    }
    const key = sourceVersionKey(obs);
    const result = reconcileObservation(obs, seen.get(key));
    if (result.status === "accepted") {
      accepted += 1;
      seen.set(key, obs.evidenceHash);
    } else if (result.status === "duplicate") {
      duplicate += 1;
    } else {
      conflict += 1;
    }
    items.push({ index, status: result.status, key, reason: result.reason });
  });

  return { counts: { accepted, duplicate, conflict, rejected }, items };
}

// --- independent corroboration (§3, TI-04) ------------------------------------

/**
 * Count the independent source families present in a set of observations, after
 * collapsing syndication. Context-only families are excluded (pageviews are
 * attention, not corroboration), and all observations sharing a syndication
 * group count as one family however many mirrors carried them (TI-04). This is
 * the family count fed to the confidence corroboration score.
 */
export function independentFamilies(
  observations: readonly Observation[],
  registry: readonly SourceRegistryEntry[],
): number {
  const contextOnly = new Set(registry.filter((e) => e.contextOnly).map((e) => e.sourceId));
  const families = new Set<string>();
  for (const obs of observations) {
    if (contextOnly.has(obs.sourceId)) continue;
    // A syndicated story collapses to one family keyed by its group.
    const key = obs.syndicationGroup ? `syndication:${obs.syndicationGroup}` : `family:${obs.sourceFamily}`;
    families.add(key);
  }
  return families.size;
}
