import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { requirePermission } from "@/app/operator/guard";
import { listAccounts, listCreditLots, listLedgerEntries, listSubscriptions } from "@backend/store/repository";
import { entitlementsFor } from "@shared/domain/entitlements";
import { standing } from "@shared/domain/ledger";
import { plan } from "@shared/domain/pricing";
import { gbpPrecise } from "@shared/format";
import { add } from "@shared/money";

export const dynamic = "force-dynamic";

export const metadata = { title: "Billing — Lode" };

/**
 * Every account's money position, from the ledger rather than from a summary.
 *
 * The point of this page is reconciliation. A prepaid balance loses money in
 * ways that are individually small and collectively invisible — a chargeback
 * against balance already spent, a subscription whose period lapsed with no
 * renewal, a lot that expired unnoticed — and none of them announce themselves.
 * A discrepancy nobody can see is a discrepancy nobody fixes.
 *
 * Balances are computed here from the lots, the same way the spend path
 * computes them. A second, stored "balance" figure would be a number that can
 * drift from the ledger, and the one that drifts is always the one on screen.
 */
export default async function BillingPage() {
  // Financial records are evidence, like the audit trail, and gated the same
  // way: administrators only.
  await requirePermission("view-audit-log", "/operator/billing");

  const now = new Date();
  const [accounts, subscriptions] = await Promise.all([listAccounts(), listSubscriptions()]);

  const rows = await Promise.all(
    accounts.map(async (account) => {
      const [lots, entries] = await Promise.all([
        listCreditLots(account.id),
        listLedgerEntries(account.id),
      ]);
      const subscription = subscriptions.find((s) => s.accountId === account.id);
      return {
        account,
        subscription,
        entitlements: entitlementsFor(subscription, now),
        position: standing(lots, entries, now),
        lots,
        entries,
      };
    }),
  );

  const owing = rows.filter((r) => r.position.owed > 0);
  // add() keeps the branded type rather than a cast: the brand exists to catch
  // exactly this, and suppressing it here would be suppressing it everywhere.
  const held = add(...rows.map((r) => r.position.available));
  const paying = rows.filter((r) => r.entitlements.planId !== "buyer-explorer");

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href="/operator/billing" className="text-ink-100">Billing</Link>
            <Link href="/operator/audit" className="transition hover:text-ink-100">Audit</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Billing
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100">
          {rows.length === 0 ? "No accounts yet" : `${paying.length} of ${rows.length} on a paid plan`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Balances are computed from the ledger on every render, not stored. Prepaid balance is a
          liability until it is spent or expires — the total below is what is owed in service, not
          revenue.
        </p>

        <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Balance outstanding" value={gbpPrecise(held)} />
          <Stat label="On a paid plan" value={`${paying.length}`} />
          <Stat
            label="Owing after a reversal"
            value={`${owing.length}`}
            tone={owing.length > 0 ? "text-red-300" : "text-emerald-300"}
          />
        </dl>

        {owing.length > 0 && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 px-6 py-5">
            <p className="text-sm leading-relaxed text-red-200">
              {owing.length} account{owing.length === 1 ? " has" : "s have"} had a payment reversed
              after the balance was used. Spending is suspended on{" "}
              {owing.length === 1 ? "it" : "them"} until settled — service was delivered and the
              money taken back.
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-ink-900/40 px-6 py-8 text-sm text-ink-400">
            No accounts exist yet, so there is nothing to bill. Create one at{" "}
            <Link href="/operator/accounts" className="text-lode-200 underline">
              /operator/accounts
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-10 space-y-5">
            {rows.map(({ account, subscription, entitlements, position, lots, entries }) => (
              <li key={account.id} className="rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="font-display text-lg text-ink-100">{account.name}</p>
                  <p className="font-mono text-xs text-ink-400">
                    <span className={position.maySpend ? "text-ink-300" : "text-red-300"}>
                      {gbpPrecise(position.available)} available
                    </span>
                    <span className="text-ink-600"> · </span>
                    {plan(entitlements.planId)?.name ?? entitlements.planId}
                    <span className="text-ink-600"> · </span>
                    {entitlements.status}
                  </p>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-ink-300">{entitlements.reason}</p>
                {!position.maySpend && (
                  <p className="mt-2 text-sm leading-relaxed text-red-300">{position.reason}</p>
                )}

                <p className="mt-4 font-mono text-[11px] text-ink-600">
                  {lots.length} lot{lots.length === 1 ? "" : "s"} · {entries.length} ledger entr
                  {entries.length === 1 ? "y" : "ies"}
                  {subscription?.currentPeriodEnd !== undefined &&
                    ` · period ends ${subscription.currentPeriodEnd.slice(0, 10)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border hairline bg-ink-900/40 px-5 py-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</dt>
      <dd className={`mt-2 font-display text-2xl ${tone ?? "text-ink-100"}`}>{value}</dd>
    </div>
  );
}
