import { assertSourceUsable } from "@shared/domain/sources";
import type { LandDisposal } from "@shared/domain/land/disposals";
import { Fetcher } from "@backend/discovery/fetcher";
import { fetchDisposals } from "@backend/land/disposalsSource";
import { saveLandDisposals, countLandDisposals } from "@backend/store/repository";

/**
 * Contracts Finder disposals loader, shared by the operator-triggered cron
 * endpoint (and any CLI).
 *
 * The current Contracts Finder OCDS API has no keyword search, so the only way to
 * find the land/property disposals is to pull recent notices and classify them.
 * Most notices are services/works procurement and are filtered out by the pure
 * classifier; the genuine disposals are upserted into the store and read
 * soonest-deadline-first — the same loader→store→page pattern as brownfield.
 *
 * It walks the notices published within the window, following the API's cursor,
 * classifying each page and saving the disposals. A page cap bounds the work
 * (there is a lot of procurement noise to walk past).
 */

const PER_PAGE = 100; // the API's maximum

export interface DisposalsLoadProgress {
  readonly pages: number;
  readonly notices: number;
  readonly disposals: number;
}

export interface DisposalsLoadSummary {
  readonly pages: number;
  readonly notices: number;
  readonly disposals: number;
  readonly total: number;
}

export interface DisposalsLoadOptions {
  /** How many days back to scan. Default 60. */
  readonly days?: number;
  /** Safety cap on pages walked. Default 400 (≈40k notices). */
  readonly maxPages?: number;
  readonly fetcher?: Fetcher;
  readonly onProgress?: (p: DisposalsLoadProgress) => void;
}

export async function loadDisposals(opts: DisposalsLoadOptions = {}): Promise<DisposalsLoadSummary> {
  // The licence gate, once, before any request.
  assertSourceUsable("contracts-finder", "internal-analysis");

  const fetcher = opts.fetcher ?? new Fetcher();
  const days = opts.days ?? 60;
  const maxPages = opts.maxPages ?? 400;
  const publishedFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const seen = new Set<string>();
  let pages = 0;
  let notices = 0;
  let disposalsFound = 0;
  let cursor: string | undefined;

  for (; pages < maxPages; pages++) {
    const r = await fetchDisposals(fetcher, { publishedFrom, limit: PER_PAGE, ...(cursor !== undefined ? { cursor } : {}) });
    if (!r.ok) break; // an outage ends the walk; what was saved stays
    notices += r.received;

    const fresh: LandDisposal[] = [];
    for (const d of r.disposals) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      fresh.push(d);
    }
    if (fresh.length > 0) {
      disposalsFound += await saveLandDisposals(fresh);
    }
    opts.onProgress?.({ pages: pages + 1, notices, disposals: disposalsFound });

    if (r.received < PER_PAGE || r.nextCursor === undefined) break; // last page
    cursor = r.nextCursor;
  }

  const total = await countLandDisposals();
  return { pages, notices, disposals: disposalsFound, total };
}
