import { assessLandSite, type LandAssessment } from "@shared/domain/land/sourcing";
import { landSites, landFixturesEnabled } from "@backend/land/source";
import { enrichConstraints, planningFetcher } from "@backend/land/enrich";
import type { LandSite } from "@shared/domain/land/types";

/**
 * Land finder — the server-side producer (decision #42: a live call site, not an
 * inert engine). It assesses every candidate site and ranks them by
 * sourceability, deterministically. With no connected feed the list is empty and
 * the surface shows the honest coverage boundary.
 *
 * When `PLANNING_DATA=1`, each site that carries a point is enriched with real
 * planning designations from planning.data.gov.uk before assessment — so the
 * hard-veto logic runs on the national record, not just what was typed in. The
 * fetch fails open to the recorded constraints, never to a false clear.
 */

export interface LandFinderView {
  readonly feedConnected: boolean;
  readonly planningEnriched: boolean;
  readonly assessments: readonly LandAssessment[];
}

/** Enrich live planning constraints when turned on. */
export function planningEnrichmentEnabled(): boolean {
  return process.env.PLANNING_DATA === "1";
}

export async function landFinder(): Promise<LandFinderView> {
  let sites: readonly LandSite[] = landSites();
  let planningEnriched = false;

  if (planningEnrichmentEnabled() && sites.length > 0) {
    const fetcher = planningFetcher();
    const enriched = await Promise.all(sites.map((s) => enrichConstraints(s, fetcher)));
    sites = enriched.map((e) => e.site);
    planningEnriched = enriched.some((e) => e.enriched);
  }

  const assessments = sites
    .map((s) => assessLandSite(s))
    .sort((a, b) => {
      const byScore = b.sourceabilityScore - a.sourceabilityScore;
      return byScore !== 0 ? byScore : a.site.id.localeCompare(b.site.id);
    });

  return {
    feedConnected: landFixturesEnabled() && sites.length > 0,
    planningEnriched,
    assessments,
  };
}
