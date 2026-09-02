"use client";

import { useActionState, useState } from "react";
import { claimRefundAction, openOpportunityAction, type OpenResult } from "./actions";
import { REFUND_REASONS } from "@shared/domain/reveal";

function Status({ result }: { result: OpenResult | undefined }) {
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

/**
 * Open one opportunity.
 *
 * Two paths, and the difference between them matters. The buyer's button goes
 * to checkout: the request names the opportunity, the server quotes it, prices
 * it from the catalogue and hands back somewhere to pay. Nothing is opened
 * here — the confirmation arrives at the webhook, which is the only inbound
 * money path.
 *
 * The reference form below it is the operator's, for a payment taken outside
 * the platform. It is deliberately not the same button: one is a customer
 * buying and the other is somebody recording that money already arrived, and a
 * single control doing both is a control where the second is reachable by the
 * first.
 */
export function OpenForm({ dealId, price }: { dealId: string; price: string }) {
  const [result, submit, pending] = useActionState<OpenResult | undefined, FormData>(
    openOpportunityAction,
    undefined,
  );
  const [checkout, setCheckout] = useState<{ pending: boolean; message?: string }>({
    pending: false,
  });

  async function pay(): Promise<void> {
    setCheckout({ pending: true });
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "reveal", opportunityId: dealId }),
      });
      const body = (await response.json()) as { redirectUrl?: string; reason?: string };
      if (response.ok && typeof body.redirectUrl === "string") {
        window.location.href = body.redirectUrl;
        return;
      }
      setCheckout({
        pending: false,
        message: body.reason ?? `Could not start checkout (${response.status}).`,
      });
    } catch {
      setCheckout({ pending: false, message: "Could not reach the server." });
    }
  }

  return (
    <div className="mt-4 border-t hairline pt-4">
      <button
        type="button"
        onClick={() => void pay()}
        disabled={checkout.pending}
        className="inline-flex h-9.5 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {checkout.pending ? "Starting…" : `Open for ${price}`}
      </button>
      {checkout.message !== undefined && (
        <p role="status" className="mt-2.5 text-[13px] leading-[1.6] text-amber-300">
          {checkout.message}
        </p>
      )}

      <details className="mt-5 border-t hairline pt-4">
        <summary className="cursor-pointer text-[13px] text-ink-500 transition-colors hover:text-ink-300">
          Paid another way? Record the reference
        </summary>
        <form action={submit} className="mt-3">
          <input type="hidden" name="dealId" value={dealId} />
          <label htmlFor="paymentReference" className="eyebrow">
            Payment reference
          </label>
          <input
            id="paymentReference"
            name="paymentReference"
            required
            placeholder="From the payment provider"
            className="mt-2 w-full px-3 py-2"
          />
          <button
            type="submit"
            disabled={pending}
            className="mt-3 inline-flex h-9 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
          >
            {pending ? "Opening…" : "Record it"}
          </button>
          <Status result={result} />
        </form>
      </details>
    </div>
  );
}

/** Claim the fee back. Nobody has to be persuaded — see `decideRefund()`. */
export function RefundForm({ dealId, revealId }: { dealId: string; revealId: string }) {
  const [result, submit, pending] = useActionState<OpenResult | undefined, FormData>(
    claimRefundAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-4 border-t hairline pt-4">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="revealId" value={revealId} />
      <label htmlFor="trigger" className="eyebrow">
        What went wrong
      </label>
      <select id="trigger" name="trigger" required defaultValue="" className="mt-2 w-full px-3 py-2">
        <option value="" disabled>
          Choose a reason
        </option>
        {REFUND_REASONS.map((reason) => (
          <option key={reason.trigger} value={reason.trigger}>
            {reason.label} — {reason.explanation}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex h-9 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "Claiming…" : "Claim the fee back"}
      </button>
      <Status result={result} />
    </form>
  );
}
