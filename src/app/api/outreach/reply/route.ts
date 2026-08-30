import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { handleReply } from "@backend/outreach/service";

export const dynamic = "force-dynamic";

/**
 * Inbound replies from the mailbox that outreach is sent from.
 *
 * Pointed at by the mail provider's inbound webhook. It exists so that a
 * request to stop is actioned when it arrives, not when somebody next opens the
 * inbox — a reply saying "remove me" that sits unread for a week is an opt-out
 * that was ignored for a week.
 *
 * Authenticated with `CRON_SECRET` and fails closed without it, on the same
 * terms as the other machine endpoints: it writes to the suppression list, and
 * anything that writes to the suppression list can also be used to flood it.
 *
 * A removal is actioned by rule before any classification, so it does not
 * depend on a model being confident or a person being available.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing to accept inbound mail." },
      { status: 503 },
    );
  }

  const provided = bearerToken(request.headers.get("authorization"));
  if (provided === undefined || !tokenMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let payload: { from?: unknown; text?: unknown; subject?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Unreadable" }, { status: 400 });
  }

  const from = typeof payload.from === "string" ? payload.from : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const subject = typeof payload.subject === "string" ? payload.subject : "";

  if (from === "" || !from.includes("@")) {
    return NextResponse.json({ error: "No sender" }, { status: 400 });
  }

  // Subject and body together: people put "remove me" in either.
  const result = await handleReply(extractAddress(from), `${subject}\n${text}`);

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}

/** `Name <a@b.c>` or a bare address. */
function extractAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled?.[1] ?? from).trim().toLowerCase();
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || value === undefined) return undefined;
  return value;
}
