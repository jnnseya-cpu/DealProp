import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set a new password — Lode",
  description: "Choose a new password for your Lode account.",
};

/**
 * Set-a-new-password page, reached from the emailed reset link.
 *
 * The token and address ride in the query and are only a convenience for the
 * hidden fields; the server re-reads and re-checks them, so a tampered or
 * stale link cannot reset anyone's password — it fails the token check. A link
 * with no token at all sends the person back to request a fresh one.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token: rawToken, email: rawEmail } = await searchParams;
  const token = (rawToken ?? "").trim();
  const email = (rawEmail ?? "").trim().toLowerCase();

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-md" />

      <div className="mx-auto max-w-md px-6 py-16">
        <p className="eyebrow">Set a new password</p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
          Choose a new password
        </h1>

        {token === "" || email === "" ? (
          <div className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-6">
            <p className="text-sm leading-relaxed text-ink-300">
              This reset link is incomplete or has already been used.
            </p>
            <p className="mt-3 text-sm text-ink-400">
              <Link href="/forgot" className="text-lode-300 underline-offset-2 hover:underline">
                Request a new reset link
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm leading-relaxed text-ink-300">
              Set a new password for <span className="text-ink-100">{email}</span>. You&apos;ll be
              signed in straight after.
            </p>
            <div className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
              <ResetForm token={token} email={email} />
            </div>
          </>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}
