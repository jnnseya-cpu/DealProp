"use client";

import { useActionState } from "react";
import { startDealFromLead } from "./actions";
import type { SourcedLead } from "@shared/domain/sourcedLead";

const INIT = { ok: false, message: "" };

const TYPES = [
  { value: "house", label: "House" },
  { value: "flat", label: "Flat" },
  { value: "bungalow", label: "Bungalow" },
  { value: "hmo", label: "HMO" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed-use", label: "Mixed use" },
  { value: "land", label: "Land" },
];

const JURISDICTIONS = [
  { value: "GB-ENG", label: "England" },
  { value: "GB-WLS", label: "Wales" },
  { value: "GB-SCT", label: "Scotland" },
  { value: "GB-NIR", label: "Northern Ireland" },
];

/**
 * Turn a probate lead into a deal without re-keying the address.
 *
 * The lead already holds the property; the operator supplies the one figure
 * that cannot be guessed — an estimated value — and picks the type, and the
 * action creates the deal and lands on the seller-checks step (the grant of
 * probate). Everything else defaults and is refined on the deal.
 */
export function StartDealForm({ lead }: { lead: SourcedLead }) {
  const [state, action, pending] = useActionState(startDealFromLead, INIT);

  return (
    <details className="mt-3 rounded-lg border hairline bg-surface-2">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-ink-200">
        Start a deal from this lead →
      </summary>
      <form action={action} className="border-t hairline px-4 py-3">
        <input type="hidden" name="postcode" value={lead.postcode ?? ""} />
        <input type="hidden" name="address" value={lead.propertyAddress ?? ""} />
        <input type="hidden" name="subjectName" value={lead.subjectName ?? ""} />
        <input type="hidden" name="contactForService" value={lead.contactForService ?? ""} />

        <p className="text-[13px] leading-relaxed text-ink-400">
          {lead.propertyAddress ?? lead.postcode} — this creates a deal and opens the seller checks
          (the grant of probate comes first).
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-[12px] text-ink-400">
            Estimated value (£)
            <input
              type="number"
              name="estimatedValue"
              min={1}
              required
              placeholder="250000"
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100 tabular-nums"
            />
          </label>
          <label className="text-[12px] text-ink-400">
            Property type
            <select
              name="propertyType"
              defaultValue="house"
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-ink-400">
            Nation
            <select
              name="jurisdiction"
              defaultValue="GB-ENG"
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100"
            >
              {JURISDICTIONS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-[13px] font-medium text-ink-950 transition-colors hover:bg-lode-300 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create deal & verify →"}
        </button>

        {state.message !== "" && (
          <p className="mt-2 text-[12px] text-red-300">{state.message}</p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-ink-500">
          You can refine the figures on the deal. The value is required because the score is
          meaningless without a real one.
        </p>
      </form>
    </details>
  );
}
