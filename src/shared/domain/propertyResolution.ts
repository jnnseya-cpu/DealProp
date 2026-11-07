import type { ListingObservationRecord } from "@shared/domain/marketWatch";

/**
 * Market Watch property identity (spec §19.4): keep Property, Listing and
 * MarketingEpisode distinct, and never let two different homes — or two
 * concurrent listings of one home — merge into one history by accident.
 *
 * The spec is emphatic about the failure mode this prevents: a provider
 * identifier names a *listing*, not a home and not an owner. Flat 1 and Flat 2
 * at one postcode are different properties; a relist by a new agent is the same
 * property's history, not a reset; and a merge or split a reviewer makes must be
 * reversible with its history rebuilt. Resolving on postcode, a similar price or
 * coordinates alone is exactly the mistake that fabricates a shared history.
 *
 * Pure and decidable. It takes identity inputs and observations and returns a
 * resolution, a reversible merge/split record, the reconciliation a merge
 * implies, grouped episodes, and the link between an inbound seller case and a
 * watched listing. The store persists the records; a reviewer confirms the
 * candidates and the cross-gap episode links. Nothing here performs I/O or
 * decides a figure.
 */

export const PROPERTY_RESOLUTION_VERSION = "property-resolution-1";

/** Enough of a listing to resolve it to a property. */
export interface ListingIdentity {
  readonly listingId: string;
  readonly source: string;
  /** Unique Property Reference Number, including the unit for a flat. */
  readonly uprn?: string;
  /** Full normalised address including flat/unit and postcode, uppercased. */
  readonly addressKey: string;
  /** A flat needs a unit before it may auto-resolve (§19.4). */
  readonly isFlat?: boolean;
  /** Flat/unit designator, where there is one. */
  readonly unit?: string;
}

/** A resolved property the incoming listing might belong to. */
export interface PropertyRecord {
  readonly propertyId: string;
  readonly uprn?: string;
  readonly addressKey: string;
  readonly isFlat?: boolean;
  readonly unit?: string;
}

export type ResolutionMethod = "uprn" | "exact-address";

export type Resolution =
  | { readonly status: "matched"; readonly propertyId: string; readonly method: ResolutionMethod; readonly reason: string }
  | { readonly status: "candidate"; readonly candidates: readonly string[]; readonly reason: string }
  | { readonly status: "pending"; readonly reason: string };

function norm(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Resolve a listing to a property, or to candidates needing review, or to a
 * pending (new) property. Resolution order per §19.4:
 *
 *  1. Verified UPRN including the unit — the only automatic match for a flat.
 *  2. Exact normalised complete address including flat/unit and postcode.
 *  3. Otherwise a candidate (fuzzy / multiple) for review, or pending.
 *
 * Conflicting UPRN-vs-address evidence always goes to review. A flat with no
 * unit never auto-resolves. Postcode, price and coordinates are never used.
 */
export function resolveListing(
  listing: ListingIdentity,
  properties: readonly PropertyRecord[],
): Resolution {
  // 1. UPRN (incl. unit). An exact UPRN match wins, UNLESS the addresses
  //    plainly disagree — a provider mislabelling a UPRN is a review, not a
  //    silent merge.
  if (listing.uprn !== undefined && listing.uprn !== "") {
    const byUprn = properties.filter((p) => p.uprn === listing.uprn);
    if (byUprn.length === 1) {
      const p = byUprn[0]!;
      if (norm(p.addressKey) !== norm(listing.addressKey) && p.addressKey !== "" && listing.addressKey !== "") {
        return {
          status: "candidate",
          candidates: [p.propertyId],
          reason: "UPRN matches a property whose recorded address differs — review before merging.",
        };
      }
      return { status: "matched", propertyId: p.propertyId, method: "uprn", reason: "Verified UPRN match." };
    }
    if (byUprn.length > 1) {
      return { status: "candidate", candidates: byUprn.map((p) => p.propertyId), reason: "More than one property carries this UPRN." };
    }
  }

  // A flat must carry a unit before it may resolve on address alone.
  if (listing.isFlat === true && (listing.unit === undefined || listing.unit === "")) {
    return { status: "pending", reason: "A flat cannot auto-resolve without its unit number." };
  }

  // 2. Exact normalised complete address.
  const byAddress = properties.filter((p) => norm(p.addressKey) === norm(listing.addressKey) && listing.addressKey !== "");
  if (byAddress.length === 1) {
    return { status: "matched", propertyId: byAddress[0]!.propertyId, method: "exact-address", reason: "Exact address match." };
  }
  if (byAddress.length > 1) {
    return { status: "candidate", candidates: byAddress.map((p) => p.propertyId), reason: "Several properties share this exact address — review." };
  }

  // 3. Nothing matched: a new, pending property.
  return { status: "pending", reason: "No existing property matched; create a pending property." };
}

/* ----------------------------------------------------------- merge / split */

export interface MergeRecord {
  readonly id: string;
  readonly survivingPropertyId: string;
  readonly mergedPropertyId: string;
  readonly at: string;
  readonly by: string;
  readonly reason: string;
  /** Present once the merge has been reversed (a split). History is rebuilt. */
  readonly reversed?: { readonly at: string; readonly by: string; readonly reason: string };
}

/** Record a reviewer merging one property into another. */
export function mergeProperties(input: {
  readonly id: string;
  readonly survivingPropertyId: string;
  readonly mergedPropertyId: string;
  readonly by: string;
  readonly reason: string;
  readonly at: string;
}): MergeRecord {
  if (input.survivingPropertyId === input.mergedPropertyId) {
    throw new Error("A property cannot be merged into itself.");
  }
  return {
    id: input.id,
    survivingPropertyId: input.survivingPropertyId,
    mergedPropertyId: input.mergedPropertyId,
    at: input.at,
    by: input.by,
    reason: input.reason,
  };
}

/**
 * Reverse a merge (a split). The audit is preserved — the record is marked
 * reversed rather than deleted — and the caller rebuilds each property's
 * history from its own observations.
 */
export function reverseMerge(record: MergeRecord, by: string, reason: string, at: string): MergeRecord {
  if (record.reversed !== undefined) throw new Error("This merge has already been reversed.");
  return { ...record, reversed: { at, by, reason } };
}

export interface MergeReconciliation {
  /** Property IDs whose signals must be recomputed after the change. */
  readonly signalsToReEvaluate: readonly string[];
  /** Open task keys made duplicate by the change, to cancel. */
  readonly tasksToCancel: readonly string[];
}

/**
 * What a merge or its reversal implies. A merge re-evaluates the surviving
 * property's signals and cancels tasks that duplicate across the two; a reversal
 * (split) re-evaluates *both* properties because each history is rebuilt.
 *
 * `taskKeyOf` names a task by what makes it a duplicate — the spec's uniqueness
 * key is property + action type + episode, so two tasks with the same action on
 * the two sides of a merge are the same task once merged.
 */
export function reconcileMerge(
  record: MergeRecord,
  openTasks: readonly { readonly key: string; readonly propertyId: string; readonly actionType: string }[],
): MergeReconciliation {
  const reversed = record.reversed !== undefined;
  if (reversed) {
    return {
      signalsToReEvaluate: [record.survivingPropertyId, record.mergedPropertyId],
      tasksToCancel: [],
    };
  }
  // On a merge, a task on the merged property duplicates one on the survivor if
  // they share an action type. Cancel the merged-side duplicates.
  const survivorActions = new Set(
    openTasks.filter((t) => t.propertyId === record.survivingPropertyId).map((t) => t.actionType),
  );
  const tasksToCancel = openTasks
    .filter((t) => t.propertyId === record.mergedPropertyId && survivorActions.has(t.actionType))
    .map((t) => t.key);
  return { signalsToReEvaluate: [record.survivingPropertyId], tasksToCancel };
}

/* ---------------------------------------------------------------- episodes */

export interface EpisodeLink {
  readonly fromEpisodeId: string;
  readonly toEpisodeId: string;
  readonly confirmedBy: string;
  readonly at: string;
}

export interface Episode {
  readonly episodeId: string;
  readonly propertyId: string;
  readonly listingIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly startedAt: string;
  readonly lastSeenAt: string;
}

/**
 * Group a property's observations into marketing episodes.
 *
 * A base episode is one listing's observations. Episodes are linked across a
 * marketing gap ONLY where a reviewer has confirmed it (§19.4) — a relist or an
 * agent change never merges histories automatically, and the original observed
 * history is always preserved. Concurrent listings are not summed; they remain
 * distinct listings within whatever episodes the reviewer confirms.
 */
export function groupEpisodes(
  observations: readonly ListingObservationRecord[],
  confirmedLinks: readonly EpisodeLink[] = [],
): readonly Episode[] {
  // Base episode id is the listing id; union episodes joined by a confirmed link.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const o of observations) parent.set(o.listingId, parent.get(o.listingId) ?? o.listingId);
  for (const link of confirmedLinks) {
    if (parent.has(link.fromEpisodeId) && parent.has(link.toEpisodeId)) union(link.fromEpisodeId, link.toEpisodeId);
  }

  const groups = new Map<string, ListingObservationRecord[]>();
  for (const o of observations) {
    const key = find(o.listingId);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }

  return [...groups.entries()]
    .map(([episodeId, obs]): Episode => {
      const times = obs.map((o) => o.observedAt).sort();
      return {
        episodeId,
        propertyId: obs[0]!.propertyId,
        listingIds: [...new Set(obs.map((o) => o.listingId))].sort(),
        observationIds: obs.map((o) => o.id).sort(),
        startedAt: times[0]!,
        lastSeenAt: times[times.length - 1]!,
      };
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/* ------------------------------------------------- inbound ↔ listing link */

export interface CaseListingLink {
  readonly propertyId: string;
  readonly sellerCaseId: string;
  readonly listingIds: readonly string[];
  /** Both touchpoints are preserved; the two channels must not double-contact. */
  readonly suppressDuplicateContact: true;
  readonly reason: string;
}

/**
 * Link an inbound seller case and a watched listing on the same property
 * (MW13). Both acquisition touchpoints are preserved and surfaced to the case
 * owner; the link exists to stop a duplicate approach, never to manufacture
 * seller consent or a second contact.
 */
export function linkInboundAndListing(
  propertyId: string,
  sellerCaseId: string,
  listingIds: readonly string[],
): CaseListingLink {
  return {
    propertyId,
    sellerCaseId,
    listingIds: [...new Set(listingIds)].sort(),
    suppressDuplicateContact: true,
    reason: "An inbound seller case and a watched listing resolve to one property — keep both, contact once.",
  };
}
