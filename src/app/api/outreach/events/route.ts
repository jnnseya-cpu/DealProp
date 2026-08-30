import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { addSuppression, listDiscoveryCandidates, listOutreachMessages, saveDiscoveryCandidate, saveOutreachMessage } from "@backend/store/repository";
import { outcomeOf, type DeliveryEvent } from "@shared/domain/campaign";

export const dynamic = "force-dynamic";

const KNOWN: readonly string[] = ["delivered", "bounced", "complained", "unsubscribed"];

/**
 * Delivery events from the mail provider.
 *
 * A complaint is somebody pressing "this is spam". It suppresses immediately
 * and is never weighed against anything — there is no threshold, no review and
 * no second chance, because there is no version of that signal that means
 * "write again".
 *
 * A hard bounce suppresses too. Continuing to send to an address that does not
 * exist damages the sending domain's reputation for every message that shares
 * it, including the newsletter that real subscribers asked for.
 *
 * Authenticated on `CRON_SECRET` and failing closed, like every other machine
 * endpoint: it writes to the suppression list, and anything that writes there
 * can also be used to fill it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let payload: { event?: unknown; email?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Unreadable" }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const event = typeof payload.event === "string" ? payload.event.toLowerCase() : "";

  if (email === "" || !email.includes("@")) {
    return NextResponse.json({ error: "No address" }, { status: 400 });
  }
  if (!KNOWN.includes(event)) {
    // Recorded rather than errored: an event type the provider adds later is
    // not a failure it can fix by sending it again.
    return NextResponse.json({ status: "ignored", reason: `Unknown event ${event}.` });
  }

  const outcome = outcomeOf(event as DeliveryEvent);
  const at = new Date().toISOString();

  if (outcome.suppress) {
    await addSuppression({ email, reason: outcome.reason, at });

    for (const entry of await listDiscoveryCandidates()) {
      if (entry.candidate.publishedEmail?.value.toLowerCase() !== email) continue;
      await saveDiscoveryCandidate({
        ...entry,
        candidate: { ...entry.candidate, optedOut: true, doNotContact: true },
        notes: [...entry.notes, `${event} on ${at.slice(0, 10)}: ${outcome.reason}`],
      });
    }
  }

  if (event === "bounced") {
    for (const message of await listOutreachMessages()) {
      if (message.to.trim().toLowerCase() !== email || message.bouncedAt !== undefined) continue;
      await saveOutreachMessage({ ...message, bouncedAt: at });
    }
  }

  return NextResponse.json(
    { status: "recorded", event, suppressed: outcome.suppress, reason: outcome.reason },
    { headers: { "cache-control": "no-store" } },
  );
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || value === undefined) return undefined;
  return value;
}
