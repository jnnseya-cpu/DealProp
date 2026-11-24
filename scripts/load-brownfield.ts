import { loadBrownfield, ENGLAND_BBOX } from "@backend/land/brownfieldLoad";
import type { BoundingBox } from "@backend/land/brownfieldSource";
import { closePostgres } from "@backend/store/postgresStore";

/**
 * National Brownfield Land Register loader (CLI).
 *
 * Thin wrapper over `loadBrownfield` (the shared core the operator-triggered cron
 * endpoint also uses). The register — planning.data.gov.uk, Open Government
 * Licence, free, no key — is bulk-loaded into the store once and read as a ranked
 * page thereafter, exactly like Price Paid.
 *
 * Usage (run where there is outbound network and DATABASE_URL points at the DB):
 *   tsx scripts/load-brownfield.ts                       # national (all England)
 *   tsx scripts/load-brownfield.ts --bbox=-2.25,52.35,-1.35,52.7   # one region
 *   tsx scripts/load-brownfield.ts --step=0.5            # finer tiles (dense areas)
 *
 * On a container deployment with no CLI access, use POST /api/cron/brownfield
 * (CRON_SECRET) instead — it runs this same load from inside the running app.
 */

interface Args {
  readonly region: BoundingBox;
  readonly step: number;
}

function parseArgs(argv: readonly string[]): Args {
  let region = ENGLAND_BBOX;
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

const args = parseArgs(process.argv.slice(2));

loadBrownfield({
  region: args.region,
  step: args.step,
  onProgress: (p) => process.stdout.write(`\r  tiles ${p.tilesDone}/${p.tiles}  unique ${p.unique}  written ${p.written}   `),
})
  .then(async (s) => {
    process.stdout.write("\n");
    // eslint-disable-next-line no-console
    console.log(
      `Done. ${s.unique} unique sites across ${s.tiles} tiles, wrote ${s.written}. Store now holds ${s.total}.` +
        (s.cappedTiles > 0 ? ` WARNING: ${s.cappedTiles} tile(s) hit the API cap — re-run with a smaller --step.` : ""),
    );
    await closePostgres();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await closePostgres().catch(() => undefined);
    process.exit(1);
  });
