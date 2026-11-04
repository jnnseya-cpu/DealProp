/**
 * Flipper reservation and lock on a property.
 *
 * A flipper "takes" a property by paying to reveal it (the reveal is the take).
 * Up to five flippers may hold it at once; while five hold it, no sixth flipper
 * may take it. A hold lasts two weeks: if none of the holders advances in that
 * window the oldest holds lapse and slots free up again, so the property "goes
 * back" to the other flippers rather than being locked forever on a stalled run.
 *
 * The moment one holder advances the deal to an accepted offer, the property is
 * locked to every other holder — the others are out — and stays locked for the
 * rest of the process. Investors and ordinary buyers are a separate channel and
 * are never affected by any of this; the property stays open to them right up
 * until it enters the buying stage (a conveyancer is instructed), after which it
 * closes to them too.
 *
 * Two kinds of buyer hold a property: a flipper (a buyer on a refurbishment
 * mandate, buying to refurbish and sell) and a sourcer (a deal sourcer/reseller
 * packaging it on to their own buyer for a fee). Both are working the deal, so
 * both take a slot and are caught by the lock; they share the one pool of five.
 * Which a buyer is is decided by their mandate/compliance elsewhere; this module
 * is told the kind and the stage signals and decides the lock. Pure and
 * deterministic: no clock of its own, no store, every input passed in, so the
 * whole lifecycle is unit-tested.
 */

/** How a buyer is acting on this property, for the reservation rules. */
export type RevealerKind = "flipper" | "sourcer" | "investor";

/**
 * Whether this kind holds a property — a flipper or a sourcer, both of whom are
 * working the deal and share the five-slot pool. An ordinary investor/buyer does
 * not hold it and is never locked out.
 */
export function isHolderKind(kind: RevealerKind): boolean {
  return kind === "flipper" || kind === "sourcer";
}

/** The most flippers that may hold one property at once. */
export const FLIPPER_SLOTS = 5;

/** How long one flipper's hold lasts before its slot frees up. Two weeks. */
export const FLIPPER_HOLD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One flipper's hold on the property: when they took it (revealed). */
export interface FlipperHold {
  /** ISO-8601 timestamp of the reveal that created the hold. */
  readonly at: string;
}

export type ReservationState =
  /** A flipper or a buyer may take it now. */
  | "open"
  /** Five flippers hold it; no further flipper until a slot frees or expires. */
  | "flippers-full"
  /** A holder reached an accepted offer; closed to every other flipper. */
  | "locked-to-flippers"
  /** In the buying stage (conveyancer instructed); closed to buyers too. */
  | "closed-buying-stage";

export interface ReservationInputs {
  readonly kind: RevealerKind;
  /** Existing holds on this property — flipper and sourcer reveals, not refunded. */
  readonly holds: readonly FlipperHold[];
  /** True once a holder reached an accepted offer (deal funded/completed). */
  readonly offerAccepted: boolean;
  /** True once the property entered the buying stage (conveyancer instructed). */
  readonly buyingStageReached: boolean;
  /** ISO-8601 now, so hold expiry is computed against a passed-in clock. */
  readonly now: string;
}

export interface ReservationDecision {
  /** Whether this buyer may take (reveal) the property now. */
  readonly allowed: boolean;
  readonly state: ReservationState;
  /** Why, in a sentence — shown to the operator/buyer when blocked. */
  readonly reason: string;
  /** What changes the answer, where anything can. */
  readonly remedy: string;
  /** Flipper holds still within their two-week window. */
  readonly activeHolds: number;
  /** Flipper slots still free (0 when full, locked or closed). */
  readonly slotsRemaining: number;
}

/** True where a hold has passed its two-week window and its slot has freed up. */
function expired(hold: FlipperHold, now: number): boolean {
  const at = Date.parse(hold.at);
  // An unparseable timestamp is treated as active rather than silently dropped:
  // freeing a slot on bad data would let a sixth flipper in by accident.
  if (Number.isNaN(at)) return false;
  return now - at >= FLIPPER_HOLD_DAYS * DAY_MS;
}

/** Flipper holds still inside their two-week window. */
export function activeHolds(holds: readonly FlipperHold[], now: string): number {
  const t = Date.parse(now);
  const ref = Number.isNaN(t) ? Date.now() : t;
  return holds.filter((h) => !expired(h, ref)).length;
}

/**
 * Decide whether this buyer may take the property now, and why.
 *
 * The order is deliberate: the hard, stage-driven locks are checked before the
 * soft five-slot cap, because an accepted offer closes the door regardless of
 * how many slots are free, and the buying stage closes it to buyers regardless
 * of the flipper holds.
 */
export function reservationDecision(inputs: ReservationInputs): ReservationDecision {
  const active = activeHolds(inputs.holds, inputs.now);

  if (isHolderKind(inputs.kind)) {
    if (inputs.offerAccepted) {
      return {
        allowed: false,
        state: "locked-to-flippers",
        reason: "A flipper or sourcer has advanced this to an accepted offer, so it is locked to every other flipper and sourcer until the purchase completes or falls through.",
        remedy: "Nothing — the property is committed to the flipper or sourcer who secured it. It stays open to investors and buyers until a conveyancer is instructed.",
        activeHolds: active,
        slotsRemaining: 0,
      };
    }
    if (active >= FLIPPER_SLOTS) {
      return {
        allowed: false,
        state: "flippers-full",
        reason: `Five flippers and sourcers are already working this property. It is held to them for two weeks.`,
        remedy: "A slot frees up when a holder's two-week window lapses with no accepted offer, and the property reopens then. It is open to investors and buyers throughout.",
        activeHolds: active,
        slotsRemaining: 0,
      };
    }
    return {
      allowed: true,
      state: "open",
      reason: `${active} of ${FLIPPER_SLOTS} flipper/sourcer slots are taken.`,
      remedy: "",
      activeHolds: active,
      slotsRemaining: FLIPPER_SLOTS - active,
    };
  }

  // An investor or ordinary buyer. Never affected by the flipper holds; open
  // until the property is genuinely being bought.
  if (inputs.buyingStageReached) {
    return {
      allowed: false,
      state: "closed-buying-stage",
      reason: "This property has entered the buying stage — a conveyancer is instructed — so it is no longer open.",
      remedy: "Nothing — it is being purchased. It was open to investors and buyers right up to this point.",
      activeHolds: active,
      slotsRemaining: 0,
    };
  }
  return {
    allowed: true,
    state: "open",
    reason: "Open to investors and buyers.",
    remedy: "",
    activeHolds: active,
    slotsRemaining: Math.max(0, FLIPPER_SLOTS - active),
  };
}

/**
 * The property's reservation state for display, independent of any one buyer.
 *
 * Drives the marketplace/opportunity badge: how many flipper slots are taken,
 * whether it is locked to a flipper, or closed in the buying stage.
 */
export function reservationStatus(
  inputs: Omit<ReservationInputs, "kind">,
): Pick<ReservationDecision, "state" | "activeHolds" | "slotsRemaining"> {
  if (inputs.buyingStageReached) {
    return { state: "closed-buying-stage", activeHolds: activeHolds(inputs.holds, inputs.now), slotsRemaining: 0 };
  }
  if (inputs.offerAccepted) {
    return { state: "locked-to-flippers", activeHolds: activeHolds(inputs.holds, inputs.now), slotsRemaining: 0 };
  }
  const active = activeHolds(inputs.holds, inputs.now);
  return {
    state: active >= FLIPPER_SLOTS ? "flippers-full" : "open",
    activeHolds: active,
    slotsRemaining: Math.max(0, FLIPPER_SLOTS - active),
  };
}
