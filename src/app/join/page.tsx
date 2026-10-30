import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { JoinForm } from "./JoinForm";
import type { Role } from "@shared/domain/accounts";
import { SELF_SERVICE_ROLES } from "@shared/domain/accounts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create your account — Lode",
  description: "Sign up to Lode as a seller, buyer, sourcer / flipper, lender or agent.",
};

/**
 * Public self-service sign-up.
 *
 * The door the marketing funnel was missing: a seller, investor, capital
 * provider or agent lands here from the site and creates their own account,
 * rather than needing an operator to make one by hand. The role they pick is
 * validated again on the server against `SELF_SERVICE_ROLES` — a staff role can
 * never be claimed here. A `?role=` hint lets a CTA deep-link the right choice.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role: rawRole } = await searchParams;
  const configured = (process.env.OPERATOR_SECRET ?? "") !== "";
  const defaultRole: Role | undefined = SELF_SERVICE_ROLES.find((r) => r === rawRole);

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-md" />

      <div className="mx-auto max-w-md px-6 py-16">
        <p className="eyebrow">Create your account</p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
          Join Lode
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          One account per person, free to open — sign up as whatever you are: seller, buyer, sourcer /
          flipper, lender, or agent &amp; auctioneer. Selling is free. Buyers and lenders certify before
          deal material unlocks.
        </p>

        <div className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          {configured ? (
            <JoinForm {...(defaultRole !== undefined ? { defaultRole } : {})} />
          ) : (
            <div role="status">
              <p className="text-sm text-ink-100">Sign-up is not configured.</p>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">
                Set <code className="text-lode-300">OPERATOR_SECRET</code> in the environment and
                restart. Until then this refuses rather than creating an account nobody can sign
                in to.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          Already have an account?{" "}
          <Link href="/operator" className="text-lode-300 underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
