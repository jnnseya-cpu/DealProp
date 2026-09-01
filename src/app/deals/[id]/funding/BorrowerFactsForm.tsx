"use client";

import { useActionState } from "react";
import { recordBorrowerFactsAction, type EvidenceResult } from "./actions";

/**
 * The facts the regulatory route is classified from.
 *
 * The first question decides most cases on its own, so it is asked first and
 * plainly. A loan secured on a dwelling the borrower or a relative occupies is
 * a regulated mortgage contract whatever anybody has declared about purpose,
 * and nothing else on this form changes that.
 */
export function BorrowerFactsForm({
  dealId,
  current,
}: {
  dealId: string;
  current: Record<string, unknown> | undefined;
}) {
  const [result, submit, pending] = useActionState<EvidenceResult | undefined, FormData>(
    recordBorrowerFactsAction,
    undefined,
  );

  const on = (name: string): boolean => current?.[name] === true;

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />

      <label className="flex items-start gap-2 rounded-lg border-l-2 border-amber-500/80 bg-surface-1 px-4 py-3 text-sm leading-relaxed text-ink-200">
        <input
          type="checkbox"
          name="securityIncludesOwnerOccupiedDwelling"
          defaultChecked={on("securityIncludesOwnerOccupiedDwelling")}
          className="mt-1"
        />
        The security includes a dwelling occupied, or intended to be occupied, by the borrower or a
        related person.
      </label>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-sm text-ink-300" htmlFor="legalForm">Borrower</label>
          <select
            id="legalForm"
            name="legalForm"
            defaultValue={typeof current?.["legalForm"] === "string" ? (current["legalForm"] as string) : "spv"}
            className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
          >
            <option value="spv">SPV</option>
            <option value="company">Company</option>
            <option value="llp">LLP</option>
            <option value="trust">Trust</option>
            <option value="individual">Individual</option>
          </select>
        </div>
        <Jurisdiction name="borrowerJurisdiction" label="Borrower is in" current={current} />
        <Jurisdiction name="assetJurisdiction" label="Asset is in" current={current} />
      </div>

      <div className="mt-4 space-y-2">
        {[
          { name: "businessPurposeDeclared", label: "Business purpose declared by the borrower" },
          { name: "businessPurposeEvidenced", label: "Evidence of that purpose recorded — a declaration alone is not enough" },
          { name: "consumerBuyToLetIndicators", label: "Consumer buy-to-let indicators (let to family, inherited rather than bought to let)" },
        ].map((field) => (
          <label key={field.name} className="flex items-start gap-2 text-sm text-ink-300">
            <input type="checkbox" name={field.name} defaultChecked={on(field.name)} className="mt-1" />
            {field.label}
          </label>
        ))}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
      >
        {pending ? "Saving…" : "Classify the route"}
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

function Jurisdiction({
  name,
  label,
  current,
}: {
  name: string;
  label: string;
  current: Record<string, unknown> | undefined;
}) {
  return (
    <div>
      <label className="block text-sm text-ink-300" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        maxLength={2}
        defaultValue={typeof current?.[name] === "string" ? (current[name] as string) : "GB"}
        className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 font-mono text-sm uppercase text-ink-100"
      />
    </div>
  );
}
