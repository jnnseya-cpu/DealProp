import { fromMajor } from "@shared/money";
import type { ListingObservationRecord } from "@shared/domain/marketWatch";
import { EMPTY_SOURCES, type DealHuntSources, type PropertyHistory } from "@backend/dealHunt/worker";

/**
 * The Deal Hunt source adapter.
 *
 * By default the core has NO licensed feed — `EMPTY_SOURCES` — so a clean
 * deployment returns an honest zero-match coverage boundary (IND01/IND02) and no
 * synthetic opportunity is ever presented. Only when `DEAL_HUNT_FIXTURES=1` is
 * set (a staff pilot / development, never production) does it serve a small,
 * clearly synthetic set so the matcher can be exercised against known data. The
 * fixtures are labelled as fixtures by their source key.
 *
 * A real licensed adapter replaces this factory once a feed's display rights are
 * approved; LODE's own property IDs stay stable across that swap (IND16).
 */

function daysBeforeNow(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function fixtureHistories(): PropertyHistory[] {
  const obs = (
    id: string,
    propertyId: string,
    daysAgo: number,
    status: ListingObservationRecord["status"],
    pricePence?: number,
  ): ListingObservationRecord => ({
    id,
    propertyId,
    listingId: `fx-l-${propertyId}`,
    observedAt: daysBeforeNow(daysAgo),
    status,
    priceQualifier: "asking",
    source: "fixture-pilot",
    ...(pricePence !== undefined ? { pricePence: fromMajor(pricePence) } : {}),
  });

  return [
    // A qualifying return-and-reduced: 214,950 → 199,950, returned 8 days ago.
    {
      propertyId: "fx-erdington-1",
      listingId: "fx-l-erdington-1",
      propertyType: "house",
      bedrooms: 3,
      sources: ["fixture-pilot"],
      observations: [
        obs("fx1-o1", "fx-erdington-1", 120, "available", 214_950),
        obs("fx1-o2", "fx-erdington-1", 40, "under-offer", 214_950),
        obs("fx1-o3", "fx-erdington-1", 8, "available", 199_950),
      ],
    },
    // A non-qualifying one: cut before under-offer, unchanged after (DH04).
    {
      propertyId: "fx-kingstanding-1",
      listingId: "fx-l-kingstanding-1",
      propertyType: "house",
      bedrooms: 2,
      sources: ["fixture-pilot"],
      observations: [
        obs("fx2-o1", "fx-kingstanding-1", 150, "available", 190_000),
        obs("fx2-o2", "fx-kingstanding-1", 120, "available", 184_950),
        obs("fx2-o3", "fx-kingstanding-1", 40, "under-offer", 184_950),
        obs("fx2-o4", "fx-kingstanding-1", 8, "available", 184_950),
      ],
    },
  ];
}

/** True when the staff-pilot fixture feed is switched on (never in production). */
export function fixturesEnabled(): boolean {
  return process.env.DEAL_HUNT_FIXTURES === "1";
}

export function dealHuntSource(): DealHuntSources {
  if (!fixturesEnabled()) return EMPTY_SOURCES;

  const histories = fixtureHistories();
  return {
    listingsAvailable: (geographyId) => geographyId === "pilot-birmingham",
    histories: async () => histories,
    // No comparable feeds in the fixture set: the result shows honest evidence
    // gaps (sold thin / rent unavailable) rather than invented ranges.
    soldComparables: async () => [],
    rentalComparables: async () => null,
    subjectFor: () => ({
      sold: { acceptableTypes: ["terraced", "semi-detached", "detached"], tenure: "freehold" },
      rent: { acceptableTypes: ["terraced", "semi-detached", "detached"] },
    }),
  };
}
