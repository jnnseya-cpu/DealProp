import { Fetcher, type FetchOutcome } from "@backend/discovery/fetcher";

/**
 * Turn a UK postcode into a point, via postcodes.io (free, keyless, OS/ONS open
 * data). Used only to look a user's site up on the planning map — through the
 * one sanctioned outbound path (`Fetcher`, decision #39), licence-gated and
 * host-bound like every other source. Not live-verified from the build sandbox.
 */

const BASE = "https://api.postcodes.io/postcodes/";

export interface GeocodeResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome | "not-found" | "unreadable";
  readonly longitude?: number;
  readonly latitude?: number;
  readonly reason: string;
}

export async function geocodePostcode(fetcher: Fetcher, postcode: string): Promise<GeocodeResult> {
  const cleaned = postcode.replace(/\s+/g, "").toUpperCase();
  if (cleaned === "") return { ok: false, outcome: "not-found", reason: "no postcode given" };

  const result = await fetcher.get("postcodes-io", `${BASE}${encodeURIComponent(cleaned)}`);
  if (!result.ok || result.body === undefined) {
    return { ok: false, outcome: result.outcome, reason: result.reason };
  }

  try {
    const parsed = JSON.parse(result.body) as { result?: { longitude?: unknown; latitude?: unknown } };
    const r = parsed.result;
    if (r !== undefined && r !== null && typeof r.longitude === "number" && typeof r.latitude === "number") {
      return { ok: true, outcome: "ok", longitude: r.longitude, latitude: r.latitude, reason: "geocoded" };
    }
    return { ok: false, outcome: "not-found", reason: "postcode not found" };
  } catch {
    return { ok: false, outcome: "unreadable", reason: "geocoder response was not readable" };
  }
}
