"use client";

import { useActionState } from "react";
import {
  recordFundsAction,
  recordIdentityAction,
  recordSolicitorAction,
  type PassportResult,
} from "./actions";

const FIELD = "mt-2 w-full px-3 py-2";
const SUBMIT =
  "mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300";

function Status({ result }: { result: PassportResult | undefined }) {
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

export function IdentityForm({
  method,
  verifiedAt,
  screenedAt,
}: {
  method?: string;
  verifiedAt?: string;
  screenedAt?: string;
}) {
  const [result, submit, pending] = useActionState<PassportResult | undefined, FormData>(
    recordIdentityAction,
    undefined,
  );

  return (
    <form action={submit}>
      <label htmlFor="method" className="eyebrow">
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
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="verifiedAt" className="eyebrow">
            Date of the check
          </label>
          <input
            id="verifiedAt"
            name="verifiedAt"
            type="date"
            required
            defaultValue={verifiedAt ?? ""}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="screenedAt" className="eyebrow">
            Date screened for sanctions and PEP
          </label>
          <input
            id="screenedAt"
            name="screenedAt"
            type="date"
            defaultValue={screenedAt ?? ""}
            className={FIELD}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the identity check"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function FundsForm({
  kind,
  issuer,
  amount,
  evidencedAt,
  expiresAt,
}: {
  kind?: string;
  issuer?: string;
  amount?: string;
  evidencedAt?: string;
  expiresAt?: string;
}) {
  const [result, submit, pending] = useActionState<PassportResult | undefined, FormData>(
    recordFundsAction,
    undefined,
  );

  return (
    <form action={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className="eyebrow">
            What the funding is
          </label>
          <select id="kind" name="kind" required defaultValue={kind ?? ""} className={FIELD}>
            <option value="" disabled>
              Choose
            </option>
            <option value="cash">Cash on deposit</option>
            <option value="mortgage-in-principle">Mortgage decision in principle</option>
            <option value="bridging-terms">Bridging or development terms</option>
            <option value="backed-by-investor">Backed by an investor</option>
          </select>
        </div>
        <div>
          <label htmlFor="issuer" className="eyebrow">
            Who issued the evidence
          </label>
          <input
            id="issuer"
            name="issuer"
            required
            defaultValue={issuer ?? ""}
            placeholder="The bank, lender or investor, named"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="amount" className="eyebrow">
            What it shows is available (£)
          </label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={amount ?? ""}
            placeholder="250000"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="evidencedAt" className="eyebrow">
            Date on the evidence itself
          </label>
          <input
            id="evidencedAt"
            name="evidencedAt"
            type="date"
            required
            defaultValue={evidencedAt ?? ""}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="expiresAt" className="eyebrow">
            When it lapses, if it says
          </label>
          <input
            id="expiresAt"
            name="expiresAt"
            type="date"
            defaultValue={expiresAt ?? ""}
            className={FIELD}
          />
        </div>
      </div>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the funds evidence"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function SolicitorForm({ solicitor }: { solicitor?: string }) {
  const [result, submit, pending] = useActionState<PassportResult | undefined, FormData>(
    recordSolicitorAction,
    undefined,
  );

  return (
    <form action={submit}>
      <label htmlFor="solicitor" className="eyebrow">
        The firm instructed
      </label>
      <input
        id="solicitor"
        name="solicitor"
        required
        defaultValue={solicitor ?? ""}
        placeholder="The conveyancer ready to act"
        className={FIELD}
      />
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record the conveyancer"}
      </button>
      <Status result={result} />
    </form>
  );
}
