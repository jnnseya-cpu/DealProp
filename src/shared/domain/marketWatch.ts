import { type Money, ratioBps, sub, type Bps } from "@shared/money";

/**
 * The listing price/status history, and the deterministic event and
 * eligibility derivation over it (spec §19 Market Watch, §3 of the Deal Hunt
 * spec). This is the pure core both features sit on: Market Watch's change
 * events and the Deal Hunt "returned to market and reduced" matcher are the
 * same arithmetic over the same observations.
 *
 * It is distinct from `listingData.ts`, which is a *signal snapshot* port
 * (present/absent per property, for the motivated-seller taxonomy). This is the
 * *time series* — a sequence of observations carrying price and status — from
 * which price moves and status transitions are derived. Deliberately separate:
 * a snapshot and a history answer different questions.
 *
 * Rules this exists to keep, from §3:
 *  - A baseline is the last *ordinary asking* price before going under offer.
 *    POA, guide and "offers over" are not ordinary asking prices and cannot be
 *    a baseline (DH08).
 *  - A cut only counts if it happened *after* the under-offer baseline and the
 *    current asking price is *still* below it. A cut before going under offer,
 *    or a later rise above the threshold, does not qualify (DH04/DH07).
 *  - "Confirmed fall-through" needs explicit source evidence; otherwise the
 *    return is "reason unverified", and a strict query excludes the latter
 *    (DH06). Feed disappearance never qualifies by itself.
 *  - Arithmetic is integer pence and basis points; rounding is for display only.
 */

export const MARKET_WATCH_VERSION = "market-watch-1";

export type ListingStatus = "available" | "under-offer" | "sold-stc" | "sold" | "withdrawn";

/** Only an ordinary asking price can be a baseline or a current price. */
export type PriceQualifier = "asking" | "guide" | "offers-over" | "poa";

/** One observation of one property's listing at one time, from one source. */
export interface ListingObservationRecord {
  readonly id: string;
  readonly propertyId: string;
  readonly listingId: string;
  /** When the provider observed it (effective time), not when we read it. */
  readonly observedAt: string;
  readonly status: ListingStatus;
  /** Absent for POA. Integer pence. */
  readonly pricePence?: Money;
  readonly priceQualifier: PriceQualifier;
  readonly source: string;
  /**
   * Set only where the source explicitly confirms the prior sale failed and
   * ties it to this episode. Without it a return to market is "reason
   * unverified" — never inferred from the transition alone.
   */
  readonly confirmedFallThrough?: boolean;
}

export type ListingEventType =
  | "price-reduced"
  | "price-increased"
  | "went-under-offer"
  | "returned-to-market"
  | "sold"
  | "withdrawn";

export interface ListingEvent {
  readonly type: ListingEventType;
  readonly at: string;
  readonly beforeObservationId: string;
  readonly afterObservationId: string;
}

function ordered(observations: readonly ListingObservationRecord[]): readonly ListingObservationRecord[] {
  return [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

const OFF_MARKET: readonly ListingStatus[] = ["under-offer", "sold-stc"];

/**
 * Derive the change events from an ordered observation sequence. Deterministic:
 * a price change between consecutive observations, and each status transition.
 * Text interpretation is not here — these are counts, dates and deltas.
 */
export function deriveEvents(observations: readonly ListingObservationRecord[]): readonly ListingEvent[] {
  const seq = ordered(observations);
  const events: ListingEvent[] = [];
  for (let i = 1; i < seq.length; i += 1) {
    const prev = seq[i - 1]!;
    const curr = seq[i]!;
    const edge = { at: curr.observedAt, beforeObservationId: prev.id, afterObservationId: curr.id };

    if (prev.pricePence !== undefined && curr.pricePence !== undefined && prev.priceQualifier === "asking" && curr.priceQualifier === "asking") {
      if (curr.pricePence < prev.pricePence) events.push({ type: "price-reduced", ...edge });
      else if (curr.pricePence > prev.pricePence) events.push({ type: "price-increased", ...edge });
    }

    if (prev.status !== curr.status) {
      if (curr.status === "under-offer" || curr.status === "sold-stc") events.push({ type: "went-under-offer", ...edge });
      else if (curr.status === "available" && OFF_MARKET.includes(prev.status)) events.push({ type: "returned-to-market", ...edge });
      else if (curr.status === "sold") events.push({ type: "sold", ...edge });
      else if (curr.status === "withdrawn") events.push({ type: "withdrawn", ...edge });
    }
  }
  return events;
}

/** The return-and-reduced criteria a Deal Hunt matches against (§3, subset). */
export interface ReturnedAndReducedCriteria {
  readonly returnedWithinDays: number;
  readonly minimumDropBps: number;
  /** When true, only an explicitly confirmed fall-through qualifies (DH06). */
  readonly requireConfirmedFallThrough: boolean;
}

export type ReturnReason = "confirmed_fall_through" | "returned_to_market_reason_unverified";

export interface ReturnedAndReducedMatch {
  readonly eligible: true;
  readonly propertyId: string;
  readonly returnReason: ReturnReason;
  readonly returnedAt: string;
  readonly returnEventObservationId: string;
  readonly baselineObservationId: string;
  readonly baselinePence: Money;
  readonly currentObservationId: string;
  readonly currentPence: Money;
  readonly dropPence: Money;
  readonly dropBps: Bps;
  readonly matchReasons: readonly string[];
}

export interface NotMatched {
  readonly eligible: false;
  readonly reason: string;
}

export type ReturnedAndReducedResult = ReturnedAndReducedMatch | NotMatched;

/**
 * The §3 matcher: did this property return to market (from under offer / sold
 * STC) within the window, and is it still cheaper than the last ordinary asking
 * price before it went under offer? Deterministic; the model never touches it.
 */
export function matchReturnedAndReduced(
  observations: readonly ListingObservationRecord[],
  criteria: ReturnedAndReducedCriteria,
  runAt: Date,
): ReturnedAndReducedResult {
  const seq = ordered(observations);
  if (seq.length < 2) return { eligible: false, reason: "Not enough listing history to judge a return." };

  const current = seq[seq.length - 1]!;
  // The listing must still be available at the watermark; a later under-offer,
  // sold or withdrawn disqualifies it (§3.1 / DH07).
  if (current.status !== "available") {
    return { eligible: false, reason: `The listing is "${current.status}", not available, at the run watermark.` };
  }
  if (current.priceQualifier !== "asking" || current.pricePence === undefined) {
    return { eligible: false, reason: "The current price is not an ordinary asking price (guide, offers-over or POA)." };
  }

  // The most recent return to market: an off-market → available transition.
  let returnIdx = -1;
  for (let i = seq.length - 1; i >= 1; i -= 1) {
    if (seq[i]!.status === "available" && OFF_MARKET.includes(seq[i - 1]!.status)) {
      returnIdx = i;
      break;
    }
  }
  if (returnIdx === -1) return { eligible: false, reason: "No return to market from under offer or sold STC." };

  const returnObs = seq[returnIdx]!;
  const returnedAt = Date.parse(returnObs.observedAt);
  const windowMs = criteria.returnedWithinDays * 24 * 60 * 60 * 1000;
  if (Number.isNaN(returnedAt) || runAt.getTime() - returnedAt > windowMs) {
    return { eligible: false, reason: `The return to market is older than ${criteria.returnedWithinDays} days.` };
  }

  // The reason: confirmed fall-through only where the source says so (DH06).
  const returnReason: ReturnReason = returnObs.confirmedFallThrough === true
    ? "confirmed_fall_through"
    : "returned_to_market_reason_unverified";
  if (criteria.requireConfirmedFallThrough && returnReason !== "confirmed_fall_through") {
    return { eligible: false, reason: "The return to market is not a confirmed fall-through, which this query requires." };
  }

  // Baseline: the last ordinary asking price strictly before going under offer
  // (the off-market observation that preceded this return).
  const underOfferIdx = returnIdx - 1;
  let baseline: ListingObservationRecord | undefined;
  for (let i = underOfferIdx; i >= 0; i -= 1) {
    const obs = seq[i]!;
    if (OFF_MARKET.includes(obs.status)) continue; // skip the off-market run itself
    if (obs.priceQualifier === "asking" && obs.pricePence !== undefined) {
      baseline = obs;
      break;
    }
    // An observation before the under-offer with no ordinary asking price
    // (POA/guide) cannot seed a baseline; keep looking further back.
  }
  if (baseline === undefined || baseline.pricePence === undefined) {
    return { eligible: false, reason: "No ordinary asking price before the under-offer transition to use as a baseline (POA, guide, or missing)." };
  }

  const baselinePence = baseline.pricePence;
  const currentPence = current.pricePence;
  // A cut must leave the current asking price below the baseline (DH04/DH07).
  if (currentPence >= baselinePence) {
    return { eligible: false, reason: "The current asking price is not below the last ordinary asking price before it went under offer." };
  }

  const dropPence = sub(baselinePence, currentPence);
  const dropBps = ratioBps(dropPence, baselinePence);
  if (criteria.minimumDropBps > 0 && dropBps < criteria.minimumDropBps) {
    return { eligible: false, reason: `The drop is below the ${criteria.minimumDropBps} bps threshold.` };
  }

  return {
    eligible: true,
    propertyId: current.propertyId,
    returnReason,
    returnedAt: returnObs.observedAt,
    returnEventObservationId: returnObs.id,
    baselineObservationId: baseline.id,
    baselinePence,
    currentObservationId: current.id,
    currentPence,
    dropPence,
    dropBps,
    matchReasons: [
      `Returned to market ${returnReason === "confirmed_fall_through" ? "after a confirmed fall-through" : "(reason unverified)"} on ${returnObs.observedAt.slice(0, 10)}.`,
      `Asking price down from the pre-under-offer baseline.`,
    ],
  };
}
