import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { loadDisposals } from "@backend/land/disposalsLoad";
import { countLandDisposals } from "@backend/store/repository";
import { audit } from "@backend/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Contracts Finder disposals load — operator-triggered / scheduled.
 *
 * The register API has no keyword search, so the land/property disposals can only
 * be found by pulling recent notices and classifying them. This endpoint runs
 * that load from inside the running app (which has the Fetcher, the licence gate
 * and the database), in the BACKGROUND so an upstream proxy timeout cannot
 * interrupt it; the response returns the current store count immediately.
 *
 * Authenticated and fail-closed on CRON_SECRET, like every other cron. Safe to
 * schedule: it upserts by notice id, so a repeat run refreshes rather than
 * duplicates, and the service drops expired disposals on read. Optional `?days=`
 * sets how far back to scan (default 60).
 */

let running = false;

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

  const loaded = await countLandDisposals();
  if (running) {
    return NextResponse.json({ started: false, running: true, loaded, note: "A disposals load is already in progress." });
  }

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : 60;

  running = true;
  void loadDisposals({ days })
    .then(async (s) => {
      await audit("land-disposals-loaded", {
        subject: `last-${days}-days`,
        detail: `pages ${s.pages}, notices ${s.notices}, disposals ${s.disposals}, store holds ${s.total}`,
      });
    })
    .catch(async (e: unknown) => {
      await audit("land-disposals-load-failed", { subject: `last-${days}-days`, detail: e instanceof Error ? e.message : "unknown error" }).catch(() => undefined);
    })
    .finally(() => {
      running = false;
    });

  return NextResponse.json({
    started: true,
    days,
    loaded,
    note: "Disposals load started in the background. Re-POST to see the count climb; it walks a lot of procurement noise to find the disposals.",
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ running, loaded: await countLandDisposals() });
}
