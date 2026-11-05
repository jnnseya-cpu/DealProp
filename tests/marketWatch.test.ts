import { describe, expect, it } from "vitest";
import { bps, fromMajor, toMajor } from "@shared/money";
import {
  deriveEvents,
  matchReturnedAndReduced,
  type ListingObservationRecord,
  type ReturnedAndReducedCriteria,
} from "@shared/domain/marketWatch";

/**
 * The §3 returned-and-reduced matcher, against the Deal Hunt acceptance cases.
 * The arithmetic is integer pence and basis points; rounding is display-only.
 */

const RUN_AT = new Date("2026-06-15T12:00:00.000Z");
const daysBefore = (n: number): string => new Date(RUN_AT.getTime() - n * 86_400_000).toISOString();

function obs(over: Partial<ListingObservationRecord> & Pick<ListingObservationRecord, "id" | "observedAt" | "status">): ListingObservationRecord {
  return {
    propertyId: "p1",
    listingId: "l1",
    priceQualifier: "asking",
    source: "fixture",
    ...over,
  };
}

const RETURN_MODE: ReturnedAndReducedCriteria = { returnedWithinDays: 30, minimumDropBps: 500, requireConfirmedFallThrough: false };

describe("DH03 — returned and reduced", () => {
  it("matches the 5% threshold and reports £15,000 and ~7.0%", () => {
    const history = [
      obs({ id: "o1", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }),
      obs({ id: "o2", observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
      obs({ id: "o3", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(199_950) }),
    ];
    const result = matchReturnedAndReduced(history, RETURN_MODE, RUN_AT);
    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(toMajor(result.dropPence)).toBe(15_000);
    expect(result.dropBps).toBe(bps(698)); // 15000/214950 → 6.98%, displays 7.0%
    expect(result.baselineObservationId).toBe("o1");
    expect(result.currentObservationId).toBe("o3");
    expect(result.returnReason).toBe("returned_to_market_reason_unverified");
  });
});

describe("DH04 — a cut before going under offer does not count", () => {
  it("excludes a listing whose current price is not below the pre-under-offer baseline", () => {
    const history = [
      obs({ id: "o1", observedAt: daysBefore(150), status: "available", pricePence: fromMajor(220_000) }),
      obs({ id: "o2", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }), // cut BEFORE under offer
      obs({ id: "o3", observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
      obs({ id: "o4", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(214_950) }), // unchanged after
    ];
    expect(matchReturnedAndReduced(history, RETURN_MODE, RUN_AT).eligible).toBe(false);
  });
});

describe("DH06 — reason classification", () => {
  const history = [
    obs({ id: "o1", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }),
    obs({ id: "o2", observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
    obs({ id: "o3", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(199_950) }),
  ];

  it("is eligible in return mode with the reason unverified", () => {
    const r = matchReturnedAndReduced(history, RETURN_MODE, RUN_AT);
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.returnReason).toBe("returned_to_market_reason_unverified");
  });

  it("is excluded when the query requires a confirmed fall-through", () => {
    const strict: ReturnedAndReducedCriteria = { ...RETURN_MODE, requireConfirmedFallThrough: true };
    expect(matchReturnedAndReduced(history, strict, RUN_AT).eligible).toBe(false);

    // …unless the source confirms it.
    const confirmed = history.map((o) => (o.id === "o3" ? { ...o, confirmedFallThrough: true } : o));
    const r = matchReturnedAndReduced(confirmed, strict, RUN_AT);
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.returnReason).toBe("confirmed_fall_through");
  });
});

describe("DH07 — a later disqualifier", () => {
  it("excludes a listing that has gone under offer again", () => {
    const history = [
      obs({ id: "o1", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }),
      obs({ id: "o2", observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
      obs({ id: "o3", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(199_950) }),
      obs({ id: "o4", observedAt: daysBefore(2), status: "under-offer", pricePence: fromMajor(199_950) }),
    ];
    const r = matchReturnedAndReduced(history, RETURN_MODE, RUN_AT);
    expect(r.eligible).toBe(false);
  });
});

describe("DH08 — a guide price is not a baseline", () => {
  it("is insufficient when the pre-under-offer price is a guide price", () => {
    const history = [
      obs({ id: "o1", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950), priceQualifier: "guide" }),
      obs({ id: "o2", observedAt: daysBefore(40), status: "under-offer" }),
      obs({ id: "o3", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(199_950) }),
    ];
    const r = matchReturnedAndReduced(history, RETURN_MODE, RUN_AT);
    expect(r.eligible).toBe(false);
    if (!r.eligible) expect(r.reason).toMatch(/baseline/i);
  });
});

describe("the return window", () => {
  it("excludes a return older than the window", () => {
    const history = [
      obs({ id: "o1", observedAt: daysBefore(200), status: "available", pricePence: fromMajor(214_950) }),
      obs({ id: "o2", observedAt: daysBefore(120), status: "under-offer" }),
      obs({ id: "o3", observedAt: daysBefore(60), status: "available", pricePence: fromMajor(199_950) }),
    ];
    expect(matchReturnedAndReduced(history, RETURN_MODE, RUN_AT).eligible).toBe(false); // returned 60d ago, window 30
  });
});

describe("deriveEvents", () => {
  it("names the price cut and the return to market", () => {
    const events = deriveEvents([
      obs({ id: "o1", observedAt: daysBefore(120), status: "available", pricePence: fromMajor(214_950) }),
      obs({ id: "o2", observedAt: daysBefore(40), status: "under-offer", pricePence: fromMajor(214_950) }),
      obs({ id: "o3", observedAt: daysBefore(8), status: "available", pricePence: fromMajor(199_950) }),
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain("went-under-offer");
    expect(types).toContain("returned-to-market");
    expect(types).toContain("price-reduced");
  });
});
