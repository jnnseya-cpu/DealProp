import { assertSourceUsable } from "@shared/domain/sources";
import { assessLandSite } from "@shared/domain/land/sourcing";
import { opportunityToLandSite, type StoredBrownfieldSite } from "@shared/domain/land/brownfield";
import { Fetcher } from "@backend/discovery/fetcher";
import { fetchBrownfieldSites, type BoundingBox } from "@backend/land/brownfieldSource";
import { saveBrownfieldSites, countBrownfieldSites } from "@backend/store/repository";
import { closePostgres } from "@backend/store/postgresStore";

/**
 * National Brownfield Land Register loader.
 *
 * The register (planning.data.gov.uk, Open Government Licence, free, no key) holds
 * 10,000+ previously-developed sites judged suitable for housing — far too many to
 * fetch per request, so, exactly like Price Paid, it is bulk-loaded into the store
 * once and read as a ranked page thereafter.
 *
 * It loads by TILING England into bounding boxes and querying each with the
 * platform's verified geometry filter (the one-point query only returns the single
 * site under a point; a box returns every site intersecting it). Each tile holds
 * well under the API's 10k page cap, so offset pagination within a tile is complete.
 * Sites are de-duplicated by reference across overlapping tiles (the store upserts
 * by reference regardless), scored by the same assessment engine the app uses, and
 * saved with that score so the read path ranks without domain logic.
 *
 * Usage (run where there is outbound network — e.g. the server):
 *   tsx scripts/load-brownfield.ts                       # national (all England)
 *   tsx scripts/load-brownfield.ts --bbox=-2.25,52.35,-1.35,52.7   # one region
 *   tsx scripts/load-brownfield.ts --step=0.5            # finer tiles (denser areas)
 *
 * The store is chosen by DATABASE_URL exactly like the app: set means Postgres (the
 * production target), unset means the JSON file store (fine for one region, slow for
 * the whole country).
 */

const ENGLAND: BoundingBox = { west: -6.5, south: 49.8, east: 1.8, north: 55.9 };
const PAGE = 500;

interface Args {
  readonly region: BoundingBox;
  readonly step: number;
}

function parseArgs(argv: readonly string[]): Args {
  let region = ENGLAND;
  let step = 1;
  for (const arg of argv) {
    if (arg.startsWith("--bbox=")) {
      const parts = arg.slice("--bbox=".length).split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        region = { west: parts[0]!, south: parts[1]!, east: parts[2]!, north: parts[3]! };
      }
    } else if (arg.startsWith("--step=")) {
      const n = Number(arg.slice("--step=".length));
      if (Number.isFinite(n) && n > 0) step = n;
    }
  }
  return { region, step };
}

function tilesOf(region: BoundingBox, step: number): BoundingBox[] {
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

const fmt = (b: BoundingBox): string => `[${b.west.toFixed(1)},${b.south.toFixed(1)} → ${b.east.toFixed(1)},${b.north.toFixed(1)}]`;

async function load(args: Args): Promise<void> {
  // The licence gate, once, before any request — as every other licensed read.
  assertSourceUsable("brownfield-land", "internal-analysis");

  const fetcher = new Fetcher();
  const tiles = tilesOf(args.region, args.step);
  const seen = new Set<string>();
  let written = 0;
  let capped = 0;

  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t]!;
    let offset = 0;
    for (;;) {
      const r = await fetchBrownfieldSites(fetcher, { bbox: tile, limit: PAGE, offset });
      if (!r.ok) {
        process.stdout.write(`\n  tile ${fmt(tile)} failed: ${r.reason}\n`);
        break;
      }
      const records: StoredBrownfieldSite[] = [];
      for (const o of r.opportunities) {
        if (seen.has(o.reference)) continue;
        seen.add(o.reference);
        records.push({ opportunity: o, score: assessLandSite(opportunityToLandSite(o)).sourceabilityScore });
      }
      if (records.length > 0) written += await saveBrownfieldSites(records);
      if (r.capped === true) capped += 1;
      offset += PAGE;
      if (r.received < PAGE) break;
      if (r.count !== undefined && offset >= r.count) break;
    }
    process.stdout.write(`\r  tiles ${t + 1}/${tiles.length}  unique ${seen.size}  written ${written}   `);
  }

  const total = await countBrownfieldSites();
  process.stdout.write("\n");
  // eslint-disable-next-line no-console
  console.log(
    `Done. ${seen.size} unique sites across ${tiles.length} tiles, wrote ${written}. Store now holds ${total}.` +
      (capped > 0 ? ` WARNING: ${capped} tile(s) hit the API cap — re-run with a smaller --step to avoid missing sites.` : ""),
  );
}

load(parseArgs(process.argv.slice(2)))
  .then(async () => {
    await closePostgres();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await closePostgres().catch(() => undefined);
    process.exit(1);
  });
