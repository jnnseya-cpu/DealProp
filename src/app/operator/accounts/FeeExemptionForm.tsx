"use client";

import { useActionState } from "react";
import type { FeeExemption } from "@shared/domain/accounts";
import type { BoxFormResult } from "@shared/formFields";
import { setFeeExemption } from "./actions";

/**
 * An administrator comps an account, or withdraws the comp.
 *
 * Shown only to an admin. A fee-free account pays no membership and no fee and
 * competes at the same level as everyone else — its only privilege is price — so
 * the grant is deliberate and recorded: a reason, an optional expiry, and the
 * admin's own name. Withdrawing it puts the account back on normal pricing.
 */
export function FeeExemptionForm({
  id,
  exemption,
}: {
  id: string;
  exemption: FeeExemption | undefined;
}) {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    setFeeExemption,
    undefined,
  );

  return (
    <div className="mt-3 rounded-xl border hairline bg-surface-2 px-4 py-3">
      <p className="eyebrow">Fee exemption</p>
      {exemption !== undefined ? (
        <p className="mt-2 text-[12px] leading-relaxed text-emerald-300/80">
          Fee-free, granted by {exemption.grantedBy} on {exemption.grantedAt.slice(0, 10)}
          {exemption.expiresAt !== undefined ? ` until ${exemption.expiresAt}` : " (no expiry)"} —
          {" "}{exemption.reason}
        </p>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
          Charged like any other account. Grant a comp only deliberately — it is an economic
          privilege.
        </p>
      )}

      {exemption === undefined ? (
        <form action={submit} className="mt-2.5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="grant" value="yes" />
          <input
            type="text"
            name="reason"
            required
            maxLength={300}
            placeholder="Reason (e.g. Lode house account, launch partner)"
            className="h-8 min-w-0 flex-1 rounded-md border hairline bg-surface-1 px-2.5 text-[13px] text-ink-100 outline-none focus:border-ink-500"
          />
          <input
            type="date"
            name="expiresAt"
            title="Optional expiry"
            className="h-8 shrink-0 rounded-md border hairline bg-surface-1 px-2.5 text-[13px] text-ink-100 outline-none focus:border-ink-500"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-1 px-3 text-[13px] font-medium text-ink-100 transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Grant comp"}
          </button>
          {result !== undefined && (
            <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
              {result.message}
            </span>
          )}
        </form>
      ) : (
        <form action={submit} className="mt-2.5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="grant" value="no" />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-1 px-3 text-[13px] font-medium text-ink-200 transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Withdraw comp"}
          </button>
          {result !== undefined && (
            <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
              {result.message}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
