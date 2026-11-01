"use client";

import { useActionState } from "react";
import { takeOnListingAction, type OpenResult } from "./actions";

/**
 * A reseller takes on a listing the owner has opened to partners.
 *
 * Shown only where the owner authorised reselling. It works entirely from the
 * closed-shape card — no seller data reaches it. If the viewer may resell, it
 * takes their agreed fee and records the engagement; if they are blocked, it
 * says exactly why (their own AML/redress); if a partner already has it, it says
 * so rather than letting two market the same property.
 */
export function ResellerPanel({
  dealId,
  allowed,
  reason,
  terms,
  takenByOther,
  mine,
}: {
  dealId: string;
  allowed: boolean;
  reason: string;
  terms: string;
  takenByOther: boolean;
  /** The reseller's own agreed fee, in whole pounds, where they hold it. */
  mine?: number;
}) {
  const [result, submit, pending] = useActionState<OpenResult | undefined, FormData>(
    takeOnListingAction,
    undefined,
  );

  return (
    <section className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <p className="eyebrow">Market this listing</p>

      {mine !== undefined ? (
        <p className="mt-2 border-l-2 border-emerald-500/80 pl-3 text-[13px] leading-relaxed text-ink-200">
          You have taken this on. Your fee on the onward sale is £{mine.toLocaleString("en-GB")}, and
          Lode&rsquo;s cut is {terms}.
        </p>
      ) : takenByOther ? (
        <p className="mt-2 border-l-2 border-ink-600 pl-3 text-[13px] leading-relaxed text-ink-400">
          Another partner is already marketing this listing.
        </p>
      ) : allowed ? (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
            The owner has opened this to partners. Market it to your own buyer for your own fee —
            Lode&rsquo;s cut is {terms}.
          </p>
          <form action={submit} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="dealId" value={dealId} />
            <input
              name="feeAgreed"
              inputMode="numeric"
              placeholder="Your fee, e.g. £8,000"
              className="h-9 min-w-0 flex-1 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-100 placeholder:text-ink-500 outline-none focus:border-lode-500/60"
            />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-9 shrink-0 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500 disabled:opacity-50"
            >
              {pending ? "Taking it on…" : "Take it on"}
            </button>
          </form>
          {result !== undefined && (
            <p className={`mt-2 text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
              {result.message}
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 border-l-2 border-amber-500/80 pl-3 text-[13px] leading-relaxed text-amber-200">
          {reason}
        </p>
      )}
    </section>
  );
}
