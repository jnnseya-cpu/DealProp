"use client";

import { useActionState } from "react";
import { recordOfferAction, type EvidenceResult } from "./actions";

/**
 * Record a lender's terms as received.
 *
 * Every field a comparison needs and every field a lender leads with, so the
 * total can be computed rather than taken on trust. The broker fee is asked for
 * explicitly because it is the one most often left out of a comparison and the
 * one that most often changes the answer.
 */
export function OfferForm({ dealId }: { dealId: string }) {
  const [result, submit, pending] = useActionState<EvidenceResult | undefined, FormData>(
    recordOfferAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Lender" name="lender" required />
        <Field label="Rate % a year" name="annualRate" type="number" step="0.01" required />
        <Field label="LTV %" name="ltv" type="number" step="0.1" required />
        <Field label="Arrangement fee %" name="arrangementFee" type="number" step="0.01" defaultValue="2" />
        <Field label="Broker fee %" name="brokerFee" type="number" step="0.01" defaultValue="0" />
        <Field label="Exit fee %" name="exitFee" type="number" step="0.01" defaultValue="0" />
        <Field label="Valuation and legals (£)" name="lenderCosts" type="number" step="1" defaultValue="1500" />
        <Field label="Term (months)" name="termMonths" type="number" min="1" max="360" defaultValue="9" required />
        <div>
          <label className="block text-sm text-ink-300" htmlFor="confidence">Confidence</label>
          <select
            id="confidence"
            name="confidence"
            className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
          >
            <option value="indicative">Indicative</option>
            <option value="credit-backed">Credit-backed</option>
            <option value="valuation-backed">Valuation-backed</option>
            <option value="binding">Binding</option>
          </select>
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-ink-300">
        <input type="checkbox" name="interestRolledUp" defaultChecked className="mt-1" />
        Interest retained at drawdown rather than serviced monthly
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-5 rounded-xl border border-lode-400/50 px-5 py-2.5 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Record offer"}
      </button>

      {result !== undefined && (
        <p
          className={`mt-4 text-sm leading-relaxed ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-sm text-ink-300" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        {...rest}
        className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
      />
    </div>
  );
}
