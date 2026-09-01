"use client";

import { useActionState } from "react";
import { grantBalanceAction, writeOffDebtAction, type AdjustmentResult } from "./actions";

/**
 * The recorded way to move money by hand.
 *
 * It exists so that the unrecorded way does not get used. Without a path here,
 * a goodwill credit is made at a database prompt with no author, no reason and
 * no audit line — indistinguishable from somebody crediting themselves.
 *
 * The reason field is required and the ceiling is enforced on the server; both
 * are stated here so nobody has to discover them by being refused.
 */
export function AdjustmentForm({
  accounts,
}: {
  accounts: readonly { id: string; email: string }[];
}) {
  const [grant, grantSubmit, granting] = useActionState<AdjustmentResult | undefined, FormData>(
    grantBalanceAction,
    undefined,
  );
  const [writeOff, writeOffSubmit, writingOff] = useActionState<
    AdjustmentResult | undefined,
    FormData
  >(writeOffDebtAction, undefined);

  if (accounts.length === 0) return null;

  return (
    <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel
        title="Grant balance"
        note="A goodwill credit. Granted, never purchased — it has no cash behind it, so it can never be refunded out as cash."
        action={grantSubmit}
        pending={granting}
        result={grant}
        accounts={accounts}
        amountLabel="Amount to grant (£)"
        submitLabel="Grant balance"
      />
      <Panel
        title="Write off a debt"
        note="Clears what a reversal left outstanding, so an account that will never settle is not blocked forever. The original entry stays; this records that it was forgiven."
        action={writeOffSubmit}
        pending={writingOff}
        result={writeOff}
        accounts={accounts}
        amountLabel="Amount to write off (£)"
        submitLabel="Write off"
      />
    </div>
  );
}

function Panel({
  title,
  note,
  action,
  pending,
  result,
  accounts,
  amountLabel,
  submitLabel,
}: {
  title: string;
  note: string;
  action: (formData: FormData) => void;
  pending: boolean;
  result: AdjustmentResult | undefined;
  accounts: readonly { id: string; email: string }[];
  amountLabel: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <h2 className="font-display text-lg text-ink-100">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">{note}</p>

      <label className="mt-5 block text-sm text-ink-300" htmlFor={`${title}-account`}>
        Account
      </label>
      <select
        id={`${title}-account`}
        name="accountId"
        required
        className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.email}
          </option>
        ))}
      </select>

      <label className="mt-4 block text-sm text-ink-300" htmlFor={`${title}-amount`}>
        {amountLabel}
      </label>
      <input
        id={`${title}-amount`}
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        required
        className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
      />

      <label className="mt-4 block text-sm text-ink-300" htmlFor={`${title}-reason`}>
        Reason (required, kept in the ledger against your name)
      </label>
      <input
        id={`${title}-reason`}
        name="reason"
        type="text"
        minLength={12}
        required
        className="mt-1 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
      />

      <button
        type="submit"
        disabled={pending}
        className="mt-5 inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
      >
        {pending ? "Recording…" : submitLabel}
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
