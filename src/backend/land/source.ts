import type { LandSite } from "@shared/domain/land/types";

/**
 * The land-site source.
 *
 * By default a clean deployment has NO connected planning/land feed, so the
 * finder returns an honest empty set — never a synthetic site presented as a
 * real prospect. This is the same posture as Deal Hunt (`EMPTY_SOURCES`): data
 * is gated at the source, not the screen. Only when `LAND_FIXTURES=1` is set
 * (a staff pilot / development, never production) does it serve a small, clearly
 * synthetic set covering the real cases — a consented plot, an allocated site,
 * a strategic greenfield, and a green-belt site that must be blocked — so the
 * assessment engine can be exercised against known data.
 *
 * A real adapter replaces this once a licensed planning feed and the HM Land
 * Registry title read are configured (both procurement, not code).
 */

export const EMPTY_SITES: readonly LandSite[] = [];

/** True when the staff-pilot land fixtures are switched on (never production). */
export function landFixturesEnabled(): boolean {
  return process.env.LAND_FIXTURES === "1";
}

function fixtureSites(): LandSite[] {
  return [
    // A consented plot, openly marketed — ready, direct purchase.
    {
      id: "land-fx-consented",
      postcodeArea: "CV",
      locality: "Kenilworth",
      location: { longitude: -1.58, latitude: 52.34 },
      areaHectares: 0.6,
      currentUse: "brownfield",
      settlement: "suburban",
      planningStatus: "full",
      consentedUnits: 9,
      constraints: [],
      ownerKnown: true,
      openlyMarketed: true,
    },
    // Allocated in the local plan, off-market — promotable (option/conditional/promotion).
    {
      id: "land-fx-allocated",
      postcodeArea: "B",
      locality: "Sutton Coldfield",
      location: { longitude: -1.82, latitude: 52.56 },
      areaHectares: 3.2,
      currentUse: "agricultural",
      settlement: "edge-of-settlement",
      planningStatus: "allocated",
      constraints: [{ code: "tpo", severity: "soft", detail: "mature oaks on the boundary" }],
      ownerKnown: true,
      openlyMarketed: false,
    },
    // Unallocated greenfield with potential — strategic (option/promotion).
    {
      id: "land-fx-strategic",
      postcodeArea: "WS",
      locality: "Lichfield fringe",
      location: { longitude: -1.83, latitude: 52.68 },
      areaHectares: 8,
      currentUse: "agricultural",
      settlement: "edge-of-settlement",
      planningStatus: "none",
      constraints: [{ code: "flood-zone-2", severity: "soft" }],
      ownerKnown: false,
      openlyMarketed: false,
    },
    // Green belt — must be blocked however large, with its score capped.
    {
      id: "land-fx-greenbelt",
      postcodeArea: "WV",
      locality: "Wolverhampton green belt",
      location: { longitude: -2.13, latitude: 52.59 },
      areaHectares: 12,
      currentUse: "agricultural",
      settlement: "rural",
      planningStatus: "none",
      constraints: [{ code: "green-belt", severity: "hard" }],
      ownerKnown: false,
      openlyMarketed: false,
    },
  ];
}

/** Resolve the candidate sites. Empty unless the staff-pilot fixtures are on. */
export function landSites(): readonly LandSite[] {
  return landFixturesEnabled() ? fixtureSites() : EMPTY_SITES;
}
