"use client";

import { useActionState } from "react";
import {
  makePayoutAction,
  recordRecipientAction,
  suspendRecipientAction,
  type ActionResult,
} from "./actions";
import { PROVIDER_COMMISSIONS } from "@shared/domain/pricing";

const FIELD = "mt-2 w-full px-3 py-2";
const SUBMIT =
  "mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300";

function Status({ result }: { result: ActionResult | undefined }) {
  if (result === undefined) return null;
  return (
    <p
      role="status"
      className={`mt-2.5 text-[13px] leading-[1.6] ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
    >
      {result.message}
    </p>
  );
}

export function RecipientForm() {
  const [result, submit, pending] = useActionState<ActionResult | undefined, FormData>(
    recordRecipientAction,
    undefined,
  );

  return (
    <form action={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="eyebrow">Who they are</label>
          <input id="name" name="name" required placeholder="The firm, named" className={FIELD} />
        </div>
        <div>
          <label htmlFor="kind" className="eyebrow">What they are</label>
          <select id="kind" name="kind" required defaultValue="provider" className={FIELD}>
            <option value="provider">Service provider</option>
            <option value="estate-agent">Estate agent</option>
            <option value="introducer">Introducer</option>
          </select>
        </div>
        <div>
          <label htmlFor="connectedAccountId" className="eyebrow">Connected account</label>
          <input
            id="connectedAccountId"
            name="connectedAccountId"
            required
            placeholder="acct_…"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="evidence" className="eyebrow">What was checked</label>
          <input
            id="evidence"
            name="evidence"
            required
            placeholder="Company number, and that the bank account is theirs"
            className={FIELD}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record them as payable"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function SuspendForm({ id, name }: { id: string; name: string }) {
  const [result, submit, pending] = useActionState<ActionResult | undefined, FormData>(
    suspendRecipientAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="reason"
        required
        placeholder={`Why payouts to ${name} are stopping`}
        className="min-w-0 flex-1 px-3 py-1.5 text-[13px]"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "Stopping…" : "Suspend"}
      </button>
      <Status result={result} />
    </form>
  );
}

/**
 * Pay a share.
 *
 * The form names the recipient, what it is a share of, and what the customer
 * actually paid. It never names what the recipient gets — that comes from the
 * commission catalogue on the server, so a form that could post an amount
 * could not have changed what was sent.
 */
export function PayoutForm({ recipients }: { recipients: readonly { id: string; name: string }[] }) {
  const [result, submit, pending] = useActionState<ActionResult | undefined, FormData>(
    makePayoutAction,
    undefined,
  );

  return (
    <form action={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="recipientId" className="eyebrow">Who is owed</label>
          <select id="recipientId" name="recipientId" required defaultValue="" className={FIELD}>
            <option value="" disabled>Choose</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="providerKind" className="eyebrow">The engagement</label>
          <select id="providerKind" name="providerKind" required defaultValue="" className={FIELD}>
            <option value="" disabled>Choose</option>
            {PROVIDER_COMMISSIONS.map((c) => (
              <option key={c.kind} value={c.kind}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sourceReference" className="eyebrow">What it is a share of</label>
          <input
            id="sourceReference"
            name="sourceReference"
            required
            placeholder="The deal reference, or the payment"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="gross" className="eyebrow">What the customer paid (£)</label>
          <input id="gross" name="gross" inputMode="decimal" required placeholder="1000" className={FIELD} />
        </div>
        <div>
          <label htmlFor="collectedAt" className="eyebrow">When it was collected</label>
          <input id="collectedAt" name="collectedAt" type="date" required className={FIELD} />
        </div>
      </div>

      {/*
        Asked rather than assumed. Nothing here reconciles against the
        provider's dispute list yet, so the answer has to be somebody's rather
        than a default — and the default this platform would pick is the
        dangerous one.
      */}
      <div className="mt-3 space-y-2">
        <label className="flex items-start gap-2.5 text-[13px] leading-[1.6] text-ink-300">
          <input type="checkbox" name="reversalOutstanding" className="mt-1" />
          A dispute or chargeback against this payment is outstanding
        </label>
        <label className="flex items-start gap-2.5 text-[13px] leading-[1.6] text-ink-300">
          <input type="checkbox" name="sourceRefunded" className="mt-1" />
          This payment has been refunded, in whole or in part
        </label>
      </div>

      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Sending…" : "Pay the share"}
      </button>
      <Status result={result} />
    </form>
  );
}
