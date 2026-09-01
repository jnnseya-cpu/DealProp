"use client";

import { useActionState } from "react";
import {
  approveCandidateAction,
  suppressCandidateAction,
  type CandidateResult,
} from "./actions";

/**
 * Approve a discovered funder for outreach, or suppress it.
 *
 * Two buttons of equal weight. Approving is not the default action and is not
 * styled as one: it is a decision that it is lawful and appropriate to write to
 * this organisation about somebody's property transaction.
 */
export function CandidateActions({
  candidateId,
  canApprove,
  suppressed,
}: {
  candidateId: string;
  canApprove: boolean;
  suppressed: boolean;
}) {
  const [approve, approveSubmit, approving] = useActionState<CandidateResult | undefined, FormData>(
    approveCandidateAction,
    undefined,
  );
  const [suppress, suppressSubmit, suppressing] = useActionState<
    CandidateResult | undefined,
    FormData
  >(suppressCandidateAction, undefined);

  const result = approve ?? suppress;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        {!suppressed && (
          <form action={approveSubmit}>
            <input type="hidden" name="candidateId" value={candidateId} />
            <button
              type="submit"
              disabled={approving || !canApprove}
              title={canApprove ? undefined : "Only a fully verified candidate may be approved."}
              className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
            >
              {approving ? "Recording…" : "Approve for outreach"}
            </button>
          </form>
        )}

        {!suppressed && (
          <form action={suppressSubmit} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="candidateId" value={candidateId} />
            <label className="sr-only" htmlFor={`reason-${candidateId}`}>
              Reason for suppressing
            </label>
            <input
              id={`reason-${candidateId}`}
              name="reason"
              type="text"
              placeholder="Reason"
              className="rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
            />
            <button
              type="submit"
              disabled={suppressing}
              className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
            >
              {suppressing ? "Recording…" : "Never contact"}
            </button>
          </form>
        )}
      </div>

      {result !== undefined && (
        <p
          className={`mt-3 text-sm leading-relaxed ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
