import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";

export const dynamic = "force-dynamic";

/**
 * Access denied, with the reason.
 *
 * A bare 403 tells somebody they cannot proceed but not what to do about it,
 * which for a lapsed certification is exactly the wrong outcome: the fix is a
 * two-minute form and they should be sent to it.
 */
export default async function DeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-xl" />
      <div className="mx-auto max-w-xl px-6 py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-lode-400">
          Not available to you
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink-100">This is gated</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          {reason ?? "Your account does not hold the permission this page requires."}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/account/certify"
            className="rounded-xl bg-lode-400 px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-lode-300"
          >
            Give or renew my investor certification
          </Link>
          <Link
            href="/"
            className="rounded-xl border hairline px-5 py-2.5 text-sm text-ink-200 transition hover:border-lode-400/40"
          >
            Back to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
