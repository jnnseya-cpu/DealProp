import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Panel, SiteHeader } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import { listCreditLots, listLedgerEntries } from "@backend/store/repository";
import { standing } from "@shared/domain/ledger";
import { gbpPrecise } from "@shared/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payment — Lode" };

/**
 * Where the provider sends somebody after they pay.
 *
 * This page reports the *ledger*, not the payment. That distinction is the
 * whole design: a customer arriving here has finished at the provider, and the
 * confirmation that actually credits them arrives separately at the webhook,
 * usually within a second and occasionally not for a minute. A page that said
 * "paid" from the fact of the redirect would be reading the one signal an
 * attacker fully controls — the URL they were sent to.
 *
 * So it says what the balance is now, and says plainly that a confirmation
 * still to arrive is normal rather than a problem. Nothing here credits
 * anything; there is no code path from this page to the ledger, and there must
 * never be one.
 */
export default async function CompletePage() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Fbilling");
  if (viewer.kind !== "account") redirect("/account/billing");

  const [lots, entries] = await Promise.all([
    listCreditLots(viewer.account.id),
    listLedgerEntries(viewer.account.id),
  ]);
  const position = standing(lots, entries, new Date());

  return (
    <main className="min-h-screen">
      <SiteHeader
        back="/account/billing"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/account/billing" className="transition-colors hover:text-ink-100">
              Billing
            </Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-2xl px-6 py-14">
        <p className="eyebrow">Payment</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Thank you — we are waiting for the confirmation.
        </h1>
        <p className="mt-5 text-[14px] leading-[1.6] text-ink-400">
          You have finished at the payment provider. What credits your account is the confirmation
          the provider sends us directly, and it usually arrives within a second. This page reads
          your balance rather than the fact you were redirected here — the redirect is the one
          thing anybody could fake, so nothing is credited on the strength of it.
        </p>

        <Panel
          className="mt-8"
          eyebrow="Your position"
          title={gbpPrecise(position.available)}
          action={
            <Badge tone={position.maySpend ? "good" : "warn"}>
              {position.maySpend ? "Spendable" : "On hold"}
            </Badge>
          }
        >
          <p className="text-[13px] leading-[1.65] text-ink-300">
            {position.available > 0
              ? "Available now. If you have just topped up and this has not moved, refresh in a moment."
              : "Nothing available yet. If you have just paid, the confirmation is still on its way — refresh in a moment."}
          </p>
          {!position.maySpend && (
            <p className="mt-3 border-l-2 border-amber-500/80 py-1 pl-4 text-[13px] leading-[1.65] text-amber-200">
              A previous payment was reversed and is still outstanding, so spending is on hold until
              it is settled.
            </p>
          )}
          <p className="mt-4 border-t hairline pt-4 text-[13px] leading-[1.6] text-ink-400">
            <Link href="/account/billing" className="text-lode-300 hover:underline">
              Back to billing
            </Link>{" "}
            for your plan, your balance and everything that has moved.
          </p>
        </Panel>
      </div>
    </main>
  );
}
