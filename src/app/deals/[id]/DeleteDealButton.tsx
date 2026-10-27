"use client";

import { useActionState } from "react";
import { deleteDealAction } from "./deal-actions";

const INIT = { ok: false, message: "" };

/**
 * Permanently delete this deal, behind a typed-reference confirmation.
 *
 * Collapsed by default so it is out of the way, and the reference must be typed
 * before the button does anything — deletion cannot be undone, so it should not
 * be a single stray tap.
 */
export function DeleteDealButton({ id, reference }: { id: string; reference: string }) {
  const [state, action, pending] = useActionState(deleteDealAction, INIT);

  return (
    <details className="mt-10 rounded-xl border border-red-500/25 bg-red-500/[0.03] px-5 py-4">
      <summary className="cursor-pointer text-sm text-red-300/90">Delete this deal</summary>
      <form action={action} className="mt-3">
        <input type="hidden" name="id" value={id} />
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-400">
          This permanently removes the deal and cannot be undone. Type the reference{" "}
          <span className="font-mono text-ink-200">{reference}</span> to confirm.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <input
            name="confirm"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={reference}
            className="rounded-md border hairline bg-surface-1 px-2.5 py-1.5 font-mono text-sm uppercase tracking-wide text-ink-100"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-8 items-center rounded-md border border-red-500/40 bg-red-500/10 px-3 text-[13px] font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
        {state.message !== "" && <p className="mt-2 text-[12px] text-red-300">{state.message}</p>}
      </form>
    </details>
  );
}
