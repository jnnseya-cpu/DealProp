import { SiteHeader } from "@/app/components/chrome";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

/**
 * Sign-in.
 *
 * Two panels, and the normal one leads. By default this is the account
 * sign-in everyone uses — an email and a password. The operator/admin entrance
 * (the shared password) is a quiet link beneath it, reached with `?mode=operator`,
 * so a visitor is not met with a "restricted" screen and an operator is one
 * click away. Reached by redirect from any gated surface, which carries `next`.
 */
export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  const { next, mode: rawMode } = await searchParams;
  const mode = rawMode === "operator" ? "operator" : "account";
  const configured = (process.env.OPERATOR_SECRET ?? "") !== "";
  // Only same-origin paths survive; an absolute URL would make this an open
  // redirect once signed in. Operators land on the cockpit (which carries the
  // full operator nav); a normal account lands on the pipeline.
  const fallback = mode === "operator" ? "/operator/dashboard" : "/deals";
  const target =
    next !== undefined && next.startsWith("/") && !next.startsWith("//") ? next : fallback;

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-md" />

      <div className="mx-auto max-w-md px-6 py-16">
        {mode === "operator" ? (
          <>
            <p className="eyebrow">Restricted</p>
            <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
              Operator &amp; admin access
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-ink-300">
              The pipeline and Deal Room carry what sellers told us in confidence, including
              reported financial distress and health or capacity concerns. That is
              special-category personal data, so this entrance is separate and audited.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">Sign in</p>
            <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
              Sign in to Lode
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-ink-300">
              Access your account — your opportunities, deals, readiness and profile. Operators and
              admins sign in through the link below.
            </p>
          </>
        )}

        <div className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          {configured ? (
            <SignInForm next={target} mode={mode} />
          ) : (
            <div role="status">
              <p className="text-sm text-ink-100">Sign-in is not configured.</p>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">
                Set <code className="text-lode-300">OPERATOR_SECRET</code> in the environment and
                restart. Until then this refuses to serve rather than defaulting open.
              </p>
            </div>
          )}
        </div>

        {mode === "operator" && (
          <p className="mt-6 text-xs leading-relaxed text-ink-500">
            The shared password is a single credential with no per-person audit trail. Create a
            named admin account from the operator panel and use that for anything that should name
            who did it.
          </p>
        )}
      </div>
    </main>
  );
}
