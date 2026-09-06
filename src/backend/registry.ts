import { fetchCertificates } from "@backend/sources/epc";
import { registryPressure, type RegistryPressureResult, type RegistrySignal } from "@shared/domain/registrySignal";
import { report } from "@backend/report";
import type { DealRecord } from "@backend/store/schema";

/**
 * Building a registry signal for a deal, from the sources we are licensed for.
 *
 * `registrySignal.ts` existed, was tested, and was called by nothing. It is
 * the licensed-sources answer to GoldMine — which reads days on market, price
 * reductions and agent changes, every one of which can only come from a portal
 * and no portal permits taking. That is why GoldMine was never wired, and it
 * is why this deserves wiring rather than deleting.
 *
 * What it can build today is the EPC half: a rating, when it was lodged, and
 * the floor area. That is enough for two of the five factors — a certificate
 * lodged with no sale following means a sale was prepared and did not happen,
 * and a rating below the letting standard is a decision with a statutory
 * deadline behind it.
 *
 * The Price Paid and corporate-ownership halves need their own connectors.
 * `registryPressure()` already handles absent facts by scoring them at nothing
 * and saying which are missing, so a partial signal is honest rather than
 * misleading — the same rule the funding readiness score follows.
 */

/**
 * How long a lookup is reused.
 *
 * The Deal Room renders this, and without a cache every view of every deal
 * would be an outbound request to the EPC register — slow for the operator,
 * rude to the publisher, and metered against a key that is issued against
 * accepted terms. A certificate is lodged once per assessment and then does
 * not change, so six hours is conservative rather than aggressive.
 *
 * Per-process, like the rate limiter, and for the same reason: this is a cache
 * and not a store, so losing it on a deploy costs one request per deal.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface Cached {
  readonly at: number;
  readonly lookup: RegistryLookup;
}

const cache = new Map<string, Cached>();

export interface RegistryLookup {
  readonly signal?: RegistrySignal;
  readonly pressure?: RegistryPressureResult;
  /** Why there is nothing, where there is nothing. */
  readonly reason?: string;
}

export async function registryFor(
  record: DealRecord,
  now: number = Date.now(),
): Promise<RegistryLookup> {
  const property = record.property;
  const postcode = property.postcodeArea.trim();
  if (postcode === "") {
    return { reason: "No postcode recorded, so nothing can be looked up." };
  }

  const cached = cache.get(property.id);
  if (cached !== undefined && now - cached.at < CACHE_TTL_MS) return cached.lookup;

  let certificate;
  try {
    const certificates = await fetchCertificates(postcode);
    // The most recent lodgement. An older one describes a state of the
    // building that a later assessment has already superseded.
    certificate = [...certificates]
      .sort((a, b) => b.lodgedAt.localeCompare(a.lodgedAt))
      .find((c) => c.postcode.replace(/\s+/g, "").toUpperCase().startsWith(postcode.toUpperCase()));
  } catch (error) {
    // A source being unavailable is not a signal of anything. Reported so it
    // is visible, and returned as "nothing known" rather than as a low score.
    report({
      severity: "warning",
      area: "registry",
      message: `EPC lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      subject: record.id,
    });
    const failure: RegistryLookup = {
      reason: "The EPC register could not be read, so nothing is known rather than nothing found.",
    };
    // Cached too. A source that is down must not be retried on every render —
    // that turns one outage into a queue of requests waiting on it.
    cache.set(property.id, { at: now, lookup: failure });
    return failure;
  }

  if (certificate === undefined) {
    const absent: RegistryLookup = {
      reason: "No certificate found for this postcode. That is an absence, not a finding.",
    };
    cache.set(property.id, { at: now, lookup: absent });
    return absent;
  }

  const signal: RegistrySignal = {
    propertyId: property.id,
    jurisdiction: property.jurisdiction,
    sources: [certificate.source],
    ...(certificate.rating !== undefined ? { epcRating: certificate.rating } : {}),
    epcLodgedAt: certificate.lodgedAt,
    ...(certificate.floorAreaSqm !== undefined ? { floorAreaSqm: certificate.floorAreaSqm } : {}),
    estimatedValue: property.openMarketValue,
  };

  const lookup: RegistryLookup = { signal, pressure: registryPressure(signal) };
  cache.set(property.id, { at: now, lookup });
  return lookup;
}

/** Empty the cache. Tests only. */
export function clearRegistryCache(): void {
  cache.clear();
}
