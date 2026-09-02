"use client";

import { useActionState } from "react";
import {
  raiseFeeAction,
  recordDisclosureAction,
  recordInstructionAction,
  recordSellerAgreementAction,
  voidFeeAction,
  type FeeResult,
} from "./actions";

function Status({ result }: { result: FeeResult | undefined }) {
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

/** What the seller was told, recorded before anybody is bound by it. */
export function DisclosureForm({ dealId, current }: { dealId: string; current?: string }) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    recordDisclosureAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <label htmlFor="wording" className="eyebrow">
        The words the seller was given
      </label>
      <textarea
        id="wording"
        name="wording"
        rows={3}
        required
        defaultValue={current ?? ""}
        placeholder="Our fee is 0.60% of the price achieved, minimum £1,250 and capped at £7,500, payable on completion. Nothing is payable if the property does not sell."
        className="mt-2 w-full px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {pending ? "Recording…" : current === undefined ? "Record the disclosure" : "Update it"}
      </button>
      <Status result={result} />
    </form>
  );
}

const FIELD = "mt-2 w-full px-3 py-2";
const SUBMIT =
  "mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300";

/**
 * What the seller signed, and for which service.
 *
 * The form names a service, never a price. The band behind it lives in the
 * catalogue and is read on the server.
 */
export function SellerAgreementForm({
  dealId,
  current,
}: {
  dealId: string;
  current?: { signedBy: string; service: string };
}) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    recordSellerAgreementAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="signedBy" className="eyebrow">Who signed</label>
          <input
            id="signedBy"
            name="signedBy"
            required
            defaultValue={current?.signedBy ?? ""}
            placeholder="The seller's name, as signed"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="service" className="eyebrow">Which service</label>
          <select
            id="service"
            name="service"
            defaultValue={current?.service ?? "standard"}
            className={FIELD}
          >
            <option value="standard">Standard sale</option>
            <option value="managed">AI-managed premium sale</option>
          </select>
        </div>
      </div>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : current === undefined ? "Record the signature" : "Replace it"}
      </button>
      <Status result={result} />
    </form>
  );
}

/**
 * Whether the seller is already instructed elsewhere.
 *
 * There is no way to find this out from the property, so it is asked and the
 * answer recorded. Not asked is not the same as "none", which is why there is
 * no default selection that quietly means no.
 */
export function InstructionForm({
  dealId,
  current,
}: {
  dealId: string;
  current?: { kind: string; agent: string; released: boolean };
}) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    recordInstructionAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className="eyebrow">What they are instructed on</label>
          <select id="kind" name="kind" required defaultValue={current?.kind ?? ""} className={FIELD}>
            <option value="" disabled>Ask the seller</option>
            <option value="none">No agent instructed</option>
            <option value="multi-agency">Multi-agency</option>
            <option value="sole-agency">Sole agency</option>
            <option value="sole-selling-rights">Sole selling rights</option>
          </select>
        </div>
        <div>
          <label htmlFor="agent" className="eyebrow">The agent, named</label>
          <input
            id="agent"
            name="agent"
            required
            defaultValue={current?.agent ?? ""}
            placeholder="Or “none” where there is no agent"
            className={FIELD}
          />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2.5 text-[13px] text-ink-300">
        <input type="checkbox" name="released" defaultChecked={current?.released ?? false} />
        The instruction has ended and the release is in writing
      </label>
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? "Recording…" : "Record what the seller said"}
      </button>
      <Status result={result} />
    </form>
  );
}

export function RaiseFeeForm({ dealId, feeKey, label }: { dealId: string; feeKey: string; label: string }) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    raiseFeeAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-3.5 border-t hairline pt-3.5">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="feeKey" value={feeKey} />
      <label htmlFor={`note-${feeKey}`} className="eyebrow">
        Your reason
      </label>
      <input
        id={`note-${feeKey}`}
        name="note"
        required
        placeholder="What was done, and for whom."
        className="mt-2 w-full px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {pending ? "Raising…" : `Raise ${label.toLowerCase()}`}
      </button>
      <Status result={result} />
    </form>
  );
}

export function VoidFeeForm({ dealId, feeId }: { dealId: string; feeId: string }) {
  const [result, submit, pending] = useActionState<FeeResult | undefined, FormData>(
    voidFeeAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="feeId" value={feeId} />
      <input
        name="reason"
        required
        placeholder="Why it is being withdrawn"
        className="min-w-0 flex-1 px-3 py-1.5"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "Voiding…" : "Void"}
      </button>
      <Status result={result} />
    </form>
  );
}
