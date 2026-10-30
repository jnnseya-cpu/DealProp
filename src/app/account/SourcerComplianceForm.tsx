"use client";

import { useActionState } from "react";
import { REDRESS_SCHEME_LABELS, type RedressScheme, type SourcerCompliance } from "@shared/domain/accounts";
import { setSourcerCompliance } from "./actions";

/**
 * A flipper records their own deal-sourcing compliance.
 *
 * Shown only to a flipper-capable account (buyer + seller). Sourcing a deal and
 * assigning it on for a margin is the sourcer's own regulated act, so this
 * records — in their own name — the two things that make it lawful: an HMRC
 * anti-money-laundering registration and a redress-scheme membership. It
 * captures evidence with a reference and a date, never a bare "I'm compliant"
 * tick; the server lapses the AML registration after a year regardless.
 */
export function SourcerComplianceForm({ compliance }: { compliance: SourcerCompliance | undefined }) {
  const [result, submit, pending] = useActionState<
    { ok: boolean; message: string } | undefined,
    FormData
  >(setSourcerCompliance, undefined);

  const schemes = Object.keys(REDRESS_SCHEME_LABELS) as RedressScheme[];

  return (
    <form action={submit} className="mt-4 space-y-3 border-t hairline pt-4">
      <p className="eyebrow">Record your sourcing compliance</p>
      <label className="block text-[13px] text-ink-300">
        HMRC AML registration number
        <input
          type="text"
          name="amlRegistration"
          defaultValue={compliance?.amlRegistration ?? ""}
          required
          maxLength={60}
          className="mt-1 h-9 w-full rounded-md border hairline bg-surface-2 px-2.5 text-sm text-ink-100 outline-none focus:border-ink-500"
        />
      </label>
      <label className="block text-[13px] text-ink-300">
        Last confirmed on
        <input
          type="date"
          name="amlConfirmedAt"
          defaultValue={compliance?.amlConfirmedAt ?? ""}
          required
          className="mt-1 h-9 w-full rounded-md border hairline bg-surface-2 px-2.5 text-sm text-ink-100 outline-none focus:border-ink-500"
        />
      </label>
      <label className="block text-[13px] text-ink-300">
        Redress scheme
        <select
          name="redressScheme"
          defaultValue={compliance?.redressScheme ?? schemes[0]}
          className="mt-1 h-9 w-full rounded-md border hairline bg-surface-2 px-2 text-sm text-ink-100 outline-none focus:border-ink-500"
        >
          {schemes.map((s) => (
            <option key={s} value={s}>
              {REDRESS_SCHEME_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[13px] text-ink-300">
        Redress membership reference
        <input
          type="text"
          name="redressMembership"
          defaultValue={compliance?.redressMembership ?? ""}
          required
          maxLength={60}
          className="mt-1 h-9 w-full rounded-md border hairline bg-surface-2 px-2.5 text-sm text-ink-100 outline-none focus:border-ink-500"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] font-medium text-ink-100 transition-colors hover:bg-surface-3 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {result !== undefined && (
          <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
            {result.message}
          </span>
        )}
      </div>
    </form>
  );
}
