/**
 * Saved watches (Deal Hunt spec §7 "Watch this search"; Independent Engine §5
 * WatchCursor; IND13).
 *
 * A watch re-runs a confirmed query, or tracks one property, and alerts the
 * owner only on NEW qualifying episodes or materially changed matches — never on
 * a duplicate observation replayed by the feed. Deduplication is by
 * watch + property + episode, so the same episode arriving twice produces one
 * history event and one alert (IND13). A watch can be paused or removed, and
 * notifies nothing while paused.
 *
 * Pure: the worker supplies the current qualifying episodes; this decides which
 * are genuinely new, emits the events, and advances the cursor. It never calls a
 * feed or a notifier itself.
 */

export type WatchScope = "search" | "property";
export type WatchEventKind = "new-qualifying" | "materially-changed";

export interface WatchDelivery {
  readonly inApp: boolean;
  readonly email: boolean;
}

export interface WatchCursor {
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  /** The confirmed query revision this watch re-runs (for a search scope). */
  readonly queryId: string;
  readonly queryRevision: number;
  readonly scope: WatchScope;
  /** The property id when the scope is a single property. */
  readonly scopeRef?: string;
  /** The high-water mark of the last episode seen. */
  readonly watermark: string;
  readonly delivery: WatchDelivery;
  /** watch+property+episode keys already alerted on — the dedupe set (IND13). */
  readonly dedupeKeys: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WatchEvent {
  readonly watchId: string;
  readonly propertyId: string;
  readonly episodeKey: string;
  readonly kind: WatchEventKind;
  readonly at: string;
}

/** A qualifying match the worker found this cycle. */
export interface WatchCandidate {
  readonly propertyId: string;
  readonly episodeKey: string;
  /** The episode's effective time (used to advance the watermark). */
  readonly at: string;
  /**
   * A token that changes when the match materially changes WITHIN the same
   * episode (e.g. a further reduction). A new token emits one more alert; the
   * same token never does.
   */
  readonly changeToken?: string;
}

export function dedupeKeyFor(watchId: string, propertyId: string, episodeKey: string, changeToken?: string): string {
  return [watchId, propertyId, episodeKey, changeToken ?? "-"].join("|");
}

export function createWatch(input: {
  id: string;
  tenantId: string;
  ownerId: string;
  queryId: string;
  queryRevision: number;
  scope: WatchScope;
  scopeRef?: string;
  delivery?: WatchDelivery;
  now: string;
}): WatchCursor {
  return {
    id: input.id,
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    queryId: input.queryId,
    queryRevision: input.queryRevision,
    scope: input.scope,
    ...(input.scopeRef !== undefined ? { scopeRef: input.scopeRef } : {}),
    watermark: input.now,
    delivery: input.delivery ?? { inApp: true, email: false },
    dedupeKeys: [],
    enabled: true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function pauseWatch(watch: WatchCursor, now: string): WatchCursor {
  return { ...watch, enabled: false, updatedAt: now };
}

export function resumeWatch(watch: WatchCursor, now: string): WatchCursor {
  return { ...watch, enabled: true, updatedAt: now };
}

export interface IssueOutcome {
  readonly events: readonly WatchEvent[];
  readonly watch: WatchCursor;
}

/**
 * Decide which of the current qualifying candidates are genuinely new for this
 * watch, emit one event each, and advance the cursor. A paused watch emits
 * nothing. A duplicate episode (already in the dedupe set) is silent — one
 * alert per watch/property/episode (IND13).
 */
export function issueWatchEvents(watch: WatchCursor, candidates: readonly WatchCandidate[], now: string): IssueOutcome {
  if (!watch.enabled) return { events: [], watch };

  const seen = new Set(watch.dedupeKeys);
  const events: WatchEvent[] = [];
  const newKeys: string[] = [];
  let maxAt = watch.watermark;

  for (const c of candidates) {
    const key = dedupeKeyFor(watch.id, c.propertyId, c.episodeKey, c.changeToken);
    if (seen.has(key)) continue;
    seen.add(key);
    newKeys.push(key);
    // A change token on a previously-seen episode is a material change alert;
    // a first sighting of the episode is a new-qualifying alert.
    const episodeSeenBefore = watch.dedupeKeys.some((k) => k.startsWith(`${watch.id}|${c.propertyId}|${c.episodeKey}|`));
    events.push({
      watchId: watch.id,
      propertyId: c.propertyId,
      episodeKey: c.episodeKey,
      kind: c.changeToken !== undefined && episodeSeenBefore ? "materially-changed" : "new-qualifying",
      at: c.at,
    });
    if (c.at > maxAt) maxAt = c.at;
  }

  if (newKeys.length === 0) return { events: [], watch };

  return {
    events,
    watch: {
      ...watch,
      dedupeKeys: [...watch.dedupeKeys, ...newKeys],
      watermark: maxAt,
      updatedAt: now,
    },
  };
}
