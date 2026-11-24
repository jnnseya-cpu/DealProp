import type { BrownfieldEntity } from "@shared/domain/land/brownfield";

/**
 * Staff-pilot fixtures for the brownfield sourcing feed — clearly synthetic,
 * never production. Stored as raw register ENTITIES (not pre-mapped
 * opportunities) so the fixture path runs through the exact same
 * `mapBrownfieldEntity` the live connector uses: the mapping is never exercised
 * only in tests.
 *
 * Field names and value shapes mirror a REAL `brownfield-land` entity confirmed
 * against planning.data.gov.uk — the site label in `site-address`, the
 * hyphenated controlled vocabularies ("not-owned-by-a-public-authority",
 * "full-planning-permission"), `organisation-entity` as a number. Switched on
 * with `LAND_SOURCING_FIXTURES=1`, the same gating posture as the land finder.
 */
export const BROWNFIELD_FIXTURE_ENTITIES: readonly BrownfieldEntity[] = [
  // Permissioned, publicly owned, deliverable — the strongest kind of lead.
  {
    reference: "BLR-COV-014",
    name: "BLR-COV-014",
    "site-address": "Former depot, Red Lane, Coventry CV6 5EH",
    "organisation-entity": 76,
    point: "POINT (-1.49 52.42)",
    hectares: "0.62",
    "ownership-status": "owned-by-a-public-authority",
    "minimum-net-dwellings": "12",
    "maximum-net-dwellings": "20",
    "planning-permission-status": "permissioned",
    "planning-permission-type": "full-planning-permission",
    deliverable: "yes",
    "entry-date": "2025-12-31",
  },
  // Not yet permissioned, publicly owned — a real opportunity to pursue.
  {
    reference: "BLR-BCC-221",
    name: "BLR-BCC-221",
    "site-address": "Vacant garages and surplus land, Kingstanding, Birmingham B44 9AG",
    "organisation-entity": 55,
    point: "POINT (-1.86 52.54)",
    hectares: "1.1",
    "ownership-status": "owned-by-a-public-authority",
    "minimum-net-dwellings": "18",
    "maximum-net-dwellings": "34",
    "planning-permission-status": "not-permissioned",
    "planning-permission-type": "",
    deliverable: "yes",
    "entry-date": "2025-12-31",
  },
  // Larger, outline consent, privately owned — promotable with a known capacity.
  {
    reference: "BLR-WOL-087",
    name: "BLR-WOL-087",
    "site-address": "Former industrial site, Bilston Road, Wolverhampton WV2 2JH",
    "organisation-entity": 148,
    point: "POINT (-2.11 52.57)",
    hectares: "2.8",
    "ownership-status": "not-owned-by-a-public-authority",
    "minimum-net-dwellings": "60",
    "maximum-net-dwellings": "95",
    "planning-permission-status": "permissioned",
    "planning-permission-type": "outline-planning-permission",
    deliverable: "yes",
    "entry-date": "2025-09-30",
  },
  // Small, pending decision — lower down the ranking, still a real site.
  {
    reference: "BLR-DUD-039",
    name: "BLR-DUD-039",
    "site-address": "Redundant car wash, High Street, Dudley DY1 1PY",
    "organisation-entity": 91,
    point: "POINT (-2.08 52.51)",
    hectares: "0.18",
    "ownership-status": "unknown",
    "minimum-net-dwellings": "4",
    "maximum-net-dwellings": "7",
    "planning-permission-status": "pending-decision",
    "planning-permission-type": "",
    deliverable: "no",
    "entry-date": "2026-03-31",
  },
];
