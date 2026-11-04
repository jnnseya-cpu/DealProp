import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { ForgotForm } from "./ForgotForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reset your password — Lode",
  description: "Request a link to reset your Lode password.",
};

/**
 * "Forgot my password" request page.
 *
 * Enter the address; if it has an account, a single-use reset link is emailed.
 * The page never confirms whether the address exists, so it cannot be used to
 * enumerate accounts.
 */
export default function ForgotPage() {
  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-md" />

      <div className="mx-auto max-w-md px-6 py-16">
        <p className="eyebrow">Reset your password</p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
          Forgotten your password?
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          Enter the email address on your account and we&apos;ll send a link to set a new password.
          The link lasts an hour and can be used once.
        </p>

        <div className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <ForgotForm />
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          Remembered it?{" "}
          <Link href="/operator" className="text-lode-300 underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
