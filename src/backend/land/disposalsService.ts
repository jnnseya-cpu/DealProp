import { mapDisposalRelease, type LandDisposal } from "@shared/domain/land/disposals";
import { DISPOSALS_FIXTURE_RELEASES } from "@backend/land/disposalsFixtures";

/**
 * Land disposals — the server-side producer that turns Contracts Finder notices
 * into ranked land & property opportunities (decision #42: a live call site).
 *
 * EMPTY by default so a clean deployment shows an honest coverage boundary
 * (decision #14). `DISPOSALS_FIXTURES=1` serves the staff-pilot set, run through
 * the live connector's own classifier and mapper. The live search is read
 * through `fetchDisposals` once the Contracts Finder query is verified against
 * one real request.
 */

export interface LandDisposalsView {
  /** True only when a real licensed feed is wired (never for the fixtures). */
  readonly feedConnected: boolean;
  readonly pilot: boolean;
  readonly disposals: readonly LandDisposal[];
}

export function disposalsFixturesEnabled(): boolean {
  return process.env.DISPOSALS_FIXTURES === "1";
}

/** Soonest live deadline first; undated deadlines last; then newest first. */
function rank(disposals: readonly LandDisposal[]): readonly LandDisposal[] {
  return [...disposals].sort((a, b) => {
    if (a.deadline !== undefined && b.deadline !== undefined) {
      const byDeadline = a.deadline.localeCompare(b.deadline);
      if (byDeadline !== 0) return byDeadline;
    } else if (a.deadline !== undefined) {
      return -1;
    } else if (b.deadline !== undefined) {
      return 1;
    }
    return (b.published ?? "").localeCompare(a.published ?? "");
  });
}

export function landDisposals(): LandDisposalsView {
  const pilot = disposalsFixturesEnabled();
  const disposals = pilot
    ? DISPOSALS_FIXTURE_RELEASES.map(mapDisposalRelease).filter((d): d is LandDisposal => d !== undefined)
    : [];
  return {
    // Fixtures are a pilot, not a live feed; a connected feed waits on the
    // verified Contracts Finder query.
    feedConnected: false,
    pilot,
    disposals: rank(disposals),
  };
}
