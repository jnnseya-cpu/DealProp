"use client";

import { useActionState } from "react";
import {
  REDRESS_SCHEME_LABELS,
  type SourcerCompliance,
} from "@shared/domain/accounts";
import type { BoxFormResult } from "@shared/formFields";
import { verifySourcerCompliance } from "./actions";

/**
 * A named operator checks a flipper's recorded AML and redress references.
 *
 * Shows the two references the flipper recorded, read-only, so the operator can
 * look them up — the HMRC anti-money-laundering register and the redress scheme
 * — and records what was checked against a name and a date. A self-recorded
 * number is a claim; this is the check that turns it into evidence and lets the
 * assignment fee be charged.
 */
export function VerifySourcerForm({
  id,
  compliance,
}: {
  id: string;
  compliance: SourcerCompliance;
}) {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    verifySourcerCompliance,
    undefined,
  );
  const v = compliance.verification;

  return (
    <div className="mt-3 rounded-xl border hairline bg-surface-2 px-4 py-3">
      <p className="eyebrow">Sourcing compliance</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] leading-relaxed">
        <dt className="text-ink-500">HMRC AML</dt>
        <dd className="text-ink-200">
          {compliance.amlRegistration}{" "}
          <span className="text-ink-500">· confirmed {compliance.amlConfirmedAt}</span>
        </dd>
        <dt className="text-ink-500">Redress</dt>
        <dd className="text-ink-200">
          {REDRESS_SCHEME_LABELS[compliance.redressScheme]} · {compliance.redressMembership}
        </dd>
      </dl>

      {v !== undefined ? (
        <p className="mt-2 text-[12px] leading-relaxed text-emerald-300/80">
          Verified by {v.verifiedBy} on {v.verifiedAt} — {v.evidence}. Re-verify to renew.
        </p>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-amber-300/80">
          Not yet verified. Check the references, then record what you checked.
        </p>
      )}

      <form action={submit} className="mt-2.5 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input
          type="text"
          name="evidence"
          required
          maxLength={200}
          placeholder="What you checked (e.g. HMRC AML register + PRS membership)"
          defaultValue={v?.evidence ?? ""}
          className="h-8 min-w-0 flex-1 rounded-md border hairline bg-surface-1 px-2.5 text-[13px] text-ink-100 outline-none focus:border-ink-500"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-1 px-3 text-[13px] font-medium text-ink-100 transition-colors hover:bg-surface-3 disabled:opacity-50"
        >
          {pending ? "Saving…" : v !== undefined ? "Re-verify" : "Verify"}
        </button>
        {result !== undefined && (
          <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
            {result.message}
          </span>
        )}
      </form>
    </div>
  );
}
