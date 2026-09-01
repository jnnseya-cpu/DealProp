import Link from "next/link";
import { TrackOnView } from "@/app/components/TrackOnView";
import { SiteHeader } from "@/app/components/chrome";
import { updateSubscriberByToken } from "@backend/store/repository";
import { LINKS } from "@shared/domain/newsletter";

export const dynamic = "force-dynamic";

export const metadata = { title: "Subscription confirmed — Lode" };

/**
 * Confirmation landing.
 *
 * Idempotent: mail clients prefetch links and people click twice, so a second
 * visit must show the same success rather than an error. The update runs
 * inside one store mutation so the two clicks cannot race.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const subscriber =
    token === undefined || token === ""
      ? undefined
      : await updateSubscriberByToken("confirmToken", token, (current) =>
          current.status === "confirmed"
            ? current
            : {
                ...current,
                status: "confirmed",
                confirmedAt: new Date().toISOString(),
              },
        );

  const confirmed = subscriber !== undefined;

  return (
    <main className="min-h-screen">
      <TrackOnView event="newsletter_confirmed" />
      <SiteHeader width="max-w-2xl" />
      <div className="mx-auto max-w-2xl px-6 py-16">
        {confirmed ? (
          <>
            <h1 className="font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
              You&apos;re subscribed.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-400">
              The first issue arrives on Monday. Every email has a one-click unsubscribe at the
              bottom — no sign-in, no questions.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href={LINKS.deals}
                className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
              >
                Browse the pipeline
              </Link>
              <Link
                href={LINKS.home}
                className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
              >
                Back to Lode
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
              That link didn&apos;t work.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-400">
              It may have already been used, or replaced by a newer one if you signed up twice.
              Subscribing again will send you a fresh link.
            </p>
            <Link
              href={LINKS.newsletter}
              className="mt-10 inline-block inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
            >
              Try again
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
