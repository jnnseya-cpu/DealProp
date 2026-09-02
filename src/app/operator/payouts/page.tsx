import Link from "next/link";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { listPayoutRecipients, listPayouts } from "@backend/store/repository";
import {
  PAYOUT_HOLD_DAYS,
  recipientIsPayable,
  RECIPIENT_VERIFICATION_MONTHS,
} from "@shared/domain/payouts";
import { gbp } from "@shared/format";
import { add, ZERO } from "@shared/money";
import { PayoutForm, RecipientForm, SuspendForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payouts — Lode" };

/**
 * Money going out.
 *
 * Deliberately the most obstructive screen on the platform. A wrong payment in
 * can be refunded; a wrong payment out is gone, and by the time anybody
 * notices it is somebody else's money in somebody else's account.
 *
 * Three things it will not let happen: paying an account nobody checked,
 * paying a share of money that might still be charged back, and paying the
 * same share twice. The last is held by the store rather than by this page.
 */
export default async function PayoutsPage() {
  await requirePermission("view-audit-log", "/operator/payouts");

  const now = new Date();
  const [recipients, payouts] = await Promise.all([listPayoutRecipients(), listPayouts()]);

  const payable = recipients.filter((r) => recipientIsPayable(r, now));
  const settled = payouts.filter((p) => p.settledAt !== undefined);
  const failed = payouts.filter((p) => p.failedAt !== undefined);
  const sent = add(...settled.map((p) => p.amount), ZERO);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        back="/operator"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/operator/billing" className="transition-colors hover:text-ink-100">Billing</Link>
            <Link href="/operator/audit" className="transition-colors hover:text-ink-100">Audit</Link>
            <Link href="/operator/conduct" className="transition-colors hover:text-ink-100">Conduct</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow">Payouts</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {gbp(sent)} sent, {payable.length} recipient{payable.length === 1 ? "" : "s"} payable
        </h1>
        <p className="mt-4 max-w-[38rem] text-[14px] leading-[1.6] text-ink-400">
          A share of money we collected on somebody else&rsquo;s behalf. Held for{" "}
          {PAYOUT_HOLD_DAYS} days — exactly the buyer&rsquo;s own refund window, because paying out
          before that expires is paying out money we have promised to give back — and blocked
          entirely while any dispute is outstanding, since a share paid on money that is later
          charged back loses the whole amount rather than the commission.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-6 border-y hairline py-6">
          <Stat label="Sent" value={gbp(sent)} size="sm" />
          <Stat label="Recipients payable" value={`${payable.length} of ${recipients.length}`} size="sm" />
          <Stat
            label="Failed"
            value={String(failed.length)}
            size="sm"
            tone={failed.length > 0 ? "text-amber-300" : "text-ink-300"}
          />
        </div>

        <Panel className="mt-8" eyebrow="Who may be paid" title="Recipients">
          {recipients.length === 0 ? (
            <p className="text-[13px] leading-[1.65] text-ink-400">
              Nobody is recorded. Nothing can be paid out, which is the correct state until
              somebody has been checked.
            </p>
          ) : (
            <ul className="space-y-4">
              {recipients.map((recipient) => {
                const ok = recipientIsPayable(recipient, now);
                return (
                  <li key={recipient.id} className="border-b hairline pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-[14px] text-ink-100">{recipient.name}</span>
                      <Badge tone={ok ? "good" : "warn"}>
                        {recipient.suspendedAt !== undefined
                          ? "Suspended"
                          : ok
                            ? "Payable"
                            : "Not verified"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-500">
                      {recipient.kind.replace(/-/g, " ")} · {recipient.connectedAccountId ?? "no account"}
                    </p>
                    {recipient.verificationEvidence !== undefined && (
                      <p className="mt-1 text-[13px] leading-[1.6] text-ink-400">
                        {recipient.verificationEvidence}
                        <span className="mt-0.5 block font-mono text-[11px] text-ink-600">
                          {recipient.verifiedBy} · {recipient.verifiedAt?.slice(0, 10)} · stands for{" "}
                          {RECIPIENT_VERIFICATION_MONTHS} months
                        </span>
                      </p>
                    )}
                    {recipient.suspendedAt === undefined ? (
                      <SuspendForm id={recipient.id} name={recipient.name} />
                    ) : (
                      <p className="mt-2 text-[13px] leading-[1.6] text-amber-300">
                        Stopped {recipient.suspendedAt.slice(0, 10)} — {recipient.suspendedReason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 border-t hairline pt-5">
            <RecipientForm />
          </div>
        </Panel>

        {payable.length > 0 && (
          <Panel className="mt-6" eyebrow="Send a share" title="Pay what is owed">
            <p className="text-[13px] leading-[1.65] text-ink-300">
              Name what the customer paid; the recipient&rsquo;s share comes from the commission
              catalogue on the server. There is no field for the amount they receive, so there is
              nothing here for anybody to change.
            </p>
            <div className="mt-4 border-t hairline pt-4">
              <PayoutForm recipients={payable.map((r) => ({ id: r.id, name: r.name }))} />
            </div>
          </Panel>
        )}

        {payouts.length > 0 && (
          <Panel className="mt-6" eyebrow="What has moved" title={`${payouts.length} recorded`}>
            <ul className="space-y-4">
              {payouts.map((payout) => (
                <li key={payout.id} className="border-b hairline pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="text-[14px] text-ink-100">{payout.sourceReference}</span>
                    <span
                      className={`tnum text-[14px] ${payout.settledAt !== undefined ? "text-ink-100" : "text-ink-500"}`}
                    >
                      {gbp(payout.amount)} of {gbp(payout.gross)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.6] text-ink-400">{payout.basis}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-600">
                    {payout.authorisedBy} · {payout.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                    {payout.settledAt !== undefined
                      ? `sent, ${payout.transferReference ?? ""}`
                      : payout.failedAt !== undefined
                        ? "failed"
                        : "in flight"}
                  </p>
                  {payout.failureReason !== undefined && (
                    <p className="mt-1 text-[13px] leading-[1.6] text-amber-300">
                      {payout.failureReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </main>
  );
}
