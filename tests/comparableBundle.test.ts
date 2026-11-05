import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import type { Comparable, ComparableSubject } from "@shared/domain/comparables";
import {
  buildComparableBundle,
  selectRentalComparables,
  toMonthlyPence,
  type RentalComparable,
  type RentalSubject,
} from "@shared/domain/comparableBundle";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const daysBefore = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const source = { sourceKey: "fixture", asOf: "2026-06-01" };

function sale(over: Partial<Comparable> & Pick<Comparable, "id" | "soldPrice" | "distanceMiles">): Comparable {
  return {
    address: `${over.id} Example Road`,
    postcode: "B23 1AA",
    soldDate: daysBefore(60),
    type: "terraced",
    tenure: "freehold",
    armsLength: true,
    source,
    ...over,
  };
}

function rent(over: Partial<RentalComparable> & Pick<RentalComparable, "id" | "amountPence" | "basis" | "distanceMiles">): RentalComparable {
  return {
    address: `${over.id} Example Road`,
    postcode: "B23 1AA",
    period: "monthly",
    type: "terraced",
    bedrooms: 2,
    observedDate: daysBefore(30),
    source,
    ...over,
  };
}

const soldSubject: ComparableSubject = { acceptableTypes: ["terraced"], tenure: "freehold" };
const rentSubject: RentalSubject = { acceptableTypes: ["terraced"], bedrooms: 2 };

describe("rent normalisation (§4)", () => {
  it("converts weekly and annual to a monthly figure", () => {
    expect(toMajor(toMonthlyPence(fromMajor(300), "weekly"))).toBe(1_300); // 300 × 52 ÷ 12
    expect(toMajor(toMonthlyPence(fromMajor(15_600), "annual"))).toBe(1_300);
    expect(toMajor(toMonthlyPence(fromMajor(1_300), "monthly"))).toBe(1_300);
  });
});

describe("rental evidence keeps advertised and agreed apart", () => {
  it("ranges each basis separately and never merges them", () => {
    const candidates: RentalComparable[] = [
      rent({ id: "a1", basis: "advertised", amountPence: fromMajor(1_400), distanceMiles: 0.1 }),
      rent({ id: "a2", basis: "advertised", amountPence: fromMajor(1_500), distanceMiles: 0.2 }),
      rent({ id: "a3", basis: "advertised", amountPence: fromMajor(1_600), distanceMiles: 0.3 }),
      rent({ id: "g1", basis: "agreed", amountPence: fromMajor(1_200), distanceMiles: 0.15 }),
      rent({ id: "g2", basis: "agreed", amountPence: fromMajor(1_250), distanceMiles: 0.25 }),
      rent({ id: "g3", basis: "agreed", amountPence: fromMajor(1_300), distanceMiles: 0.35 }),
    ];
    const ev = selectRentalComparables(rentSubject, candidates, { now: NOW });
    expect(ev.unavailable).toBe(false);
    expect(ev.advertised?.count).toBe(3);
    expect(ev.agreed?.count).toBe(3);
    expect(toMajor(ev.advertised!.range!.mid)).toBe(1_500);
    expect(toMajor(ev.agreed!.range!.mid)).toBe(1_250);
    expect(ev.advertised?.thin).toBe(false);
  });

  it("returns rent_unavailable when no licensed feed exists", () => {
    const ev = selectRentalComparables(rentSubject, null, { now: NOW });
    expect(ev.unavailable).toBe(true);
    expect(ev.advertised).toBeUndefined();
  });

  it("excludes room lets and short stays, and dedupes relisted adverts", () => {
    const candidates: RentalComparable[] = [
      rent({ id: "x1", basis: "advertised", amountPence: fromMajor(1_400), distanceMiles: 0.1, roomLet: true }),
      rent({ id: "x2", basis: "advertised", amountPence: fromMajor(1_400), distanceMiles: 0.1, shortStay: true }),
      // Same address relisted: the newer observation wins, counts once.
      rent({ id: "x3", basis: "advertised", amountPence: fromMajor(1_400), distanceMiles: 0.1, address: "Dup Road", observedDate: daysBefore(80) }),
      rent({ id: "x4", basis: "advertised", amountPence: fromMajor(1_500), distanceMiles: 0.1, address: "Dup Road", observedDate: daysBefore(10) }),
    ];
    const ev = selectRentalComparables(rentSubject, candidates, { now: NOW });
    expect(ev.advertised?.count).toBe(1);
    expect(toMajor(ev.advertised!.range!.mid)).toBe(1_500);
  });

  it("widens once to a mile and 180 days when the tight band is thin", () => {
    const candidates: RentalComparable[] = [
      rent({ id: "w1", basis: "advertised", amountPence: fromMajor(1_400), distanceMiles: 0.8, observedDate: daysBefore(150) }),
      rent({ id: "w2", basis: "advertised", amountPence: fromMajor(1_450), distanceMiles: 0.9, observedDate: daysBefore(160) }),
      rent({ id: "w3", basis: "advertised", amountPence: fromMajor(1_500), distanceMiles: 0.95, observedDate: daysBefore(170) }),
    ];
    const tightOnly = selectRentalComparables(rentSubject, candidates.slice(0, 0), { now: NOW });
    expect(tightOnly.advertised?.count).toBe(0);
    const ev = selectRentalComparables(rentSubject, candidates, { now: NOW });
    expect(ev.advertised?.widened).toBe(true);
    expect(ev.advertised?.count).toBe(3);
  });
});

describe("DH10 — two sales, four adverts, no agreed rents", () => {
  it("marks sales thin and shows rents as advertised only", () => {
    const sold: Comparable[] = [
      sale({ id: "s1", soldPrice: fromMajor(200_000), distanceMiles: 0.2 }),
      sale({ id: "s2", soldPrice: fromMajor(210_000), distanceMiles: 0.3 }),
    ];
    const rental: RentalComparable[] = [
      rent({ id: "r1", basis: "advertised", amountPence: fromMajor(1_300), distanceMiles: 0.1 }),
      rent({ id: "r2", basis: "advertised", amountPence: fromMajor(1_350), distanceMiles: 0.2 }),
      rent({ id: "r3", basis: "advertised", amountPence: fromMajor(1_400), distanceMiles: 0.3 }),
      rent({ id: "r4", basis: "advertised", amountPence: fromMajor(1_450), distanceMiles: 0.4 }),
    ];
    const bundle = buildComparableBundle(
      { subject: soldSubject, candidates: sold },
      { subject: rentSubject, candidates: rental },
      { now: NOW },
    );
    expect(bundle.coverage.soldCount).toBe(2);
    expect(bundle.coverage.soldThin).toBe(true);
    expect(bundle.coverage.advertisedRentCount).toBe(4);
    expect(bundle.coverage.agreedRentCount).toBe(0);
    expect(bundle.coverage.rentUnavailable).toBe(false);
    expect(bundle.policyVersion).toBe("comparable-policy-1");
  });
});
