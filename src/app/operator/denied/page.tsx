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
        <p className="eyebrow">
          Not available to you
        </p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">This is gated</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          {reason ?? "Your account does not hold the permission this page requires."}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/account/certify"
            className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
          >
            Give or renew my investor certification
          </Link>
          <Link
            href="/"
            className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
          >
            Back to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
