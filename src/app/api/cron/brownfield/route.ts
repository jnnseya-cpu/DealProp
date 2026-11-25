import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { loadBrownfield, ENGLAND_BBOX } from "@backend/land/brownfieldLoad";
import type { BoundingBox } from "@backend/land/brownfieldSource";
import { countBrownfieldSites } from "@backend/store/repository";
import { audit } from "@backend/audit";

export const dynamic = "force-dynamic";
// A national load takes minutes; allow the handler the time even though it runs
// the load in the background.
export const maxDuration = 800;

/**
 * Brownfield register load — operator-triggered, for a container deployment with
 * no CLI access.
 *
 * The national register is far too large to fetch per request, so it is loaded
 * into the store once and read as a ranked page (the same pattern as Price Paid).
 * On a host where `npm run load:brownfield` cannot be run, this endpoint runs
 * that exact load from inside the running app — which already has the Fetcher,
 * the licence gate and the database.
 *
 * Authenticated and fail-closed on CRON_SECRET, like every other cron here. The
 * load runs in the BACKGROUND so an upstream proxy timeout cannot interrupt it;
 * the response returns immediately with the current store count. Re-POST to see
 * the count climb, or read it on /operator/land once BROWNFIELD_LIVE=1.
 *
 * Optional query params: `?bbox=west,south,east,north` loads one region (default
 * all England); `?step=0.5` uses finer tiles for dense areas.
 */

// Module-level guard: one load at a time per process. A second trigger while a
// load runs is a no-op that reports progress rather than starting a parallel run.
let running = false;

function parseBbox(value: string | null): BoundingBox | undefined {
  if (value === null) return undefined;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isFinite(n))) return undefined;
  return { west: parts[0]!, south: parts[1]!, east: parts[2]!, north: parts[3]! };
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1];
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "CRON_SECRET is not configured; refusing to run." }, { status: 503 });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const loaded = await countBrownfieldSites();
  if (running) {
    return NextResponse.json({ started: false, running: true, loaded, note: "A load is already in progress." });
  }

  const url = new URL(request.url);
  const region = parseBbox(url.searchParams.get("bbox")) ?? ENGLAND_BBOX;
  const stepRaw = Number(url.searchParams.get("step"));
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
  const national = region === ENGLAND_BBOX;
  // Which national dataset: the brownfield registers (default) or local-plan
  // housing/site allocations (the option/promotion land). Both load into the
  // same store and are told apart by the opportunity's `kind`.
  const feed = url.searchParams.get("feed") === "allocation" ? "allocation" : "brownfield";

  running = true;
  // Fire-and-forget: the persistent Node server keeps the promise alive after
  // the response is sent, so a proxy timeout on the HTTP call does not stop it.
  void loadBrownfield({ region, step, feed })
    .then(async (s) => {
      await audit("brownfield-register-loaded", {
        subject: `${feed}:${national ? "england" : `${region.west},${region.south},${region.east},${region.north}`}`,
        detail: `tiles ${s.tiles}, unique ${s.unique}, wrote ${s.written}, store holds ${s.total}` + (s.cappedTiles > 0 ? `, ${s.cappedTiles} capped tile(s)` : ""),
      });
    })
    .catch(async (e: unknown) => {
      await audit("brownfield-register-load-failed", { subject: national ? "england" : "region", detail: e instanceof Error ? e.message : "unknown error" }).catch(() => undefined);
    })
    .finally(() => {
      running = false;
    });

  return NextResponse.json({
    started: true,
    feed,
    region: national ? "all England" : region,
    loaded,
    note: `Loading ${feed} in the background. Re-POST to see the count climb; it may take a few minutes for all England.`,
  });
}

/** Read-only progress: the current store count, for polling the load. */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ running, loaded: await countBrownfieldSites() });
}
