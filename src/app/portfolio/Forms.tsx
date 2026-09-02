"use client";

import { useActionState } from "react";
import {
  recordFacilityAction,
  recordRentAction,
  recordSaleAction,
  recordValuationAction,
  type HoldingResult,
} from "./actions";

const FIELD = "mt-2 w-full px-3 py-2 text-[13px]";
const SUBMIT =
  "mt-3 inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100";

function Status({ result }: { result: HoldingResult | undefined }) {
  if (result === undefined) return null;
  return (
    <p
      role="status"
      className={`mt-2 text-[12px] leading-[1.55] ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
    >
      {result.message}
    </p>
  );
}

/**
 * Record a valuation.
 *
 * Figure, date and valuer, all three or nothing. Without all three it is an
 * opinion, and the portfolio would present it as evidence — which is exactly
 * the thing every figure downstream inherits.
 */
export function ValuationForm({ dealId }: { dealId: string }) {
  const [result, submit, pending] = useActionState<HoldingResult | undefined, FormData>(
    recordValuationAction,
    undefined,
  );

  return (
    <form action={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`valuation-${dealId}`} className="eyebrow">Valued at (£)</label>
          <input id={`valuation-${dealId}`} name="valuation" inputMode="decimal" required className={FIELD} />
        </div>
        <div>
          <label htmlFor={`valuedAt-${dealId}`} className="eyebrow">On</label>
          <input id={`valuedAt-${dealId}`} name="valuedAt" type="date" required className={FIELD} />
        </div>
        <div>
          <label htmlFor={`valuer-${dealId}`} className="eyebrow">By</label>
          <input id={`valuer-${dealId}`} name="valuer" required placeholder="The firm" className={FIELD} />
        </div>
        <div>
          <label htmlFor={`spent-${dealId}`} className="eyebrow">Spent since (£)</label>
          <input id={`spent-${dealId}`} name="spent" inputMode="decimal" placeholder="0" className={FIELD} />
        </div>
      </div>
      <input type="hidden" name="dealId" value={dealId} />
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the valuation"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function FacilityForm({ dealId }: { dealId: string }) {
  const [result, submit, pending] = useActionState<HoldingResult | undefined, FormData>(
    recordFacilityAction,
    undefined,
  );

  return (
    <form action={submit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`debt-${dealId}`} className="eyebrow">Outstanding (£)</label>
          <input id={`debt-${dealId}`} name="debt" inputMode="decimal" required className={FIELD} />
        </div>
        <div>
          <label htmlFor={`rate-${dealId}`} className="eyebrow">Rate (%)</label>
          <input id={`rate-${dealId}`} name="rate" inputMode="decimal" required className={FIELD} />
        </div>
        <div>
          <label htmlFor={`endsAt-${dealId}`} className="eyebrow">Facility ends</label>
          <input id={`endsAt-${dealId}`} name="endsAt" type="date" className={FIELD} />
        </div>
      </div>
      <input type="hidden" name="dealId" value={dealId} />
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the facility"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function RentForm({ dealId }: { dealId: string }) {
  const [result, submit, pending] = useActionState<HoldingResult | undefined, FormData>(
    recordRentAction,
    undefined,
  );

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`rent-${dealId}`} className="eyebrow">Rent, monthly (£)</label>
        <input id={`rent-${dealId}`} name="rent" inputMode="decimal" required className={FIELD} />
      </div>
      <button type="submit" disabled={pending} className={`${SUBMIT} mt-0`}>
        {pending ? "Saving…" : "Record"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function SaleForm({ dealId }: { dealId: string }) {
  const [result, submit, pending] = useActionState<HoldingResult | undefined, FormData>(
    recordSaleAction,
    undefined,
  );

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`soldAt-${dealId}`} className="eyebrow">Sold on</label>
        <input id={`soldAt-${dealId}`} name="soldAt" type="date" required className={FIELD} />
      </div>
      <button type="submit" disabled={pending} className={`${SUBMIT} mt-0`}>
        {pending ? "Saving…" : "Mark sold"}
      </button>
      <Status result={result} />
    </form>
  );
}
