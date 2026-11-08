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

/* ------------------------------------------------------- §19.5 signals */

/**
 * Listing-history signals derivable from observations alone. Each is a
 * deterministic count, date or delta — never an inference about a person. The
 * `needs-portal-feed` signals in `sourcingSignals.ts` are *these*: the data is
 * gated at the source (a licensed feed, or the Deal Hunt fixtures in dev), the
 * arithmetic is here. Text interpretation (cash-only, short lease) is NOT here;
 * that is a separate hypothesis step.
 */
export type ListingSignalCode =
  | "repeated-reductions"
  | "long-marketing"
  | "prolonged-stc"
  | "returned-to-market"
  | "withdrawn-recently"
  | "below-previous-sale";

export interface ListingSignal {
  readonly code: ListingSignalCode;
  /** When the signal became true — the latest supporting observation. */
  readonly at: string;
  readonly detail: string;
  readonly supportingObservationIds: readonly string[];
  /** A count or delta where the signal has one (reductions; days; pence). */
  readonly magnitude?: number;
  /**
   * False until a source or reviewer confirms a cause (a fall-through reason).
   * A transition alone is observed, never a confirmed reason (§19.5).
   */
  readonly verified: boolean;
}

export interface ListingSignalContext {
  readonly now: Date;
  /** Over this many days from the earliest observation is "long on the market". */
  readonly longMarketingDays?: number;
  /** Under offer / sold STC for this long is "prolonged". */
  readonly prolongedStcDays?: number;
  /** A linked registered sale price, where known, for below-previous-sale. */
  readonly previousSalePricePence?: Money;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive the listing-history signals. Deterministic and additive: each rule
 * that fires adds one signal with its supporting observation IDs. Nothing here
 * scores a person or infers hardship; a signal is a fact about a listing's
 * recorded history, for a reviewer to act on under the usual safeguards.
 */
export function deriveListingSignals(
  observations: readonly ListingObservationRecord[],
  ctx: ListingSignalContext,
): readonly ListingSignal[] {
  const seq = ordered(observations);
  if (seq.length === 0) return [];
  const now = ctx.now.getTime();
  const longDays = ctx.longMarketingDays ?? 90;
  const stcDays = ctx.prolongedStcDays ?? 90;
  const out: ListingSignal[] = [];
  const current = seq[seq.length - 1]!;

  // Repeated reductions: two or more distinct asking-price decreases.
  const reductions = deriveEvents(seq).filter((e) => e.type === "price-reduced");
  if (reductions.length >= 2) {
    out.push({
      code: "repeated-reductions",
      at: reductions[reductions.length - 1]!.at,
      detail: `${reductions.length} asking-price reductions recorded.`,
      supportingObservationIds: reductions.map((r) => r.afterObservationId),
      magnitude: reductions.length,
      verified: true,
    });
  }

  // Long on the market: available now, and first observed over the threshold ago.
  if (current.status === "available") {
    const firstAt = Date.parse(seq[0]!.observedAt);
    if (!Number.isNaN(firstAt)) {
      const days = Math.floor((now - firstAt) / DAY_MS);
      if (days > longDays) {
        out.push({
          code: "long-marketing",
          at: current.observedAt,
          detail: `On the market for about ${days} days since first observed (earlier history may be unknown).`,
          supportingObservationIds: [seq[0]!.id, current.id],
          magnitude: days,
          verified: true,
        });
      }
    }
  }

  // Prolonged under offer / sold STC: currently off-market, in that state past
  // the threshold since it entered it.
  if (OFF_MARKET.includes(current.status)) {
    let sinceIdx = seq.length - 1;
    while (sinceIdx > 0 && OFF_MARKET.includes(seq[sinceIdx - 1]!.status)) sinceIdx -= 1;
    const sinceAt = Date.parse(seq[sinceIdx]!.observedAt);
    if (!Number.isNaN(sinceAt)) {
      const days = Math.floor((now - sinceAt) / DAY_MS);
      if (days > stcDays) {
        out.push({
          code: "prolonged-stc",
          at: current.observedAt,
          detail: `Under offer or sold STC for about ${days} days — ask about progress; a feed with no exchange date does not mean none exists.`,
          supportingObservationIds: [seq[sinceIdx]!.id, current.id],
          magnitude: days,
          verified: true,
        });
      }
    }
  }

  // Returned to market: the most recent off-market → available transition.
  for (let i = seq.length - 1; i >= 1; i -= 1) {
    if (seq[i]!.status === "available" && OFF_MARKET.includes(seq[i - 1]!.status)) {
      out.push({
        code: "returned-to-market",
        at: seq[i]!.observedAt,
        detail:
          seq[i]!.confirmedFallThrough === true
            ? "Returned to market after a confirmed fall-through."
            : "Returned to market (reason unverified).",
        supportingObservationIds: [seq[i - 1]!.id, seq[i]!.id],
        verified: seq[i]!.confirmedFallThrough === true,
      });
      break;
    }
  }

  // Withdrawn recently: current status is withdrawn.
  if (current.status === "withdrawn") {
    out.push({
      code: "withdrawn-recently",
      at: current.observedAt,
      detail: "The listing was withdrawn — availability unverified, not a sale.",
      supportingObservationIds: [current.id],
      verified: true,
    });
  }

  // Below a linked previous sale: current ordinary asking price under it.
  if (
    ctx.previousSalePricePence !== undefined &&
    current.priceQualifier === "asking" &&
    current.pricePence !== undefined &&
    current.pricePence < ctx.previousSalePricePence
  ) {
    const gap = sub(ctx.previousSalePricePence, current.pricePence);
    out.push({
      code: "below-previous-sale",
      at: current.observedAt,
      detail: "Current asking price is below a linked registered sale — verify the property and ownership context; never imply the owner's loss.",
      supportingObservationIds: [current.id],
      magnitude: gap,
      verified: true,
    });
  }

  return out;
}
