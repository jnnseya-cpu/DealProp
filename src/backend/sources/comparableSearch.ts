import type { PricePaidRecord } from "@backend/sources/landRegistry";
import {
  selectComparables,
  type Comparable,
  type ComparableSelection,
  type ComparableSubject,
  type ComparableTenure,
  type ComparableType,
} from "@shared/domain/comparables";

/**
 * Turn HM Land Registry Price Paid sales into comparable evidence.
 *
 * The §7 evidence engine (`comparables.ts`) is pure and needs each candidate's
 * distance from the subject already computed. Price Paid Data has no
 * coordinates, so distance comes from a postcode centroid — the ONS Postcode
 * Directory maps every postcode to a latitude and longitude under the Open
 * Government Licence. That dataset is a free download, not an API key, so the
 * resolver is injected here: the mapping and the distance maths are tested now,
 * and the live ONSPD lookup is wired in where the import runs.
 *
 * This only maps and measures. It records nothing it cannot read: a sale with a
 * postcode the resolver does not know has no distance and is dropped rather than
 * guessed at, because a comparable at an unknown distance is not a comparable.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Resolve a postcode to its centroid, or undefined if unknown. */
export type CentroidResolver = (postcode: string) => LatLng | undefined;

const EARTH_RADIUS_MILES = 3_958.8;

/** Great-circle distance in miles between two points. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Normalise a Price Paid property type to the engine's categories.
 *
 * The bulk CSV uses single letters (D/S/T/F/O); the Linked Data API uses words
 * ("detached", "flat", …). Both are handled so an import that switches feeds
 * does not silently mis-categorise every sale.
 */
export function normaliseType(raw: string): ComparableType {
  const v = raw.trim().toLowerCase();
  if (v === "d" || v.includes("detached") || v.includes("bungalow")) {
    return v.startsWith("s") || v.includes("semi") ? "semi-detached" : "detached";
  }
  if (v === "s" || v.includes("semi")) return "semi-detached";
  if (v === "t" || v.includes("terrace")) return "terraced";
  if (v === "f" || v.includes("flat") || v.includes("maisonette") || v.includes("apartment")) {
    return "flat";
  }
  return "other";
}

/** Normalise a Price Paid tenure to the engine's tenure. */
export function normaliseTenure(raw: string): ComparableTenure {
  const v = raw.trim().toLowerCase();
  if (v === "f" || v.includes("freehold")) return "freehold";
  if (v === "l" || v.includes("leasehold")) return "leasehold";
  return "unknown";
}

/**
 * Map Price Paid records to comparables, measured from the subject postcode.
 *
 * A record whose postcode the centroid resolver does not know is dropped (an
 * unknown distance is not a distance). So is the subject's own prior sale if it
 * appears, matched by postcode and address.
 */
export function comparablesFrom(
  subjectPostcode: string,
  records: readonly PricePaidRecord[],
  centroidOf: CentroidResolver,
  opts: { readonly excludeAddress?: string } = {},
): readonly Comparable[] {
  const subjectCentroid = centroidOf(subjectPostcode);
  if (subjectCentroid === undefined) return [];
  const excluded = opts.excludeAddress?.trim().toLowerCase();

  const out: Comparable[] = [];
  for (const r of records) {
    if (r.postcode === "") continue;
    if (excluded !== undefined && r.address.trim().toLowerCase() === excluded) continue;
    const centroid = centroidOf(r.postcode);
    if (centroid === undefined) continue;
    out.push({
      id: r.transactionId !== "" ? r.transactionId : `${r.address}|${r.date}`,
      address: r.address,
      postcode: r.postcode,
      soldPrice: r.price,
      soldDate: r.date,
      type: normaliseType(r.propertyType),
      tenure: normaliseTenure(r.tenure),
      distanceMiles: haversineMiles(subjectCentroid, centroid),
      armsLength: r.armsLength,
      source: r.source,
    });
  }
  return out;
}

/**
 * The whole step: Price Paid records in, an as-is valuation range out, with the
 * selection reasons and confidence the §7 engine produces.
 */
export function appraiseFromComparables(
  subject: ComparableSubject,
  subjectPostcode: string,
  records: readonly PricePaidRecord[],
  centroidOf: CentroidResolver,
  opts: { readonly now?: Date; readonly excludeAddress?: string } = {},
): ComparableSelection {
  const candidates = comparablesFrom(subjectPostcode, records, centroidOf, {
    ...(opts.excludeAddress !== undefined ? { excludeAddress: opts.excludeAddress } : {}),
  });
  return selectComparables(subject, candidates, opts.now !== undefined ? { now: opts.now } : {});
}
