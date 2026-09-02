"use client";

import { useActionState } from "react";
import {
  recordAuthorityAction,
  recordIdentityAction,
  recordRiskAction,
  type CheckResult,
} from "./actions";
import { ENHANCED_TRIGGERS, SELLER_KINDS } from "@shared/domain/sellerDueDiligence";

const FIELD = "mt-2 w-full px-3 py-2";
const SUBMIT =
  "mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300";

function Status({ result }: { result: CheckResult | undefined }) {
  if (result === undefined) return null;
  return (
    <p
      role="status"
      className={`mt-2.5 text-[13px] leading-[1.6] ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
    >
      {result.message}
    </p>
  );
}

export function IdentityForm({ dealId, kind, method }: { dealId: string; kind?: string; method?: string }) {
  const [result, submit, pending] = useActionState<CheckResult | undefined, FormData>(
    recordIdentityAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <label htmlFor="kind" className="eyebrow">
        Who is selling
      </label>
      <select id="kind" name="kind" required defaultValue={kind ?? ""} className={FIELD}>
        <option value="" disabled>
          Choose
        </option>
        {SELLER_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </select>
      <label htmlFor="method" className="eyebrow mt-3 block">
        How identity was verified
      </label>
      <input
        id="method"
        name="method"
        required
        defaultValue={method ?? ""}
        placeholder="Photo ID and proof of address, checked electronically"
        className={FIELD}
      />
      {/*
        Screening is recorded with the identity check rather than separately.
        Dealing with a designated person is an offence regardless of what
        anybody knew, so there is no state in which identity is done and
        screening is outstanding.
      */}
      <label className="mt-3 flex items-start gap-2.5 text-[13px] leading-[1.6] text-ink-300">
        <input type="checkbox" name="screened" className="mt-1" />
        Screened against sanctions and PEP lists, with no match, or a match cleared
      </label>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record identity and screening"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function AuthorityForm({
  dealId,
  evidence,
  expected,
}: {
  dealId: string;
  evidence?: string;
  expected: string;
}) {
  const [result, submit, pending] = useActionState<CheckResult | undefined, FormData>(
    recordAuthorityAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <label htmlFor="evidence" className="eyebrow">
        What was seen
      </label>
      <textarea
        id="evidence"
        name="evidence"
        rows={3}
        required
        defaultValue={evidence ?? ""}
        placeholder={expected}
        className={FIELD}
      />
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the authority to sell"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function RiskForm({
  dealId,
  triggers,
  measures,
}: {
  dealId: string;
  triggers: readonly string[];
  measures?: string;
}) {
  const [result, submit, pending] = useActionState<CheckResult | undefined, FormData>(
    recordRiskAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <p className="eyebrow">Anything that triggers enhanced measures</p>
      <ul className="mt-2 space-y-2.5">
        {Object.entries(ENHANCED_TRIGGERS).map(([key, description]) => (
          <li key={key}>
            <label className="flex items-start gap-2.5 text-[13px] leading-[1.6] text-ink-300">
              <input
                type="checkbox"
                name="triggers"
                value={key}
                defaultChecked={triggers.includes(key)}
                className="mt-1"
              />
              {description}
            </label>
          </li>
        ))}
      </ul>
      <label htmlFor="measures" className="eyebrow mt-4 block">
        What was done about them
      </label>
      <textarea
        id="measures"
        name="measures"
        rows={2}
        defaultValue={measures ?? ""}
        placeholder="Source of wealth evidenced; approved by the nominated officer."
        className={FIELD}
      />
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the risk assessment"}
      </button>
      <Status result={result} />
    </form>
  );
}
