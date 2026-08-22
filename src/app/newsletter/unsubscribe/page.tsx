import Link from "next/link";
import { TrackOnView } from "@/app/components/TrackOnView";
import { SiteHeader } from "@/app/components/chrome";
import { updateSubscriberByToken } from "@backend/store/repository";
import { LINKS } from "@shared/domain/newsletter";

export const dynamic = "force-dynamic";

export const metadata = { title: "Unsubscribed — Lode" };

/**
 * Unsubscribe landing.
 *
 * Deliberately the simplest page in the application. It takes effect on the
 * GET, with no confirmation step, no sign-in and no "are you sure?" — the law
 * requires unsubscribe to be simple, and a friction-filled opt-out is both a
 * compliance problem and a good way to be marked as spam.
 *
 * Idempotent for the same reason as confirmation: prefetching and double
 * clicks must not produce an error page for someone who has already left.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const subscriber =
    token === undefined || token === ""
      ? undefined
      : await updateSubscriberByToken("unsubscribeToken", token, (current) =>
          current.status === "unsubscribed"
            ? current
            : {
                ...current,
                status: "unsubscribed",
                unsubscribedAt: new Date().toISOString(),
              },
        );

  const done = subscriber !== undefined;

  return (
    <main className="min-h-screen">
      <TrackOnView event="newsletter_unsubscribed" />
      <SiteHeader width="max-w-2xl" />
      <div className="mx-auto max-w-2xl px-6 py-20">
        {done ? (
          <>
            <h1 className="font-display text-4xl leading-tight text-ink-100">
              You&apos;re unsubscribed.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-400">
              That took effect immediately. You will not receive the weekly email again unless you
              subscribe once more.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href={LINKS.home}
                className="rounded-full border hairline px-6 py-3 text-sm text-ink-200 transition hover:border-ink-400 hover:text-ink-100"
              >
                Back to Lode
              </Link>
              <Link
                href={LINKS.newsletter}
                className="rounded-full border hairline px-6 py-3 text-sm text-ink-400 transition hover:text-ink-100"
              >
                Changed your mind?
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-4xl leading-tight text-ink-100">
              We couldn&apos;t find that subscription.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-400">
              The link may be incomplete. If you are still receiving emails, reply to any of them
              and we will remove you by hand.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
