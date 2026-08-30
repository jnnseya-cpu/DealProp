import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { listOutreachMessages } from "@backend/store/repository";
import { sendApproved } from "@backend/outreach/service";
import { DEFAULT_CAPS, windowIsOpen, withinCaps } from "@shared/domain/campaign";

export const dynamic = "force-dynamic";

/**
 * Send the messages a person has approved, at a time a person would send them.
 *
 * Approving and sending were one action before this: somebody had to be at the
 * screen at the right moment, so either messages went out at whatever hour the
 * operator happened to be working or they sat waiting. Neither is what a
 * considered approach looks like.
 *
 * Three limits apply, and all are checked here rather than trusted from the
 * moment of approval:
 *
 *  - **The window.** Business hours only. A mandate enquiry arriving at three on
 *    a Sunday morning is read as a bulk send, because that is what it is.
 *  - **Frequency caps.** Per address and per domain, so one organisation is not
 *    written to department by department.
 *  - **The per-run cap.** A queue that grew unnoticed cannot empty itself into
 *    somebody's inbox in one go.
 *
 * `sendApproved()` re-checks eligibility and the suppression list for every
 * message at the moment it goes, so nothing here can outrun an opt-out.
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

  const now = new Date();
  const window = windowIsOpen(now);
  if (!window.open) {
    return NextResponse.json(
      {
        sent: 0,
        held: window.reason,
        nextOpenAt: window.nextOpenAt,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const all = await listOutreachMessages();
  const history = all
    .filter((m) => m.status === "sent" && m.sentAt !== undefined)
    .map((m) => ({ to: m.to, sentAt: m.sentAt ?? "" }));

  const queue = all.filter((m) => m.status === "approved");

  let sent = 0;
  let capped = 0;
  let refused = 0;
  const notes: string[] = [];

  for (const message of queue) {
    if (sent >= DEFAULT_CAPS.perRun) {
      notes.push(`Stopped at the per-run cap of ${DEFAULT_CAPS.perRun}.`);
      break;
    }

    const caps = withinCaps(message.to, history, now);
    if (!caps.allowed) {
      capped += 1;
      notes.push(caps.reason);
      continue;
    }

    const result = await sendApproved(message.id, { email: "cron" }, now);
    if (result.ok) {
      sent += 1;
      history.push({ to: message.to, sentAt: now.toISOString() });
    } else {
      refused += 1;
      notes.push(result.reason);
    }
  }

  return NextResponse.json(
    { sent, capped, refused, queued: queue.length, notes },
    { headers: { "cache-control": "no-store" } },
  );
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || value === undefined) return undefined;
  return value;
}
