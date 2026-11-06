import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { assertSourceUsable } from "@shared/domain/sources";
import {
  DEFAULT_LOAD_AREAS,
  inAreas,
  parseBulkRow,
  type PricePaidSale,
} from "@backend/sources/pricePaidBulk";
import { countPricePaidSales, savePricePaidSales } from "@backend/store/repository";
import { closePostgres } from "@backend/store/postgresStore";

/**
 * Bulk HM Land Registry Price Paid loader.
 *
 * The linked-data endpoint `fetchSales()` falls back to is sparse: many
 * residential postcodes return nothing from it even though the published bulk
 * file holds their sales. This streams that bulk file (the complete file, a
 * yearly file, or a monthly update), keeps only the configured postcode areas,
 * and upserts into the store by transaction id. Once loaded, `fetchSales()`
 * reads the dense set from the store and never touches the network.
 *
 * Get the file from HM Land Registry (Open Government Licence, free, no key):
 *   Complete (all years):
 *     http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-complete.csv
 *   Current year only:
 *     http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-<year>.csv
 * See https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads
 *
 * Usage:
 *   tsx scripts/load-price-paid.ts <path-to.csv|.csv.gz> [--areas=B,CV,DY,WS,WV] [--batch=5000]
 *   curl -Ls <url> | tsx scripts/load-price-paid.ts - [--areas=...] [--gz]
 *
 * Pass "-" as the path to read the CSV from stdin. That streams the file
 * straight through the parser into the store without ever writing it to disk —
 * which is how to load on a host too small to hold the 5GB complete file, and
 * how to load the complete file at all without a 5GB scratch write. Add --gz
 * when the piped stream is gzip-compressed.
 *
 * The store is chosen by DATABASE_URL exactly like the running app: set means
 * Postgres (the production target for a file this size), unset means the JSON
 * file store, which is a development convenience and will be slow and memory-
 * hungry past a small slice — load one area or one year into it, not the
 * complete file.
 */

interface Args {
  readonly file: string;
  readonly areas: readonly string[];
  readonly batchSize: number;
  readonly gz: boolean;
}

function parseArgs(argv: readonly string[]): Args | undefined {
  let file: string | undefined;
  let areas: readonly string[] = DEFAULT_LOAD_AREAS;
  let batchSize = 5000;
  let gz = false;

  for (const arg of argv) {
    if (arg.startsWith("--areas=")) {
      const raw = arg.slice("--areas=".length).trim();
      // --areas= (empty) means no filter: load every area in the file.
      areas = raw === "" ? [] : raw.split(",").map((a) => a.trim().toUpperCase()).filter((a) => a !== "");
    } else if (arg.startsWith("--batch=")) {
      const n = Number(arg.slice("--batch=".length));
      if (Number.isFinite(n) && n > 0) batchSize = Math.floor(n);
    } else if (arg === "--gz") {
      gz = true;
    } else if (!arg.startsWith("--") && file === undefined) {
      file = arg;
    }
  }

  if (file === undefined) return undefined;
  return { file, areas, batchSize, gz };
}

async function load(args: Args): Promise<void> {
  // The licence gate, once, before any row is read — exactly as every other
  // Price Paid read. The per-row parser stays pure.
  assertSourceUsable("land-registry-ppd", "internal-analysis");

  // "-" reads from stdin so a piped download never touches disk. Gzip is
  // applied when the name ends .gz or --gz is passed (a pipe has no name).
  const raw = args.file === "-" ? process.stdin : createReadStream(args.file);
  const input = args.gz || args.file.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  const rl = createInterface({ input, crlfDelay: Infinity });

  let read = 0;
  let kept = 0;
  let written = 0;
  let batch: PricePaidSale[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    written += await savePricePaidSales(batch);
    batch = [];
    process.stdout.write(`\r  read ${read}  kept ${kept}  written ${written}   `);
  };

  for await (const line of rl) {
    read += 1;
    const sale = parseBulkRow(line);
    if (sale === undefined) continue;
    if (!inAreas(sale.postcode, args.areas)) continue;
    kept += 1;
    batch.push(sale);
    if (batch.length >= args.batchSize) await flush();
  }
  await flush();

  const total = await countPricePaidSales();
  process.stdout.write("\n");
  // eslint-disable-next-line no-console
  console.log(
    `Done. Read ${read} rows, kept ${kept} in ${args.areas.length === 0 ? "all areas" : args.areas.join("/")}, ` +
      `wrote ${written}. Store now holds ${total} sales.`,
  );
}

const args = parseArgs(process.argv.slice(2));
if (args === undefined) {
  // eslint-disable-next-line no-console
  console.error(
    "Usage: tsx scripts/load-price-paid.ts <path-to.csv|.csv.gz|-> [--areas=B,CV,DY,WS,WV] [--batch=5000] [--gz]\n" +
      "  -        read the CSV from stdin (pipe a download so it never lands on disk).\n" +
      "  --areas  comma-separated postcode areas to keep; --areas= (empty) loads everything.\n" +
      `           Default: ${DEFAULT_LOAD_AREAS.join(",")}.\n` +
      "  --gz     the input is gzip-compressed (inferred from a .gz name otherwise).",
  );
  process.exit(1);
} else {
  load(args)
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
}
