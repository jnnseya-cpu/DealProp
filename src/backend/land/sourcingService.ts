import { assessLandSite, type LandAssessment } from "@shared/domain/land/sourcing";
import {
  mapBrownfieldEntity,
  opportunityToLandSite,
  type LandOpportunity,
} from "@shared/domain/land/brownfield";
import { BROWNFIELD_FIXTURE_ENTITIES } from "@backend/land/brownfieldFixtures";

/**
 * Land sourcing — the server-side producer that turns the Brownfield Land
 * Registers into assessed, ranked development-land opportunities (decision #42:
 * a live call site, not an inert engine).
 *
 * By default a clean deployment has NO connected feed, so the list is empty and
 * the surface shows the honest coverage boundary — data gated at the source, not
 * the screen (decision #14). `LAND_SOURCING_FIXTURES=1` serves the staff-pilot
 * set so the engine can be exercised end to end. The live registers are read
 * through `fetchBrownfieldSites` once the `brownfield-land` area query is
 * verified against one real request.
 *
 * Each opportunity is scored by the SAME assessment engine the account tool
 * uses, so a sourced site and a user-entered one cannot disagree. The register's
 * own dwelling capacity is carried on the opportunity and shown as the
 * register's figure, kept distinct from the engine's indicative estimate.
 */

export interface SourcedSite {
  readonly opportunity: LandOpportunity;
  readonly assessment: LandAssessment;
}

export interface LandSourcingView {
  /** True only when a real licensed feed is wired (never for the fixtures). */
  readonly feedConnected: boolean;
  /** True when the staff-pilot fixtures are the source. */
  readonly pilot: boolean;
  readonly sites: readonly SourcedSite[];
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

export function landSourcing(): LandSourcingView {
  const pilot = landSourcingFixturesEnabled();
  const opportunities = pilot
    ? BROWNFIELD_FIXTURE_ENTITIES.map(mapBrownfieldEntity).filter((o): o is LandOpportunity => o !== undefined)
    : [];
  return {
    // The fixtures are a pilot set, not a live feed; a connected feed waits on
    // the verified brownfield-land query, so this stays false until then.
    feedConnected: false,
    pilot,
    sites: assessAndRank(opportunities),
  };
}
