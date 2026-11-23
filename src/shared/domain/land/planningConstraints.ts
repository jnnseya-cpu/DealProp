import type { Constraint, ConstraintCode } from "@shared/domain/land/types";

/**
 * Map the national Planning Data platform (planning.data.gov.uk) onto LODE's
 * land constraints.
 *
 * The platform publishes, under the Open Government Licence, the planning
 * designations that decide whether a site is developable — green belt,
 * conservation areas, listed buildings, SSSIs, ancient woodland, TPOs and the
 * rest — queryable for a point. This is the free half of the land finder: it
 * makes the green-belt / SSSI / ancient-woodland hard vetoes real, on real
 * sites, with no licence to buy.
 *
 * It does NOT serve flood risk: Flood Zones 2 and 3 are Environment Agency data
 * (the "Flood Map for Planning"), a different source behind a different API, so
 * flood is never auto-detected from this query — it stays a fact the user
 * declares (and checks on the EA map) until an EA connector is wired. Parcels
 * and ownership still need the licensed feeds.
 *
 * Pure: it maps a parsed list of entities to constraints. The backend connector
 * does the fetch; this is the part that decides what a designation means, and it
 * is fully testable against a fixture response.
 */

/** One entity as the planning.data.gov.uk entity API returns it (loosely typed). */
export interface PlanningEntity {
  readonly dataset?: string;
  readonly name?: string;
  readonly reference?: string;
  /** flood-risk-zone entities carry the zone level as "1" | "2" | "3". */
  readonly "flood-risk-level"?: string;
  readonly [key: string]: unknown;
}

/** dataset → the constraint it maps to, and whether that constraint is hard. */
const DATASET_MAP: Record<string, { code: ConstraintCode; severity: "hard" | "soft" }> = {
  "green-belt": { code: "green-belt", severity: "hard" },
  "site-of-special-scientific-interest": { code: "sssi", severity: "hard" },
  "ancient-woodland": { code: "ancient-woodland", severity: "hard" },
  "conservation-area": { code: "conservation-area", severity: "soft" },
  "listed-building": { code: "listed-building", severity: "soft" },
  "listed-building-outline": { code: "listed-building", severity: "soft" },
  "area-of-outstanding-natural-beauty": { code: "aonb", severity: "soft" },
  "tree-preservation-zone": { code: "tpo", severity: "soft" },
  "tree-preservation-order": { code: "tpo", severity: "soft" },
};

export interface PlanningConstraintsMapping {
  readonly constraints: readonly Constraint[];
  /** Raw dataset names found, so an unmapped designation is still visible. */
  readonly designations: readonly string[];
  /** A site allocation in a development plan was found at this point. */
  readonly allocation: boolean;
}

/**
 * Map planning.data.gov.uk entities to LODE constraints. Flood-risk-zone level 3
 * is a hard constraint, level 2 soft; green belt, SSSI and ancient woodland are
 * always hard. Unmapped datasets are preserved as designations (never silently
 * dropped) and an `-allocation` dataset sets the allocation flag. Constraints
 * are de-duplicated by code, keeping the hardest severity seen.
 */
export function mapPlanningEntities(entities: readonly PlanningEntity[]): PlanningConstraintsMapping {
  const byCode = new Map<ConstraintCode, Constraint>();
  const designations = new Set<string>();
  let allocation = false;

  const add = (code: ConstraintCode, severity: "hard" | "soft", detail?: string): void => {
    const existing = byCode.get(code);
    // Keep the hardest severity seen for a code.
    if (existing === undefined || (existing.severity === "soft" && severity === "hard")) {
      byCode.set(code, { code, severity, ...(detail !== undefined ? { detail } : {}) });
    }
  };

  for (const e of entities) {
    const dataset = typeof e.dataset === "string" ? e.dataset : "";
    if (dataset === "") continue;
    designations.add(dataset);

    if (dataset.includes("allocation")) allocation = true;

    // Flood entities are NOT served by planning.data.gov.uk (they are
    // Environment Agency data). This branch is the mapping used if/when an EA
    // flood source is wired through the same mapper; the live land query below
    // does not request flood, so it never fires on today's data.
    if (dataset === "flood-risk-zone") {
      const level = typeof e["flood-risk-level"] === "string" ? e["flood-risk-level"] : "";
      if (level === "3") add("flood-zone-3", "hard", "flood risk zone 3");
      else if (level === "2") add("flood-zone-2", "soft", "flood risk zone 2");
      continue;
    }

    const mapped = DATASET_MAP[dataset];
    if (mapped !== undefined) {
      add(mapped.code, mapped.severity, typeof e.name === "string" ? e.name : undefined);
    }
  }

  return {
    constraints: [...byCode.values()],
    designations: [...designations],
    allocation,
  };
}

/**
 * The datasets worth querying for a land assessment.
 *
 * Flood is deliberately absent: planning.data.gov.uk does not publish flood
 * zones (that is Environment Agency data on a separate API), so querying it here
 * would always return nothing and imply a check we are not making.
 *
 * NB: these ids still need confirming against the live dataset list
 * (`/dataset.json`) — e.g. TPOs may be `tree-preservation-zone`, `tree` or both,
 * and AONB may be published as `area-of-outstanding-natural-beauty` or the newer
 * `national-landscape`. Until verified against one real request, a silent "none
 * found" is treated as unknown coverage, never a clearance.
 */
export const LAND_CONSTRAINT_DATASETS: readonly string[] = [
  "green-belt",
  "site-of-special-scientific-interest",
  "ancient-woodland",
  "conservation-area",
  "listed-building",
  "area-of-outstanding-natural-beauty",
  "tree-preservation-zone",
  "article-4-direction",
];
