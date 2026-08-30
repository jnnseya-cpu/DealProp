import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { currentViewer, viewerAccount } from "@/app/operator/guard";
import { redirect } from "next/navigation";
import { listCreditLots, listLedgerEntries, getSubscription } from "@backend/store/repository";
import { standing } from "@shared/domain/ledger";
import { entitlementsFor } from "@shared/domain/entitlements";
import { CREDIT_PACKS, PLANS, plan } from "@shared/domain/pricing";
import { gbpPrecise } from "@shared/format";
import { Buy } from "./Buy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Billing — Lode" };

/**
 * What this account is on, what it holds, and how to change either.
 *
 * The customer's own view of the same ledger the operator sees, computed the
 * same way — there is no second balance figure that can drift from the first.
 *
 * Prices are rendered from the catalogue, which is the same source the server
 * charges from. A page that renders one price and a server that charges another
 * is a refund and a complaint whichever way round it happens.
 */
export default async function AccountBillingPage() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=/account/billing");
  const account = viewerAccount(viewer);
  if (account === undefined) redirect("/operator?next=/account/billing");

  const [lots, entries, subscription] = await Promise.all([
    listCreditLots(account.id),
    listLedgerEntries(account.id),
    getSubscription(account.id),
  ]);

  const now = new Date();
  const position = standing(lots, entries, now);
  const entitlements = entitlementsFor(subscription, now);
  const current = plan(entitlements.planId);

  const buyerPlans = PLANS.filter((p) => p.audience === "buyer" && p.price > 0);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/invest" className="transition hover:text-ink-100">Buy Boxes</Link>
            <Link href="/account/billing" className="text-ink-100">Billing</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Billing
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100">
          {current?.name ?? "Free"}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">{entitlements.reason}</p>

        <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Prepaid balance" value={gbpPrecise(position.available)} />
          <Stat
            label="Memoranda this period"
            value={entitlements.memorandaPerPeriod === 0 ? "None included" : `${entitlements.memorandaPerPeriod}`}
          />
          <Stat
            label="Buy Boxes"
            value={entitlements.maxBuyBoxes === "unlimited" ? "Unlimited" : `${entitlements.maxBuyBoxes}`}
          />
        </dl>

        {!position.maySpend && (
          <p className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 px-6 py-5 text-sm leading-relaxed text-red-200">
            {position.reason}
          </p>
        )}

        <section className="mt-10 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
            Top up
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
            Prepaid balance is held in pounds, so repricing an operation reprices it for everybody at
            once rather than changing what your balance is worth. Purchased balance lasts twelve
            months; bonus balance lasts three and cannot be refunded in cash, because it was never
            paid for.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CREDIT_PACKS.map((pack) => (
              <Buy
                key={pack.id}
                label={`£${(pack.balance / 100).toFixed(0)}${pack.bonus > 0 ? ` + £${(pack.bonus / 100).toFixed(0)}` : ""}`}
                price={gbpPrecise(pack.price)}
                body={{ kind: "topup", packId: pack.id }}
              />
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
            Plans
          </h2>
          <div className="mt-5 space-y-4">
            {buyerPlans.map((p) => (
              <div key={p.id} className="rounded-xl border hairline px-4 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="text-sm text-ink-100">
                    {p.name}
                    {p.id === entitlements.planId && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
                        current
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-ink-400">
                    {gbpPrecise(p.price)} a month {p.statedAs === "inclusive" ? "inc. VAT" : "+ VAT"}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{p.summary}</p>
                {p.id !== entitlements.planId && (
                  <div className="mt-3">
                    <Buy label={`Move to ${p.name}`} price={gbpPrecise(p.price)} body={{ kind: "plan", planId: p.id }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-ink-500">
          Consumer prices include VAT. You have 14 days to cancel a new subscription; if you ask us
          to start straight away you keep that right only for the part not yet supplied, and we will
          tell you so before you agree.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border hairline bg-ink-900/40 px-5 py-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</dt>
      <dd className="mt-2 font-display text-2xl text-ink-100">{value}</dd>
    </div>
  );
}
