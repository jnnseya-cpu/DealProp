import { NextResponse } from "next/server";
import { storeKind } from "@backend/store/repository";

export const dynamic = "force-dynamic";

/**
 * Health check, for the host and for uptime monitoring.
 *
 * Unauthenticated, and therefore deliberately uninformative. It answers "is
 * this instance serving and can it reach its store" and nothing else: no
 * version, no configuration, no counts, no error text. A health endpoint that
 * reports the database hostname or the stack trace of a failed connection is a
 * reconnaissance endpoint with a friendly name.
 *
 * 200 when the store answers, 503 when it does not, so a load balancer can take
 * a broken instance out of rotation rather than serving errors from it.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const kind = await storeKind();

    if (kind === "postgres") {
      // A cheap round trip that proves the connection works rather than merely
      // that a pool object was constructed.
      const { postgresStore } = await import("@backend/store/postgresStore");
      await postgresStore.isEmpty();
    }

    return NextResponse.json(
      { status: "ok", store: kind },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The reason is written to the server log, not returned. Whoever can read
    // the log is entitled to it; whoever can curl the endpoint is not.
    process.stderr.write("health: store unreachable\n");
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
