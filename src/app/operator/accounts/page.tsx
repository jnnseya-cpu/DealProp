import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { requireOperator } from "@/app/operator/guard";
import { certificationStatus, publicAccount, ROLE_LABELS } from "@shared/domain/accounts";
import { listAccounts } from "@backend/store/repository";
import { NewAccountForm } from "./NewAccountForm";
import { AccountControls } from "./AccountControls";

export const dynamic = "force-dynamic";

export const metadata = { title: "Accounts — Lode" };

/**
 * Accounts.
 *
 * The shared operator password can reach this page, because otherwise the first
 * account could never be created. Everything else should be done as a named
 * person — that is the entire point of the audit trail.
 */
export default async function AccountsPage() {
  const viewer = await requireOperator("/operator/accounts");
  const accounts = (await listAccounts()).map(publicAccount);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href="/operator/accounts" className="text-ink-100">Accounts</Link>
            <Link href="/operator/audit" className="transition hover:text-ink-100">Audit</Link>
            <Link href="/operator/conduct" className="transition hover:text-ink-100">Conduct</Link>
            <Link href="/operator/payouts" className="transition hover:text-ink-100">Payouts</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">
          Accounts
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {accounts.length === 0 ? "No accounts yet" : `${accounts.length} accounts`}
        </h1>

        {viewer.kind === "shared-operator" && (
          <p className="mt-6 rounded-lg border-l-2 border-amber-500/80 bg-surface-1 px-5 py-4 text-sm leading-relaxed text-ink-200">
            You are signed in with the shared operator password, so nothing you do appears against a
            name in the audit trail. Create an account for yourself, sign in with it, and stop using
            the shared password.
          </p>
        )}

        <div className="mt-10">
          <NewAccountForm />
        </div>

        {accounts.length > 0 && (
          <div className="mt-10 space-y-3">
            {accounts.map((a) => {
              const status = certificationStatus(a);
              return (
                <div
                  key={a.id}
                  className={`flex flex-wrap items-start justify-between gap-4 rounded-2xl border px-5 py-4 ${
                    a.disabled ? "border-ink-800 bg-ink-950/60" : "hairline bg-surface-1"
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-lg text-ink-100">{a.name}</span>
                      <span className="rounded border border-lode-500/45 bg-lode-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-lode-200">
                        {ROLE_LABELS[a.role]}
                      </span>
                      {a.disabled && (
                        <span className="rounded-md border border-ink-700 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-500">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-400">{a.email}</p>
                    {(a.role === "investor" || a.role === "funder") && (
                      <p
                        className={`mt-2 text-xs leading-relaxed ${
                          status.current ? "text-emerald-300/80" : "text-amber-300/80"
                        }`}
                      >
                        {status.reason}
                      </p>
                    )}
                  </div>
                  <AccountControls id={a.id} disabled={a.disabled} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
