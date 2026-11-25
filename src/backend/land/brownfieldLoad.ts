import { assessLandSite } from "@shared/domain/land/sourcing";
import { opportunityToLandSite, type StoredBrownfieldSite } from "@shared/domain/land/brownfield";
import { assertSourceUsable } from "@shared/domain/sources";
import { Fetcher } from "@backend/discovery/fetcher";
import { fetchBrownfieldSites, LAND_FEEDS, type BoundingBox, type LandFeedKey } from "@backend/land/brownfieldSource";
import { saveBrownfieldSites, countBrownfieldSites } from "@backend/store/repository";

/**
 * The national Brownfield Land Register load, shared by the CLI script and the
 * operator-triggered cron endpoint.
 *
 * The register is too large to fetch per request (10k+ sites, API-capped), so it
 * is loaded once into the store and read as a ranked page — exactly like Price
 * Paid. Loading tiles England into bounding boxes and uses the platform's
 * verified geometry filter (a point query returns only the single site under the
 * point; a box returns every site intersecting it); each tile holds well under
 * the API's page cap, so offset pagination within a tile is complete. Sites are
 * de-duplicated by reference across overlaps, scored by the same assessment
 * engine the app uses, and saved with that score so the read path ranks without
 * domain logic.
 */

export const ENGLAND_BBOX: BoundingBox = { west: -6.5, south: 49.8, east: 1.8, north: 55.9 };
const PAGE = 500;

export interface LoadProgress {
  readonly tilesDone: number;
  readonly tiles: number;
  readonly unique: number;
  readonly written: number;
}

export interface LoadSummary {
  readonly tiles: number;
  readonly unique: number;
  readonly written: number;
  readonly total: number;
  readonly cappedTiles: number;
}

export interface LoadOptions {
  readonly region?: BoundingBox;
  readonly step?: number;
  readonly fetcher?: Fetcher;
  /** Which national dataset to load: brownfield registers (default) or allocations. */
  readonly feed?: LandFeedKey;
  readonly onProgress?: (p: LoadProgress) => void;
}

export function brownfieldTiles(region: BoundingBox, step: number): BoundingBox[] {
  const out: BoundingBox[] = [];
  for (let lng = region.west; lng < region.east; lng += step) {
    for (let lat = region.south; lat < region.north; lat += step) {
      out.push({
        west: lng,
        south: lat,
        east: Math.min(lng + step, region.east),
        north: Math.min(lat + step, region.north),
      });
    }
  }
  return out;
}

export async function loadBrownfield(opts: LoadOptions = {}): Promise<LoadSummary> {
  const feed = opts.feed ?? "brownfield";
  // The licence gate, once, before any request — as every other licensed read.
  assertSourceUsable(LAND_FEEDS[feed].sourceKey, "internal-analysis");

  const fetcher = opts.fetcher ?? new Fetcher();
  const tiles = brownfieldTiles(opts.region ?? ENGLAND_BBOX, opts.step ?? 1);
  const seen = new Set<string>();
  let written = 0;
  let cappedTiles = 0;

  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t]!;
    let offset = 0;
    for (;;) {
      const r = await fetchBrownfieldSites(fetcher, { bbox: tile, limit: PAGE, offset }, feed);
      if (!r.ok) break; // a tile outage is skipped, not a false clear of the region
      const records: StoredBrownfieldSite[] = [];
      for (const o of r.opportunities) {
        if (seen.has(o.reference)) continue;
        seen.add(o.reference);
        records.push({ opportunity: o, score: assessLandSite(opportunityToLandSite(o)).sourceabilityScore });
      }
      if (records.length > 0) written += await saveBrownfieldSites(records);
      if (r.capped === true) cappedTiles += 1;
      offset += PAGE;
      if (r.received < PAGE) break;
      if (r.count !== undefined && offset >= r.count) break;
    }
    opts.onProgress?.({ tilesDone: t + 1, tiles: tiles.length, unique: seen.size, written });
  }

  const total = await countBrownfieldSites();
  return { tiles: tiles.length, unique: seen.size, written, total, cappedTiles };
}
