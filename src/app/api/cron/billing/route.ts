import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { tokenMatches } from "@backend/auth/tokens";
import { expireLapsedCredits } from "@backend/store/repository";

export const dynamic = "force-dynamic";

/**
 * Housekeeping the ledger cannot do by itself.
 *
 * Expiry is the reason this exists. Prepaid balance that never lapses is an
 * open-ended liability: it sits on the balance sheet indefinitely and can be
 * redeemed years later against costs that have since risen. The expiry date is
 * set on every lot when it is created and disclosed at the point of sale — but
 * a date nothing acts on is a comment. Until this ran, every lot's expiry was
 * exactly that.
 *
 * Authenticated and fails closed on the same terms as the newsletter cron: it
 * writes to the ledger, and an endpoint that writes to the ledger is not one to
 * leave open to whoever finds the URL.
 *
 * Idempotent by construction rather than by care. Expiry writes one entry per
 * lot keyed on the lot itself, so running this twice an hour, twice a day, or
 * by hand after a failure all produce the same ledger.
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

  const now = new Date().toISOString();

  try {
    const expired = await expireLapsedCredits(now, randomUUID());
    return NextResponse.json(
      {
        at: now,
        lotsExpired: expired,
        note:
          expired === 0
            ? "Nothing had lapsed."
            : `${expired} lot(s) written off, each with a ledger entry.`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Never partially reported. The caller retries and the keys make that safe.
    process.stderr.write(`billing cron failed: ${String(error)}\n`);
    return NextResponse.json({ error: "Run failed" }, { status: 500 });
  }
}

function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || value === undefined) return undefined;
  return value;
}
