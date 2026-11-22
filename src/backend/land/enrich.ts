import { Fetcher } from "@backend/discovery/fetcher";
import { fetchPlanningConstraints } from "@backend/land/planningData";
import type { Constraint, LandSite } from "@shared/domain/land/types";

/**
 * Enrich a site's constraints with the real planning designations at its point,
 * from planning.data.gov.uk. The free half of the land finder working on real
 * data: a site the operator believed was clean gets its green belt, flood zone
 * or SSSI added from the national record before it is assessed.
 *
 * Fails open to what was recorded, never to a false "clear": if the site has no
 * point, or the fetch is refused/unavailable, the site keeps its recorded
 * constraints and says so — a feed gap is unknown data, not an absence of
 * constraints (the same rule the rest of discovery follows).
 */

export interface EnrichedSite {
  readonly site: LandSite;
  readonly enriched: boolean;
  readonly note: string;
}

function mergeConstraints(
  existing: readonly Constraint[],
  fetched: readonly Constraint[],
): Constraint[] {
  const byCode = new Map<string, Constraint>();
  for (const c of existing) byCode.set(c.code, c);
  for (const c of fetched) {
    const prev = byCode.get(c.code);
    // A fetched hard constraint upgrades a recorded soft one; never downgrades.
    if (prev === undefined || (prev.severity === "soft" && c.severity === "hard")) {
      byCode.set(c.code, c);
    }
  }
  return [...byCode.values()];
}

export async function enrichConstraints(site: LandSite, fetcher: Fetcher): Promise<EnrichedSite> {
  if (site.location === undefined) {
    return { site, enriched: false, note: "no point on record — constraints are as recorded" };
  }
  const result = await fetchPlanningConstraints(fetcher, site.location);
  if (!result.ok) {
    return { site, enriched: false, note: `planning data unavailable (${result.outcome}) — constraints as recorded` };
  }
  return {
    site: { ...site, constraints: mergeConstraints(site.constraints, result.constraints) },
    enriched: true,
    note: `planning.data.gov.uk: ${result.designations.join(", ") || "no designations at this point"}`,
  };
}

/** A production Fetcher for the planning-data host (default transport). */
export function planningFetcher(): Fetcher {
  return new Fetcher();
}
