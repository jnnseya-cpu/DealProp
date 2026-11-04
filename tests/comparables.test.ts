import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import { selectComparables, type Comparable, type ComparableSubject } from "@shared/domain/comparables";
import { attribute } from "@shared/domain/sources";

const NOW = new Date("2026-06-01T00:00:00Z");
const SRC = attribute("land-registry-ppd", "2026-01-01");

let seq = 0;
function comp(over: Partial<Comparable> = {}): Comparable {
  seq += 1;
  return {
    id: `c${seq}`,
    address: `${seq} Example Street`,
    postcode: "B23 1AA",
    soldPrice: fromMajor(250_000),
    soldDate: "2026-01-15",
    type: "terraced",
    tenure: "freehold",
    distanceMiles: 0.3,
    armsLength: true,
    source: SRC,
    ...over,
  };
}

const HOUSE: ComparableSubject = { acceptableTypes: ["terraced"], tenure: "freehold" };

describe("selectComparables", () => {
  it("gives an as-is range from three nearby recent sales, no review needed", () => {
    const sel = selectComparables(
      HOUSE,
      [
        comp({ soldPrice: fromMajor(240_000) }),
        comp({ soldPrice: fromMajor(250_000) }),
        comp({ soldPrice: fromMajor(260_000) }),
      ],
      { now: NOW },
    );
    expect(sel.used).toHaveLength(3);
    expect(sel.requiresReview).toBe(false);
    expect(sel.widened).toBe(false);
    expect(sel.confidence).toBe("medium");
    expect(sel.asIs).toBeDefined();
    expect(toMajor(sel.asIs!.mid)).toBe(250_000);
    expect(toMajor(sel.asIs!.low)).toBeLessThan(toMajor(sel.asIs!.mid));
    expect(toMajor(sel.asIs!.high)).toBeGreaterThan(toMajor(sel.asIs!.mid));
  });

  it("widens to a mile and two years only when the tight band is thin", () => {
    const sel = selectComparables(
      HOUSE,
      [
        comp({ distanceMiles: 0.3 }), // tight
        comp({ distanceMiles: 0.8 }), // only within the wide band
        comp({ distanceMiles: 0.9 }),
      ],
      { now: NOW },
    );
    expect(sel.widened).toBe(true);
    expect(sel.used).toHaveLength(3);
    expect(sel.confidence).toBe("medium");
  });

  it("is low confidence and demands review below three defensible comparables", () => {
    const sel = selectComparables(HOUSE, [comp(), comp()], { now: NOW });
    expect(sel.used).toHaveLength(2);
    expect(sel.confidence).toBe("low");
    expect(sel.requiresReview).toBe(true);
    expect(sel.reason).toMatch(/fewer than/i);
    expect(sel.asIs).toBeDefined(); // an indicative range is still offered
  });

  it("records a reason for every rejection", () => {
    const sel = selectComparables(
      HOUSE,
      [
        comp(), comp(), comp(),
        comp({ id: "flat", type: "flat" }),
        comp({ id: "repo", armsLength: false }),
        comp({ id: "far", distanceMiles: 2 }),
        comp({ id: "old", soldDate: "2023-01-01" }),
        comp({ id: "lease", tenure: "leasehold" }),
      ],
      { now: NOW },
    );
    const reason = (id: string) => sel.rejected.find((x) => x.comparable.id === id)?.reason ?? "";
    expect(reason("flat")).toMatch(/not comparable to the subject's type/i);
    expect(reason("repo")).toMatch(/open-market/i);
    expect(reason("far")).toMatch(/miles away, beyond/i);
    expect(reason("old")).toMatch(/months ago, beyond/i);
    expect(reason("lease")).toMatch(/tenure/i);
  });

  it("keeps only the most recent sale of the same address", () => {
    const sel = selectComparables(
      HOUSE,
      [
        comp({ id: "new", address: "1 Oak Road", soldDate: "2026-03-01" }),
        comp({ id: "old", address: "1 Oak Road", soldDate: "2025-09-01" }),
        comp(), comp(),
      ],
      { now: NOW },
    );
    expect(sel.used.some((u) => u.comparable.id === "new")).toBe(true);
    expect(sel.rejected.find((x) => x.comparable.id === "old")?.reason).toMatch(/more recent sale/i);
  });

  it("size-adjusts the price, keeping the original separate", () => {
    const sel = selectComparables(
      { acceptableTypes: ["terraced"], tenure: "freehold", floorAreaSqm: 100 },
      [comp({ id: "sized", soldPrice: fromMajor(200_000), floorAreaSqm: 50 }), comp(), comp()],
      { now: NOW },
    );
    const adjusted = sel.used.find((u) => u.comparable.id === "sized");
    expect(adjusted).toBeDefined();
    expect(toMajor(adjusted!.comparable.soldPrice)).toBe(200_000); // original untouched
    expect(toMajor(adjusted!.adjustedValue)).toBe(400_000); // 100/50 × 200k
    expect(adjusted!.adjustmentNote).toMatch(/size-adjusted/i);
  });

  it("refuses to value when the subject's own type is unknown", () => {
    const sel = selectComparables(
      { acceptableTypes: [], tenure: "freehold" },
      [comp(), comp(), comp()],
      { now: NOW },
    );
    expect(sel.confidence).toBe("low");
    expect(sel.requiresReview).toBe(true);
    expect(sel.used).toHaveLength(0);
    expect(sel.reason).toMatch(/type is unknown/i);
  });
});
