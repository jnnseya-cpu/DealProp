"use client";

import { useActionState } from "react";
import { recordEvidenceAction, type EvidenceResult } from "./actions";

/**
 * Record what can actually be proved about a deal.
 *
 * The readiness score reads this, and absence scores zero rather than full
 * marks — so an empty form is an honest 17/100 rather than a flattering one.
 * Every field is something a funder will ask for and check.
 */
const CHECKS: readonly { name: string; label: string; group: string }[] = [
  { group: "Legal and title", name: "tenureConfirmed", label: "Tenure confirmed against the register" },
  { group: "Legal and title", name: "legalPackReviewed", label: "Legal pack reviewed by a solicitor" },
  { group: "Legal and title", name: "searchesOrdered", label: "Searches ordered" },
  { group: "Legal and title", name: "titleDefectsResolved", label: "Title defects resolved or priced" },
  { group: "Valuation", name: "independentValuation", label: "Independent valuation obtained" },
  { group: "Valuation", name: "comparablesRecorded", label: "Comparable sales recorded" },
  { group: "Borrower", name: "borrowerIdentityVerified", label: "Identity verified" },
  { group: "Borrower", name: "sourceOfFundsEvidenced", label: "Source of funds evidenced" },
  { group: "Borrower", name: "trackRecordRecorded", label: "Track record recorded" },
  { group: "Borrower", name: "adverseCreditDeclared", label: "Adverse credit declared (tick if any exists)" },
  { group: "Costs", name: "scheduleOfWorks", label: "Schedule of works produced" },
  { group: "Costs", name: "costPlanFromQs", label: "Costs checked by a quantity surveyor" },
  { group: "Costs", name: "contractorAppointed", label: "Contractor appointed" },
  { group: "Costs", name: "programmeAgreed", label: "Programme agreed against the exit date" },
  { group: "Exit", name: "exitEvidence", label: "Exit evidenced" },
  { group: "Exit", name: "backupExitRecorded", label: "Backup exit recorded" },
  { group: "Evidence", name: "solicitorInstructed", label: "Solicitor instructed" },
];

export function EvidenceForm({
  dealId,
  current,
}: {
  dealId: string;
  current: Record<string, unknown>;
}) {
  const [result, submit, pending] = useActionState<EvidenceResult | undefined, FormData>(
    recordEvidenceAction,
    undefined,
  );

  const groups = [...new Set(CHECKS.map((c) => c.group))];

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Title number"
          name="titleNumber"
          defaultValue={asString(current["titleNumber"])}
          placeholder="WM123456"
        />
        <Field
          label="Valuer firm"
          name="valuerFirm"
          defaultValue={asString(current["valuerFirm"])}
          placeholder="Example Surveyors LLP"
        />
        <Field
          label="Valuation date"
          name="valuationDate"
          type="date"
          defaultValue={asString(current["valuationDate"])}
        />
        <Field
          label="Committed cash with proof (£)"
          name="committedCash"
          type="number"
          step="0.01"
          min="0"
          defaultValue={
            typeof current["committedCash"] === "number"
              ? String((current["committedCash"] as number) / 100)
              : ""
          }
        />
        <div>
          <label className="block text-sm text-ink-300" htmlFor="planningStatus">Planning</label>
          <select
            id="planningStatus"
            name="planningStatus"
            defaultValue={asString(current["planningStatus"])}
            className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
          >
            <option value="">Not stated</option>
            <option value="not-required">Not required</option>
            <option value="granted">Granted</option>
            <option value="applied">Applied</option>
            <option value="pre-application">Pre-application</option>
            <option value="none">None</option>
          </select>
        </div>
        <Field
          label="Expired documents in the pack"
          name="expiredDocuments"
          type="number"
          min="0"
          defaultValue={
            typeof current["expiredDocuments"] === "number" ? String(current["expiredDocuments"]) : "0"
          }
        />
      </div>

      {groups.map((group) => (
        <fieldset key={group} className="mt-6">
          <legend className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">
            {group}
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CHECKS.filter((c) => c.group === group).map((check) => (
              <label key={check.name} className="flex items-start gap-2 text-sm text-ink-300">
                <input
                  type="checkbox"
                  name={check.name}
                  defaultChecked={current[check.name] === true}
                  className="mt-1"
                />
                {check.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 rounded-xl border border-lode-400/50 px-5 py-2.5 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Record evidence"}
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

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
