"use client";

import { useActionState } from "react";
import { raiseFeeAction, recordDisclosureAction, voidFeeAction, type FeeResult } from "./actions";

function Status({ result }: { result: FeeResult | undefined }) {
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

/** What the seller was told, recorded before anybody is bound by it. */
export function DisclosureForm({ dealId, current }: { dealId: string; current?: string }) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    recordDisclosureAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <label htmlFor="wording" className="eyebrow">
        The words the seller was given
      </label>
      <textarea
        id="wording"
        name="wording"
        rows={3}
        required
        defaultValue={current ?? ""}
        placeholder="Our fee is 0.75% of the purchase price, payable by the buyer on completion. You pay us nothing."
        className="mt-2 w-full px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {pending ? "Recording…" : current === undefined ? "Record the disclosure" : "Update it"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function RaiseFeeForm({ dealId, feeKey, label }: { dealId: string; feeKey: string; label: string }) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    raiseFeeAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-3.5 border-t hairline pt-3.5">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="feeKey" value={feeKey} />
      <label htmlFor={`note-${feeKey}`} className="eyebrow">
        Your reason
      </label>
      <input
        id={`note-${feeKey}`}
        name="note"
        required
        placeholder="What was done, and for whom."
        className="mt-2 w-full px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {pending ? "Raising…" : `Raise ${label.toLowerCase()}`}
      </button>
      <Status result={result} />
    </form>
  );
}

export function VoidFeeForm({ dealId, feeId }: { dealId: string; feeId: string }) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    voidFeeAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="feeId" value={feeId} />
      <input
        name="reason"
        required
        placeholder="Why it is being withdrawn"
        className="min-w-0 flex-1 px-3 py-1.5"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "Voiding…" : "Void"}
      </button>
      <Status result={result} />
    </form>
  );
}
