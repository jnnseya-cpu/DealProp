import { assessLandSite, type LandAssessment } from "@shared/domain/land/sourcing";
import { landSites, landFixturesEnabled } from "@backend/land/source";

/**
 * Land finder — the server-side producer (decision #42: a live call site, not an
 * inert engine). It assesses every candidate site and ranks them by
 * sourceability, deterministically. With no connected feed the list is empty and
 * the surface shows the honest coverage boundary.
 */

export interface LandFinderView {
  readonly feedConnected: boolean;
  readonly assessments: readonly LandAssessment[];
}

export function landFinder(): LandFinderView {
  const sites = landSites();
  const assessments = sites
    .map((s) => assessLandSite(s))
    .sort((a, b) => {
      const byScore = b.sourceabilityScore - a.sourceabilityScore;
      return byScore !== 0 ? byScore : a.site.id.localeCompare(b.site.id);
    });
  return { feedConnected: landFixturesEnabled() && sites.length > 0, assessments };
}
