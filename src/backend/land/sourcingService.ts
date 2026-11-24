import { assessLandSite, type LandAssessment } from "@shared/domain/land/sourcing";
import {
  mapBrownfieldEntity,
  opportunityToLandSite,
  type LandOpportunity,
} from "@shared/domain/land/brownfield";
import type { StoredBrownfieldSite } from "@shared/domain/land/brownfield";
import { BROWNFIELD_FIXTURE_ENTITIES } from "@backend/land/brownfieldFixtures";
import { listBrownfieldSites, countBrownfieldSites } from "@backend/store/repository";

/** The store reads the live path needs — injectable so the service is unit-testable. */
export interface SourcingStore {
  listBrownfieldSites(opts: { limit: number; offset?: number; postcodeArea?: string }): Promise<readonly StoredBrownfieldSite[]>;
  countBrownfieldSites(): Promise<number>;
}

const REPOSITORY_STORE: SourcingStore = { listBrownfieldSites, countBrownfieldSites };

/**
 * Land sourcing — the server-side producer that turns the national Brownfield
 * Land Register into assessed, ranked development-land opportunities (#42).
 *
 * Three states, chosen by environment, never by the screen (decision #14):
 *   - `BROWNFIELD_LIVE=1`: read the loaded national register from the store, as a
 *     score-ranked page. The register is bulk-loaded by `npm run load:brownfield`
 *     (it is far too large — 10k+ sites — to fetch per request), exactly as Price
 *     Paid is loaded. This is the real feed.
 *   - `LAND_SOURCING_FIXTURES=1`: the staff-pilot set, mapped through the live
 *     connector's own mapper.
 *   - neither: empty, with an honest coverage boundary.
 *
 * Each opportunity is scored by the SAME engine the account tool uses, so a
 * sourced site and a user-entered one cannot disagree. The register's own
 * dwelling capacity is carried and shown as the register's, distinct from the
 * engine's indicative estimate.
 */

/** How many top-ranked sites a page shows. */
export const SOURCING_PAGE_SIZE = 50;

/**
 * The planning statuses behind each acquisition approach, so a user can see the
 * option/promotion opportunities, not just the top-ranked consented ones.
 * "buy" = a consent exists (direct purchase); "secure" = no usable consent, so
 * the land is controlled by option / conditional / promotion while planning is
 * pursued.
 */
export const ACQUISITION_VIEWS = {
  buy: ["full", "reserved-matters", "outline"],
  secure: ["none", "pre-application", "allocated", "lapsed", "refused"],
} as const;

export type AcquisitionView = "all" | "buy" | "secure";

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
  /** Total loaded sites (live feed), so the page can say "top N of M". */
  readonly total?: number;
  /** Set when a live read failed, so the surface can say why (never a false empty). */
  readonly error?: string;
}

export function landSourcingLiveEnabled(): boolean {
  return process.env.BROWNFIELD_LIVE === "1";
}

export function landSourcingFixturesEnabled(): boolean {
  return process.env.LAND_SOURCING_FIXTURES === "1";
}

function assess(opportunity: LandOpportunity): SourcedSite {
  return { opportunity, assessment: assessLandSite(opportunityToLandSite(opportunity)) };
}

function rankFixtures(opportunities: readonly LandOpportunity[]): readonly SourcedSite[] {
  return opportunities
    .map(assess)
    .sort((a, b) => {
      const byScore = b.assessment.sourceabilityScore - a.assessment.sourceabilityScore;
      if (byScore !== 0) return byScore;
      const byUnits = (b.opportunity.maxUnits ?? 0) - (a.opportunity.maxUnits ?? 0);
      return byUnits !== 0 ? byUnits : a.opportunity.reference.localeCompare(b.opportunity.reference);
    });
}

export async function landSourcing(
  opts: { postcodeArea?: string; page?: number; view?: AcquisitionView } = {},
  store: SourcingStore = REPOSITORY_STORE,
): Promise<LandSourcingView> {
  if (landSourcingLiveEnabled()) {
    try {
      const offset = Math.max(0, (opts.page ?? 0)) * SOURCING_PAGE_SIZE;
      const planningStatuses = opts.view === "buy" || opts.view === "secure" ? ACQUISITION_VIEWS[opts.view] : undefined;
      const records = await store.listBrownfieldSites({
        limit: SOURCING_PAGE_SIZE,
        offset,
        ...(opts.postcodeArea !== undefined ? { postcodeArea: opts.postcodeArea } : {}),
        ...(planningStatuses !== undefined ? { planningStatuses } : {}),
      });
      const total = await store.countBrownfieldSites();
      // The store already ranks by stored score; re-assess only the page for display.
      const sites = records.map((r) => assess(r.opportunity));
      return { feedConnected: true, pilot: false, sites, total };
    } catch (e) {
      // A store/read failure is unknown coverage, never "no sites".
      return { feedConnected: true, pilot: false, sites: [], error: e instanceof Error ? e.message : "store unavailable" };
    }
  }

  const pilot = landSourcingFixturesEnabled();
  const opportunities = pilot
    ? BROWNFIELD_FIXTURE_ENTITIES.map(mapBrownfieldEntity).filter((o): o is LandOpportunity => o !== undefined)
    : [];
  return { feedConnected: false, pilot, sites: rankFixtures(opportunities) };
}
