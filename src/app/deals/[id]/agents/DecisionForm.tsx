"use client";

import { useActionState } from "react";
import { decideProposalAction, type DecisionResult } from "./actions";

/**
 * Accept or dismiss one proposal, with a reason.
 *
 * The reason is required, not encouraged. Everything on this board will be read
 * later by somebody who was not in the room — an underwriter's file, a funder's
 * question, a complaint — and "accepted" on its own answers none of it.
 */
export function DecisionForm({
  dealId,
  proposalKey,
  acceptLabel,
}: {
  dealId: string;
  proposalKey: string;
  acceptLabel: string;
}) {
  const [result, submit, pending] = useActionState<DecisionResult | undefined, FormData>(
    decideProposalAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-4 border-t hairline pt-4">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="proposalKey" value={proposalKey} />

      <label
        htmlFor={`note-${proposalKey}`}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-500"
      >
        Your reason
      </label>
      <textarea
        id={`note-${proposalKey}`}
        name="note"
        rows={2}
        required
        placeholder="What you checked, and what you concluded."
        className="mt-2 w-full rounded-lg border hairline bg-ink-950/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-lode-500 focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="accepted"
          disabled={pending}
          className="rounded-lg bg-lode-500 px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-lode-400 disabled:opacity-50"
        >
          {pending ? "Recording…" : acceptLabel}
        </button>
        <button
          type="submit"
          name="decision"
          value="dismissed"
          disabled={pending}
          className="rounded-lg border hairline px-4 py-2 text-sm text-ink-300 transition hover:text-ink-100 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {result !== undefined && (
        <p
          className={`mt-3 text-sm leading-relaxed ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
