import { SiteHeader } from "@/app/components/chrome";

export const metadata = { title: "Offline — Lode" };

/**
 * Offline fallback, served by the service worker when a navigation fails.
 *
 * Deliberately shows no figures. Everything this app displays is computed from
 * live state, and a cached number presented without its context is exactly the
 * failure the platform exists to prevent — so offline shows nothing rather than
 * something stale.
 */
export default function OfflinePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-2xl" />
      <div className="mx-auto max-w-2xl px-6 py-24">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          No connection
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100">
          You&apos;re offline.
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-400">
          Lode computes every figure live — deal scores, stress tests, capital stacks — so there is
          nothing useful to show you without a connection. We would rather show you nothing than a
          number that was true yesterday.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-500">
          This page will work again the moment you reconnect.
        </p>
      </div>
    </main>
  );
}
