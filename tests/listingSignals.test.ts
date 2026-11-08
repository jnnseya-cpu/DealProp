import { describe, expect, it } from "vitest";
import { deriveListingSignals, type ListingObservationRecord } from "@shared/domain/marketWatch";
import { fromMajor } from "@shared/money";

/**
 * The §19.5 listing-history signal detectors — deterministic arithmetic over
 * observations, the engine half of the `needs-portal-feed` signals. Data is
 * gated at the source; this is the maths, fixture-tested.
 */

const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY).toISOString();

const obs = (
  over: Partial<ListingObservationRecord> & Pick<ListingObservationRecord, "id" | "observedAt" | "status">,
): ListingObservationRecord => ({
  propertyId: "p1",
  listingId: "L1",
  priceQualifier: "asking",
  source: "feed",
  ...over,
});

const now = new Date();
const codes = (obss: readonly ListingObservationRecord[], ctx = {}) =>
  deriveListingSignals(obss, { now, ...ctx }).map((s) => s.code);

describe("deriveListingSignals", () => {
  it("flags two or more asking-price reductions", () => {
    const list = [
      obs({ id: "o1", observedAt: at(60), status: "available", pricePence: fromMajor(250_000) }),
      obs({ id: "o2", observedAt: at(40), status: "available", pricePence: fromMajor(240_000) }),
      obs({ id: "o3", observedAt: at(20), status: "available", pricePence: fromMajor(235_000) }),
    ];
    const signals = deriveListingSignals(list, { now });
    const rr = signals.find((s) => s.code === "repeated-reductions");
    expect(rr?.magnitude).toBe(2);
    expect(rr?.verified).toBe(true);
  });

  it("does not flag a single reduction as repeated", () => {
    const list = [
      obs({ id: "o1", observedAt: at(40), status: "available", pricePence: fromMajor(250_000) }),
      obs({ id: "o2", observedAt: at(20), status: "available", pricePence: fromMajor(240_000) }),
    ];
    expect(codes(list)).not.toContain("repeated-reductions");
  });

  it("flags long marketing past 90 days while still available", () => {
    const list = [
      obs({ id: "o1", observedAt: at(200), status: "available", pricePence: fromMajor(250_000) }),
      obs({ id: "o2", observedAt: at(5), status: "available", pricePence: fromMajor(250_000) }),
    ];
    expect(codes(list)).toContain("long-marketing");
    // A short history does not trip it.
    expect(codes([obs({ id: "o3", observedAt: at(10), status: "available" })])).not.toContain("long-marketing");
  });

  it("flags a prolonged under-offer past the threshold", () => {
    const list = [
      obs({ id: "o1", observedAt: at(200), status: "available" }),
      obs({ id: "o2", observedAt: at(150), status: "under-offer" }),
      obs({ id: "o3", observedAt: at(5), status: "under-offer" }),
    ];
    const s = deriveListingSignals(list, { now }).find((x) => x.code === "prolonged-stc");
    expect(s).toBeDefined();
    expect(s!.magnitude).toBeGreaterThan(90);
  });

  it("flags a return to market, unverified unless the source confirms the fall-through", () => {
    const base = [
      obs({ id: "o1", observedAt: at(60), status: "available" }),
      obs({ id: "o2", observedAt: at(40), status: "under-offer" }),
      obs({ id: "o3", observedAt: at(10), status: "available" }),
    ];
    expect(deriveListingSignals(base, { now }).find((s) => s.code === "returned-to-market")?.verified).toBe(false);
    const confirmed = [...base.slice(0, 2), obs({ id: "o3", observedAt: at(10), status: "available", confirmedFallThrough: true })];
    expect(deriveListingSignals(confirmed, { now }).find((s) => s.code === "returned-to-market")?.verified).toBe(true);
  });

  it("flags a withdrawal as availability unverified, never a sale", () => {
    const list = [obs({ id: "o1", observedAt: at(30), status: "available" }), obs({ id: "o2", observedAt: at(2), status: "withdrawn" })];
    expect(codes(list)).toContain("withdrawn-recently");
  });

  it("flags an asking price below a linked previous sale, with the gap", () => {
    const list = [obs({ id: "o1", observedAt: at(10), status: "available", pricePence: fromMajor(180_000) })];
    const s = deriveListingSignals(list, { now, previousSalePricePence: fromMajor(210_000) }).find((x) => x.code === "below-previous-sale");
    expect(s?.magnitude).toBe(fromMajor(30_000));
    // No previous sale given → no signal (never inferred).
    expect(codes(list)).not.toContain("below-previous-sale");
  });

  it("returns nothing for an empty history", () => {
    expect(deriveListingSignals([], { now })).toEqual([]);
  });
});
