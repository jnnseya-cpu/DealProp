import { mapDisposalRelease, type LandDisposal } from "@shared/domain/land/disposals";
import { DISPOSALS_FIXTURE_RELEASES } from "@backend/land/disposalsFixtures";
import { listLandDisposals, countLandDisposals } from "@backend/store/repository";

/**
 * Land disposals — the server-side producer that turns Contracts Finder notices
 * into ranked land & property opportunities (decision #42: a live call site).
 *
 * Three states, chosen by environment, never by the screen (decision #14):
 *   - `DISPOSALS_LIVE=1`: read the loaded, classified disposals from the store,
 *     dropping any whose deadline has passed. Loaded by POST /api/cron/disposals
 *     (the register API has no keyword search, so notices are pulled and
 *     classified in bulk, the same pattern as brownfield).
 *   - `DISPOSALS_FIXTURES=1`: the staff-pilot set through the real classifier.
 *   - neither: empty, with an honest coverage boundary.
 */

export interface LandDisposalsView {
  /** True when the live loaded feed is the source. */
  readonly feedConnected: boolean;
  readonly pilot: boolean;
  readonly disposals: readonly LandDisposal[];
  /** Total loaded (live feed), so the page can say "showing N of M". */
  readonly total?: number;
  readonly error?: string;
}

/** The store reads the live path needs — injectable so the service is unit-testable. */
export interface DisposalsStore {
  listLandDisposals(opts: { limit: number; offset?: number }): Promise<readonly LandDisposal[]>;
  countLandDisposals(): Promise<number>;
}

const REPOSITORY_STORE: DisposalsStore = { listLandDisposals, countLandDisposals };

export function disposalsLiveEnabled(): boolean {
  return process.env.DISPOSALS_LIVE === "1";
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

/** A disposal with a deadline strictly before `now` is no longer live. */
function isExpired(d: LandDisposal, now: Date): boolean {
  return d.deadline !== undefined && new Date(d.deadline).getTime() < now.getTime();
}

export async function landDisposals(
  opts: { now?: Date } = {},
  store: DisposalsStore = REPOSITORY_STORE,
): Promise<LandDisposalsView> {
  const now = opts.now ?? new Date();

  if (disposalsLiveEnabled()) {
    try {
      // Disposals are few; read a bounded set and drop the expired in-process.
      const loaded = await store.listLandDisposals({ limit: 500 });
      const total = await store.countLandDisposals();
      const live = loaded.filter((d) => !isExpired(d, now));
      return { feedConnected: true, pilot: false, disposals: rank(live), total };
    } catch (e) {
      return { feedConnected: true, pilot: false, disposals: [], error: e instanceof Error ? e.message : "store unavailable" };
    }
  }

  const pilot = disposalsFixturesEnabled();
  const disposals = pilot
    ? DISPOSALS_FIXTURE_RELEASES.map(mapDisposalRelease).filter((d): d is LandDisposal => d !== undefined)
    : [];
  return { feedConnected: false, pilot, disposals: rank(disposals) };
}
