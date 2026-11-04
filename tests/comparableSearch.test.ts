import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import { attribute } from "@shared/domain/sources";
import type { PricePaidRecord } from "@backend/sources/landRegistry";
import {
  appraiseFromComparables,
  comparablesFrom,
  haversineMiles,
  normaliseTenure,
  normaliseType,
  type CentroidResolver,
  type LatLng,
} from "@backend/sources/comparableSearch";

const NOW = new Date("2026-06-01T00:00:00Z");

const CENTROIDS: Record<string, LatLng> = {
  "B23 1AA": { lat: 52.52, lng: -1.84 }, // subject
  "B23 2BB": { lat: 52.524, lng: -1.84 }, // ~0.28 mi north
  "B23 3CC": { lat: 52.523, lng: -1.841 },
  "B23 4DD": { lat: 52.522, lng: -1.839 },
  "LS1 1AA": { lat: 53.8, lng: -1.549 }, // Leeds — far
};
const centroidOf: CentroidResolver = (p) => CENTROIDS[p.toUpperCase().trim()];

let seq = 0;
function ppd(over: Partial<PricePaidRecord> = {}): PricePaidRecord {
  seq += 1;
  return {
    transactionId: `t${seq}`,
    price: fromMajor(250_000),
    date: "2026-01-15",
    postcode: "B23 2BB",
    propertyType: "T",
    tenure: "F",
    address: `${seq} Example Street`,
    locality: "Erdington",
    armsLength: true,
    source: attribute("land-registry-ppd", "2026-01-15"),
    ...over,
  };
}

describe("haversineMiles", () => {
  it("is zero for a point to itself and small for a nearby postcode", () => {
    const a = CENTROIDS["B23 1AA"] as LatLng;
    expect(haversineMiles(a, a)).toBe(0);
    const near = haversineMiles(a, CENTROIDS["B23 2BB"] as LatLng);
    expect(near).toBeGreaterThan(0.2);
    expect(near).toBeLessThan(0.35);
    expect(haversineMiles(a, CENTROIDS["LS1 1AA"] as LatLng)).toBeGreaterThan(80);
  });
});

describe("normalisation", () => {
  it("maps Price Paid type codes and labels", () => {
    expect(normaliseType("D")).toBe("detached");
    expect(normaliseType("S")).toBe("semi-detached");
    expect(normaliseType("T")).toBe("terraced");
    expect(normaliseType("F")).toBe("flat");
    expect(normaliseType("O")).toBe("other");
    expect(normaliseType("Flat")).toBe("flat");
    expect(normaliseType("Terraced")).toBe("terraced");
    expect(normaliseType("Semi-detached")).toBe("semi-detached");
  });

  it("maps tenure", () => {
    expect(normaliseTenure("F")).toBe("freehold");
    expect(normaliseTenure("L")).toBe("leasehold");
    expect(normaliseTenure("")).toBe("unknown");
  });
});

describe("comparablesFrom", () => {
  it("drops a sale whose postcode has no known centroid", () => {
    const out = comparablesFrom(
      "B23 1AA",
      [ppd({ postcode: "B23 2BB" }), ppd({ postcode: "ZZ99 9ZZ" })],
      centroidOf,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.postcode).toBe("B23 2BB");
    expect(out[0]?.distanceMiles).toBeGreaterThan(0);
  });

  it("returns nothing when the subject postcode itself is unknown", () => {
    expect(comparablesFrom("ZZ99 9ZZ", [ppd()], centroidOf)).toHaveLength(0);
  });

  it("excludes the subject's own prior sale by address", () => {
    const out = comparablesFrom(
      "B23 1AA",
      [ppd({ address: "7 Subject Road" }), ppd({ address: "9 Other Road" })],
      centroidOf,
      { excludeAddress: "7 Subject Road" },
    );
    expect(out.map((c) => c.address)).toEqual(["9 Other Road"]);
  });
});

describe("appraiseFromComparables", () => {
  it("produces an as-is range from nearby recent terraced sales", () => {
    const sel = appraiseFromComparables(
      { acceptableTypes: ["terraced"], tenure: "freehold" },
      "B23 1AA",
      [
        ppd({ postcode: "B23 2BB", price: fromMajor(240_000) }),
        ppd({ postcode: "B23 3CC", price: fromMajor(250_000) }),
        ppd({ postcode: "B23 4DD", price: fromMajor(260_000) }),
      ],
      centroidOf,
      { now: NOW },
    );
    expect(sel.used).toHaveLength(3);
    expect(sel.requiresReview).toBe(false);
    expect(sel.asIs).toBeDefined();
    expect(toMajor(sel.asIs!.mid)).toBe(250_000);
  });

  it("is low confidence when the only sales are a flat and a far house", () => {
    const sel = appraiseFromComparables(
      { acceptableTypes: ["terraced"], tenure: "freehold" },
      "B23 1AA",
      [
        ppd({ postcode: "B23 2BB", propertyType: "F" }), // wrong type
        ppd({ postcode: "LS1 1AA" }), // far
      ],
      centroidOf,
      { now: NOW },
    );
    expect(sel.confidence).toBe("low");
    expect(sel.requiresReview).toBe(true);
  });
});
