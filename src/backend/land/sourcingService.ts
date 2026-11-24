import { assessLandSite, type LandAssessment } from "@shared/domain/land/sourcing";
import {
  mapBrownfieldEntity,
  opportunityToLandSite,
  type LandOpportunity,
} from "@shared/domain/land/brownfield";
import { BROWNFIELD_FIXTURE_ENTITIES } from "@backend/land/brownfieldFixtures";
import { fetchBrownfieldSites, type BoundingBox } from "@backend/land/brownfieldSource";
import { Fetcher } from "@backend/discovery/fetcher";

/**
 * Land sourcing — the server-side producer that turns the Brownfield Land
 * Registers into assessed, ranked development-land opportunities (decision #42).
 *
 * Three states, chosen by environment, never by the screen (decision #14):
 *   - `BROWNFIELD_LIVE=1`: read the LIVE register for the launch region through
 *     the one sanctioned outbound path (Fetcher). This is the real feed.
 *   - `LAND_SOURCING_FIXTURES=1`: the staff-pilot set, mapped through the live
 *     connector's own mapper.
 *   - neither: empty, with an honest coverage boundary.
 *
 * Each opportunity is scored by the SAME engine the account tool uses, so a
 * sourced site and a user-entered one cannot disagree. The register's own
 * dwelling capacity is carried and shown as the register's, distinct from the
 * engine's indicative estimate.
 */

/**
 * The launch region as a bounding box: the West Midlands metros (B/CV/DY/WS/WV),
 * matching the Price Paid launch area. A box query returns every brownfield site
 * in the region regardless of which authority published it — no fragile authority
 * -id chase. Widen or add regions here, in one place.
 */
export const WEST_MIDLANDS_BBOX: BoundingBox = { west: -2.25, south: 52.35, east: -1.35, north: 52.7 };

export interface SourcedSite {
  readonly opportunity: LandOpportunity;
  readonly assessment: LandAssessment;
}

export interface LandSourcingView {
  /** True when the live register feed is the source. */
  readonly feedConnected: boolean;
  /** True when the staff-pilot fixtures are the source. */
  readonly pilot: boolean;
  readonly sites: readonly SourcedSite[];
  /** Set when a live fetch failed, so the surface can say why (never a false empty). */
  readonly error?: string;
}

export function landSourcingLiveEnabled(): boolean {
  return process.env.BROWNFIELD_LIVE === "1";
}

export function landSourcingFixturesEnabled(): boolean {
  return process.env.LAND_SOURCING_FIXTURES === "1";
}

function assessAndRank(opportunities: readonly LandOpportunity[]): readonly SourcedSite[] {
  return opportunities
    .map((opportunity) => ({ opportunity, assessment: assessLandSite(opportunityToLandSite(opportunity)) }))
    .sort((a, b) => {
      const byScore = b.assessment.sourceabilityScore - a.assessment.sourceabilityScore;
      if (byScore !== 0) return byScore;
      const byUnits = (b.opportunity.maxUnits ?? 0) - (a.opportunity.maxUnits ?? 0);
      return byUnits !== 0 ? byUnits : a.opportunity.reference.localeCompare(b.opportunity.reference);
    });
}

export async function landSourcing(fetcher: Fetcher = new Fetcher()): Promise<LandSourcingView> {
  if (landSourcingLiveEnabled()) {
    const result = await fetchBrownfieldSites(fetcher, { bbox: WEST_MIDLANDS_BBOX, limit: 500 });
    if (!result.ok) {
      // A feed outage is unknown coverage, never "no sites in the region".
      return { feedConnected: true, pilot: false, sites: [], error: `live register unavailable (${result.outcome})` };
    }
    return { feedConnected: true, pilot: false, sites: assessAndRank(result.opportunities) };
  }

  const pilot = landSourcingFixturesEnabled();
  const opportunities = pilot
    ? BROWNFIELD_FIXTURE_ENTITIES.map(mapBrownfieldEntity).filter((o): o is LandOpportunity => o !== undefined)
    : [];
  return { feedConnected: false, pilot, sites: assessAndRank(opportunities) };
}
