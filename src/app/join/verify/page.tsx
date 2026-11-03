import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { VerifyForm } from "./VerifyForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify your email — Lode",
  description: "Enter the code we emailed to finish creating your Lode account.",
};

/**
 * Email-verification step, reached straight after sign-up.
 *
 * Sign-up creates the account unverified and redirects here with the address in
 * the query, so the person lands on a code box rather than being signed in. The
 * address is only a convenience for the hidden field; the server re-reads and
 * re-checks it, so a tampered `?email=` cannot verify anyone else's account —
 * it would simply fail the code check.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email: rawEmail } = await searchParams;
  const email = (rawEmail ?? "").trim().toLowerCase();

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-md" />

      <div className="mx-auto max-w-md px-6 py-16">
        <p className="eyebrow">One more step</p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
          Verify your email
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          We sent a six-digit code to the address you signed up with. Enter it below to activate your
          account and sign in. This is a one-time check — we will not ask for a code when you sign in
          later.
        </p>

        <div className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <VerifyForm email={email} />
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-400">
          Didn&apos;t get it? Check your spam folder. If the code has expired you can{" "}
          <Link href="/join" className="text-lode-300 underline-offset-2 hover:underline">
            sign up again
          </Link>
          .
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
