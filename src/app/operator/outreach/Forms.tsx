"use client";

import { useActionState } from "react";
import {
  approveMessageAction,
  draftEnquiryAction,
  draftOwnerLetterAction,
  grantDataRoomAction,
  markPostedAction,
  recordDisclosureConsentAction,
  sendMessageAction,
  sendTeaserAction,
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

/**
 * The stages after the anonymous enquiry.
 *
 * Consent first, then the identified teaser, then the pack. Each is offered
 * separately because each discloses more than the last, and a single button
 * that did all three would mean nobody ever decided the middle one.
 */
export function StageForms({
  candidates,
  deals,
}: {
  candidates: readonly { id: string; name: string }[];
  deals: readonly { id: string; reference: string; consent?: string }[];
}) {
  const [consent, consentSubmit, recording] = useActionState<OutreachResult | undefined, FormData>(
    recordDisclosureConsentAction,
    undefined,
  );
  const [teaser, teaserSubmit, teasing] = useActionState<OutreachResult | undefined, FormData>(
    sendTeaserAction,
    undefined,
  );
  const [grant, grantSubmit, granting] = useActionState<OutreachResult | undefined, FormData>(
    grantDataRoomAction,
    undefined,
  );

  if (deals.length === 0) return null;

  return (
    <div className="mt-4 space-y-6">
      <form action={consentSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm text-ink-300" htmlFor="consent-deal">Deal</label>
          <select id="consent-deal" name="dealId" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100">
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.reference}{d.consent !== undefined ? ` — ${d.consent}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-ink-300" htmlFor="consent-scope">Owner agreed to</label>
          <select id="consent-scope" name="scope" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100">
            <option value="identified-teaser">Naming the property</option>
            <option value="full-pack">The full pack</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-ink-300" htmlFor="consent-note">How it was given</label>
          <input id="consent-note" name="note" type="text" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100" />
        </div>
        <button type="submit" disabled={recording} className="rounded-xl border hairline px-4 py-2 text-sm text-ink-200 transition hover:border-ink-500 disabled:opacity-50">
          {recording ? "Recording…" : "Record consent"}
        </button>
        <div className="w-full"><Status result={consent} /></div>
      </form>

      {candidates.length > 0 && (
        <>
          <StagePair
            legend="Stage two — identified teaser"
            action={teaserSubmit}
            pending={teasing}
            result={teaser}
            candidates={candidates}
            deals={deals}
            submitLabel="Draft teaser"
            idPrefix="teaser"
          />
          <StagePair
            legend="Stage three — data room"
            action={grantSubmit}
            pending={granting}
            result={grant}
            candidates={candidates}
            deals={deals}
            submitLabel="Grant access"
            idPrefix="grant"
          />
        </>
      )}
    </div>
  );
}

function StagePair({
  legend,
  action,
  pending,
  result,
  candidates,
  deals,
  submitLabel,
  idPrefix,
}: {
  legend: string;
  action: (formData: FormData) => void;
  pending: boolean;
  result: OutreachResult | undefined;
  candidates: readonly { id: string; name: string }[];
  deals: readonly { id: string; reference: string }[];
  submitLabel: string;
  idPrefix: string;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <p className="w-full font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">{legend}</p>
      <div>
        <label className="block text-sm text-ink-300" htmlFor={`${idPrefix}-candidate`}>Funder</label>
        <select id={`${idPrefix}-candidate`} name="candidateId" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100">
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-ink-300" htmlFor={`${idPrefix}-deal`}>Deal</label>
        <select id={`${idPrefix}-deal`} name="dealId" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100">
          {deals.map((d) => (
            <option key={d.id} value={d.id}>{d.reference}</option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="rounded-xl border hairline px-4 py-2 text-sm text-ink-200 transition hover:border-ink-500 disabled:opacity-50">
        {pending ? "Working…" : submitLabel}
      </button>
      <div className="w-full"><Status result={result} /></div>
    </form>
  );
}

/**
 * Write to a property owner, by post.
 *
 * The three checkboxes are what makes the letter lawful, and the gate refuses
 * it until each has actually been done — so they are stated as the actions they
 * are, not as a disclaimer to tick past.
 */
export function OwnerLetterForm({
  owners,
  deals,
}: {
  owners: readonly { id: string; name: string; address: string }[];
  deals: readonly { id: string; reference: string }[];
}) {
  const [result, submit, pending] = useActionState<OutreachResult | undefined, FormData>(
    draftOwnerLetterAction,
    undefined,
  );

  if (owners.length === 0 || deals.length === 0) {
    return (
      <p className="mt-4 text-sm leading-relaxed text-ink-400">
        No owners on record with a postal address. An owner comes from a title register bought for a
        specific deal — nothing is inferred from the property address.
      </p>
    );
  }

  return (
    <form action={submit} className="mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm text-ink-300" htmlFor="owner-candidate">Owner</label>
          <select id="owner-candidate" name="candidateId" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100">
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name} — {o.address}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-ink-300" htmlFor="owner-deal">Deal</label>
          <select id="owner-deal" name="dealId" className="mt-1 rounded-xl border hairline bg-ink-950 px-3 py-2 text-sm text-ink-100">
            {deals.map((d) => (
              <option key={d.id} value={d.id}>{d.reference}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {[
          { name: "mpsScreened", label: "Screened against the Mailing Preference Service" },
          { name: "privacyNoticeIncluded", label: "Privacy notice included, saying where the address came from" },
          { name: "legitimateInterestsRecorded", label: "Legitimate-interests assessment recorded for this approach" },
        ].map((check) => (
          <label key={check.name} className="flex items-start gap-2 text-sm text-ink-300">
            <input type="checkbox" name={check.name} className="mt-1" />
            {check.label}
          </label>
        ))}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-xl border hairline px-4 py-2 text-sm text-ink-200 transition hover:border-ink-500 disabled:opacity-50"
      >
        {pending ? "Drafting…" : "Draft owner letter"}
      </button>
      <Status result={result} />
    </form>
  );
}

/** Record that a queued letter actually went in the post. */
export function PostedButton({ messageId }: { messageId: string }) {
  const [result, submit, pending] = useActionState<OutreachResult | undefined, FormData>(
    markPostedAction,
    undefined,
  );

  return (
    <div className="mt-4">
      <form action={submit}>
        <input type="hidden" name="messageId" value={messageId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-lode-400/50 px-4 py-2 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
        >
          {pending ? "Recording…" : "Mark posted"}
        </button>
      </form>
      <Status result={result} />
    </div>
  );
}
