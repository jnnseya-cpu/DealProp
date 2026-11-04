import { describe, expect, it } from "vitest";
import {
  reservationDecision,
  reservationStatus,
  activeHolds,
  isHolderKind,
  FLIPPER_SLOTS,
  FLIPPER_HOLD_DAYS,
  type FlipperHold,
} from "@shared/domain/reservation";

/**
 * The flipper reservation and lock. The rules, as the operator described them:
 * up to five flippers hold it for two weeks; a holder's accepted offer locks
 * the rest out; investors/buyers are a separate channel, open until the buying
 * stage. Deterministic, so the whole lifecycle is pinned here.
 */

const NOW = "2026-06-15T12:00:00.000Z";
const daysAgo = (n: number): string => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
const holds = (n: number, at: string = NOW): FlipperHold[] => Array.from({ length: n }, () => ({ at }));

const base = { holds: [] as FlipperHold[], offerAccepted: false, buyingStageReached: false, now: NOW };

describe("a flipper taking a property", () => {
  it("is open while fewer than five flippers hold it", () => {
    const d = reservationDecision({ ...base, kind: "flipper", holds: holds(4) });
    expect(d.allowed).toBe(true);
    expect(d.state).toBe("open");
    expect(d.slotsRemaining).toBe(1);
  });

  it("is full at five active holds, and refuses a sixth flipper", () => {
    const d = reservationDecision({ ...base, kind: "flipper", holds: holds(FLIPPER_SLOTS) });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe("flippers-full");
    expect(d.slotsRemaining).toBe(0);
  });

  it("reopens as holds pass their two-week window", () => {
    // Five holds, but three are older than the window: only two are active.
    const mixed = [...holds(2, NOW), ...holds(3, daysAgo(FLIPPER_HOLD_DAYS + 1))];
    expect(activeHolds(mixed, NOW)).toBe(2);
    const d = reservationDecision({ ...base, kind: "flipper", holds: mixed });
    expect(d.allowed).toBe(true);
    expect(d.slotsRemaining).toBe(3);
  });

  it("counts a hold exactly at the two-week boundary as expired", () => {
    expect(activeHolds(holds(1, daysAgo(FLIPPER_HOLD_DAYS)), NOW)).toBe(0);
    expect(activeHolds(holds(1, daysAgo(FLIPPER_HOLD_DAYS - 1)), NOW)).toBe(1);
  });

  it("locks out every other flipper once a holder has an accepted offer", () => {
    const d = reservationDecision({ ...base, kind: "flipper", holds: holds(2), offerAccepted: true });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe("locked-to-flippers");
    expect(d.reason).toMatch(/accepted offer/i);
  });

  it("treats an unparseable hold timestamp as active, never freeing a slot on bad data", () => {
    const d = reservationDecision({ ...base, kind: "flipper", holds: holds(FLIPPER_SLOTS, "not-a-date") });
    expect(d.state).toBe("flippers-full");
  });
});

describe("a sourcer holds a property like a flipper", () => {
  it("takes a slot and is refused when the pool of five is full", () => {
    const open = reservationDecision({ ...base, kind: "sourcer", holds: holds(4) });
    expect(open.allowed).toBe(true);
    expect(open.slotsRemaining).toBe(1);

    const full = reservationDecision({ ...base, kind: "sourcer", holds: holds(FLIPPER_SLOTS) });
    expect(full.allowed).toBe(false);
    expect(full.state).toBe("flippers-full");
  });

  it("is locked out, like a flipper, once a holder has an accepted offer", () => {
    const d = reservationDecision({ ...base, kind: "sourcer", holds: holds(2), offerAccepted: true });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe("locked-to-flippers");
  });

  it("shares the one five-slot pool with flippers", () => {
    // isHolderKind is what the backend filters the holds on: both kinds count.
    expect(isHolderKind("flipper")).toBe(true);
    expect(isHolderKind("sourcer")).toBe(true);
    expect(isHolderKind("investor")).toBe(false);
  });
});

describe("an investor or buyer taking a property", () => {
  it("is never blocked by flipper holds, even when full", () => {
    const d = reservationDecision({ ...base, kind: "investor", holds: holds(FLIPPER_SLOTS) });
    expect(d.allowed).toBe(true);
    expect(d.state).toBe("open");
  });

  it("stays open to buyers after a flipper's accepted offer", () => {
    const d = reservationDecision({ ...base, kind: "investor", holds: holds(3), offerAccepted: true });
    expect(d.allowed).toBe(true);
  });

  it("closes to buyers once the buying stage is reached", () => {
    const d = reservationDecision({ ...base, kind: "investor", buyingStageReached: true });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe("closed-buying-stage");
    expect(d.reason).toMatch(/buying stage|conveyancer/i);
  });
});

describe("the display status, independent of a buyer", () => {
  it("reports slots taken while open", () => {
    const s = reservationStatus({ ...base, holds: holds(2) });
    expect(s.state).toBe("open");
    expect(s.activeHolds).toBe(2);
    expect(s.slotsRemaining).toBe(3);
  });

  it("reports locked-to-flippers over a full count", () => {
    const s = reservationStatus({ ...base, holds: holds(FLIPPER_SLOTS), offerAccepted: true });
    expect(s.state).toBe("locked-to-flippers");
  });

  it("reports closed in the buying stage", () => {
    const s = reservationStatus({ ...base, buyingStageReached: true });
    expect(s.state).toBe("closed-buying-stage");
  });
});
