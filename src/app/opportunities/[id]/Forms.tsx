"use client";

import { useActionState } from "react";
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
 * The payment reference is what makes the write idempotent: the same buyer,
 * the same opportunity and the same payment is one purchase however many times
 * the button is pressed or the provider retries.
 */
export function OpenForm({ dealId, price }: { dealId: string; price: string }) {
  const [result, submit, pending] = useActionState<OpenResult | undefined, FormData>(
    openOpportunityAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-4 border-t hairline pt-4">
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
        className="mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {pending ? "Opening…" : `Open for ${price}`}
      </button>
      <Status result={result} />
    </form>
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
