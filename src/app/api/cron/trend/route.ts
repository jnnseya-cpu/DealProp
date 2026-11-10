import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { platformBriefing } from "@backend/trend/briefing";
import { audit } from "@backend/audit";

export const dynamic = "force-dynamic";

/**
 * Trend Intelligence — the invisible background run.
 *
 * Trend Intelligence is embedded onto LODE, not a separate product and not a
 * page. This endpoint is how it works: a scheduler invokes it periodically, it
 * runs the engine over LODE's own first-party demand (deals, enquiries, page
 * attention, buyer capacity), and it records the eligible Growth Briefs to the
 * append-only audit trail. No UI, no user-visible output — the briefs are then
 * resolvable by the existing agents through `effectiveBriefFor` at run time.
 *
 * Two properties, the same as every other cron here:
 *
 *  1. AUTHENTICATED and FAIL-CLOSED. It requires CRON_SECRET and refuses to run
 *     without one, rather than defaulting open.
 *  2. SIDE-EFFECT-LIGHT. It only computes and records; it sends nothing and
 *     changes no user-facing surface. A scheduler that fires twice simply
 *     records two (idempotent-in-effect) observations of the same demand.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing to run." },
      { status: 503 },
    );
  }

  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const briefing = await platformBriefing(new Date());

  // Record each eligible brief to the audit trail (append-only, decision #17).
  // The detail carries the topic, scores and channels — never a seller's data.
  for (const brief of briefing.briefs) {
    await audit("trend-briefing-recorded", {
      subject: `${brief.platform_id}:${brief.topic_id}`,
      detail: `score ${brief.opportunity_score} confidence ${brief.confidence} → ${brief.allowed_channels.join(", ")} (brief ${brief.brief_id})`,
    });
  }

  return NextResponse.json({
    computedAt: briefing.computedAt,
    opportunities: briefing.opportunities.length,
    briefs: briefing.briefs.length,
    note:
      briefing.opportunities.length === 0
        ? "No first-party demand on record yet — nothing to score."
        : "Trend briefing computed and recorded.",
  });
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1];
}
