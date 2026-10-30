"use client";

import { useActionState } from "react";
import { restoreAllContactedAction, restoreContactedLeadAction } from "./actions";
import { StartDealForm } from "./StartDealForm";
import type { LeadSignal, SourcedLead } from "@shared/domain/sourcedLead";

/**
 * The leads already written to, kept out of the search results but shown here so
 * the suppression is never a one-way door.
 *
 * A letter opened to review and then not posted must not hide a property for
 * good, so every contacted lead can be restored — one click, and it surfaces
 * again on the next run. The row deliberately shows only what is needed to
 * recognise it: a label, the property address where one is held, or the public
 * notice to open. Nothing about the person is stored, so nothing about the
 * person is shown.
 */
export interface ContactedRow {
  readonly key: string;
  readonly signalKey: LeadSignal;
  readonly contactedAt: string;
  readonly by: string;
  /** A human label for the kind of lead. */
  readonly title: string;
  /** The property address, where the worklist still holds it. */
  readonly address?: string;
  /** The public notice URL, where the key is one (probate / insolvency). */
  readonly noticeUrl?: string;
  /**
   * The stored lead, where it is warehoused (prepared-but-unsold). Present means
   * a deal can be started from it here, even though it is suppressed from search.
   */
  readonly lead?: SourcedLead;
}

export function ContactedLeads({ items }: { items: readonly ContactedRow[] }) {
  return (
    <>
      <RestoreAllForm count={items.length} />
      <ul className="mt-4 space-y-3">
      {items.map((row) => (
        <li key={row.key} className="rounded-2xl border hairline bg-surface-1 px-5 py-3">
         <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="min-w-0">
            <p className="text-sm text-ink-200">{row.title}</p>
            {row.address !== undefined && (
              <p className="mt-0.5 text-sm font-medium text-ink-100">{row.address}</p>
            )}
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-600">
              written {row.contactedAt.slice(0, 10)} · by {row.by}
              {row.noticeUrl !== undefined && (
                <>
                  {" · "}
                  <a
                    href={row.noticeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lode-300 underline-offset-2 hover:underline"
                  >
                    open the notice →
                  </a>
                </>
              )}
            </p>
          </div>
          <RestoreForm leadKey={row.key} />
         </div>
          {row.lead !== undefined && <StartDealForm lead={row.lead} />}
        </li>
      ))}
      </ul>
    </>
  );
}

/** Clear every suppression — the clean-slate reset before a print run. */
function RestoreAllForm({ count }: { count: number }) {
  const [result, submit, pending] = useActionState<{ ok: boolean; message: string } | undefined, FormData>(
    restoreAllContactedAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-xs text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "Restoring…" : `Restore all ${count} (reset)`}
      </button>
      {result !== undefined && (
        <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>{result.message}</span>
      )}
    </form>
  );
}

function RestoreForm({ leadKey }: { leadKey: string }) {
  const [result, submit, pending] = useActionState<{ ok: boolean; message: string } | undefined, FormData>(
    restoreContactedLeadAction,
    undefined,
  );

  return (
    <form action={submit} className="flex items-center gap-2">
      <input type="hidden" name="key" value={leadKey} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "…" : "Restore"}
      </button>
      {result !== undefined && (
        <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>{result.message}</span>
      )}
    </form>
  );
}
