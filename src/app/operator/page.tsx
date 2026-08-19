import { SiteHeader } from "@/app/components/chrome";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

/**
 * Operator sign-in.
 *
 * Reached by redirect from any operator surface. Deliberately says what this
 * protects and why, because the reason is a data-protection obligation rather
 * than a preference.
 */
export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const configured = (process.env.OPERATOR_SECRET ?? "") !== "";
  // Only same-origin paths survive; an absolute URL would make this an open
  // redirect once the operator signs in.
  const target = next !== undefined && next.startsWith("/") && !next.startsWith("//") ? next : "/deals";

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-md" />

      <div className="mx-auto max-w-md px-6 py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-lode-400">
          Restricted
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink-100">Operator access</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          The pipeline and Deal Room carry what sellers told us in confidence, including reported
          financial distress and health or capacity concerns. That is special-category personal
          data, so these pages are not public.
        </p>

        <div className="mt-8 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
          {configured ? (
            <SignInForm next={target} />
          ) : (
            <div role="status">
              <p className="text-sm text-ink-100">Operator access is not configured.</p>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">
                Set <code className="text-lode-300">OPERATOR_SECRET</code> in the environment and
                restart. Until then these pages refuse to serve rather than defaulting open.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-ink-500">
          This is a single shared password, not a user account. There is no per-person audit trail
          yet, so it is not a substitute for authentication before deal material reaches a private
          investor.
        </p>
      </div>
    </main>
  );
}
