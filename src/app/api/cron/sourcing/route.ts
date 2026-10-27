import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { parseAreas, sweepAreas } from "@backend/discovery/sweep";
import { audit } from "@backend/audit";

export const dynamic = "force-dynamic";

/**
 * Weekly property sourcing sweep.
 *
 * Invoked by a scheduler (point it at, say, Monday morning). It runs the
 * configured areas — SOURCING_AREAS, a comma- or newline-separated list of
 * postcodes and/or council names — and refreshes the worklist with the
 * prepared-but-unsold leads each produces, so the operator opens the sourcing
 * page to a fresh ranked shortlist with no clicks.
 *
 * Three properties, as with the newsletter cron:
 *  1. AUTHENTICATED. Requires CRON_SECRET and refuses to run without it, rather
 *     than defaulting open — this endpoint spends the EPC call budget and hits
 *     the Price Paid endpoint, so it is not a free button for anyone.
 *  2. IDEMPOTENT. The store merges on the address key: a re-sweep updates
 *     lastSeenAt, keeps firstSeenAt, and never un-dismisses a set-aside lead, so
 *     firing twice or retrying changes nothing but the timestamp.
 *  3. FINDS, NEVER CONTACTS. It only writes property-fact leads to the worklist;
 *     the distress signals are not warehoused and nothing is approached. A named
 *     person still works each lead by post.
 */

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1];
}

function authorise(request: Request): NextResponse | undefined {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "CRON_SECRET is not configured; refusing to run." }, { status: 503 });
  }
  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return undefined;
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = authorise(request);
  if (denied !== undefined) return denied;

  const areas = parseAreas(process.env.SOURCING_AREAS);
  if (areas.length === 0) {
    return NextResponse.json({
      areas: [],
      totalSaved: 0,
      note: "SOURCING_AREAS is not configured, so there is nothing to sweep.",
    });
  }

  const result = await sweepAreas(areas);

  await audit("mandate-saved", {
    subject: "sourcing-sweep",
    detail: `Weekly sweep of ${result.areas.length} area(s): ${result.totalSaved} prepared-but-unsold lead(s) refreshed on the worklist.`,
  });

  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({ event: "sourcing.sweep", areas: result.areas.length, saved: result.totalSaved }),
  );

  return NextResponse.json(result);
}

/** GET reports what the next sweep would cover, without running it. */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = authorise(request);
  if (denied !== undefined) return denied;

  const areas = parseAreas(process.env.SOURCING_AREAS);
  return NextResponse.json({
    configured: areas.length,
    areas,
    note:
      areas.length === 0
        ? "Set SOURCING_AREAS (comma- or newline-separated postcodes and/or council names) to enable the weekly sweep."
        : "These areas are swept on each run.",
  });
}
