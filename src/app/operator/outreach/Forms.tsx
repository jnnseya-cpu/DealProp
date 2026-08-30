"use client";

import { useActionState } from "react";
import {
  approveMessageAction,
  draftEnquiryAction,
  sendMessageAction,
  suppressAddressAction,
  type OutreachResult,
} from "./actions";

function Status({ result }: { result: OutreachResult | undefined }) {
  if (result === undefined) return null;
  return (
    <p
      className={`mt-3 text-sm leading-relaxed ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
      role="status"
    >
      {result.message}
    </p>
  );
}

/** Compose a stage-one enquiry for one approved candidate against one deal. */
export function DraftForm({
  candidates,
  deals,
}: {
  candidates: readonly { id: string; name: string }[];
  deals: readonly { id: string; reference: string }[];
}) {
  const [result, submit, pending] = useActionState<OutreachResult | undefined, FormData>(
    draftEnquiryAction,
    undefined,
  );

  if (candidates.length === 0 || deals.length === 0) {
    return (
      <p className="mt-4 text-sm leading-relaxed text-ink-400">
        {candidates.length === 0
          ? "No approved candidates yet. Approve one on the discovery page first — nothing may be written to before a person has approved it."
          : "No deals to write about."}
      </p>
    );
  }

  return (
    <form action={submit} className="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-sm text-ink-300" htmlFor="candidateId">Funder</label>
        <select
          id="candidateId"
          name="candidateId"
          className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-ink-300" htmlFor="dealId">Deal</label>
        <select
          id="dealId"
          name="dealId"
          className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
        >
          {deals.map((d) => (
            <option key={d.id} value={d.id}>{d.reference}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-lode-400/50 px-5 py-2.5 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
      >
        {pending ? "Drafting…" : "Draft enquiry"}
      </button>
      <div className="w-full"><Status result={result} /></div>
    </form>
  );
}

/** Approve, then send. Two actions because they are two decisions. */
export function MessageActions({ messageId, status }: { messageId: string; status: string }) {
  const [approve, approveSubmit, approving] = useActionState<OutreachResult | undefined, FormData>(
    approveMessageAction,
    undefined,
  );
  const [send, sendSubmit, sending] = useActionState<OutreachResult | undefined, FormData>(
    sendMessageAction,
    undefined,
  );

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-3">
        {status === "draft" && (
          <form action={approveSubmit}>
            <input type="hidden" name="messageId" value={messageId} />
            <button
              type="submit"
              disabled={approving}
              className="rounded-xl border hairline px-4 py-2 text-sm text-ink-200 transition hover:border-ink-500 disabled:opacity-50"
            >
              {approving ? "Recording…" : "Approve"}
            </button>
          </form>
        )}
        {status === "approved" && (
          <form action={sendSubmit}>
            <input type="hidden" name="messageId" value={messageId} />
            <button
              type="submit"
              disabled={sending}
              className="rounded-xl border border-lode-400/50 px-4 py-2 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send now"}
            </button>
          </form>
        )}
      </div>
      <Status result={approve ?? send} />
    </div>
  );
}

/** Suppress an address without waiting for a reply to arrive. */
export function SuppressForm() {
  const [result, submit, pending] = useActionState<OutreachResult | undefined, FormData>(
    suppressAddressAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-sm text-ink-300" htmlFor="suppress-email">Address</label>
        <input
          id="suppress-email"
          name="email"
          type="email"
          required
          className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
        />
      </div>
      <div>
        <label className="block text-sm text-ink-300" htmlFor="suppress-reason">Reason</label>
        <input
          id="suppress-reason"
          name="reason"
          type="text"
          className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border hairline px-4 py-2 text-sm text-ink-200 transition hover:border-ink-500 disabled:opacity-50"
      >
        {pending ? "Recording…" : "Never contact"}
      </button>
      <div className="w-full"><Status result={result} /></div>
    </form>
  );
}
