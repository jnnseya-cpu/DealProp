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
    <form action={submit} className="mt-3.5 border-t hairline pt-3.5">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="proposalKey" value={proposalKey} />

      <label
        htmlFor={`note-${proposalKey}`}
        className="eyebrow"
      >
        Your reason
      </label>
      <textarea
        id={`note-${proposalKey}`}
        name="note"
        rows={2}
        required
        placeholder="What you checked, and what you concluded."
        className="mt-2 w-full px-3 py-2"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="accepted"
          disabled={pending}
          className="inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
        >
          {pending ? "Recording…" : acceptLabel}
        </button>
        <button
          type="submit"
          name="decision"
          value="dismissed"
          disabled={pending}
          className="inline-flex h-9 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
        >
          Dismiss
        </button>
      </div>

      {result !== undefined && (
        <p
          className={`mt-3 text-[13px] leading-[1.6] ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
