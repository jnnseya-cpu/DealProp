"use client";

import { useState } from "react";
import { resolveLetter } from "./actions";
import type { SourcedLead } from "@shared/domain/sourcedLead";

/**
 * Review, complete and print the letter to a lead's office-holder.
 *
 * Kind-aware: a probate lead's letter goes to the estate's representatives (the
 * executor), a bankruptcy lead's to the trustee in bankruptcy / Official
 * Receiver — never to the bereaved or the bankrupt. The recipient's address is
 * filled two ways: when opened, the component tries to read the office-holder
 * from the notice (a best effort — the Gazette forbids reading some of its notice
 * data automatically, and we respect that); and, always, the operator can open
 * the notice (one tap, permitted) and paste the office-holder's name and address
 * into the field below, which redraws the letter addressed to them. So a letter
 * is never printed with a placeholder where the recipient should be. Never sent
 * from here — it is printed and posted by a named person.
 */
export function PrintLetter({ lead }: { lead: SourcedLead }) {
  const insolvency = lead.signalKey === "owner-insolvent";
  const recipientWord =
    lead.signalKey === "prepared-but-unsold"
      ? "homeowner"
      : insolvency
        ? "trustee / Official Receiver"
        : "executors";
  const holderWord = insolvency ? "trustee / Official Receiver" : "contact for service";

  const [letter, setLetter] = useState(lead.letterDraft ?? "");
  const [contact, setContact] = useState<string | undefined>(lead.contactForService);
  const [address, setAddress] = useState<string>(lead.contactForService ?? "");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [tried, setTried] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  async function onOpen() {
    if (tried || contact !== undefined || lead.sourceUrl === undefined) return;
    setTried(true);
    setLoading(true);
    try {
      const r = await resolveLetter({
        kind: lead.signalKey,
        noticeUrl: lead.sourceUrl,
        subjectName: lead.subjectName ?? "",
        propertyAddress: lead.propertyAddress ?? "",
      });
      setLetter(r.letter);
      if (r.contactForService !== undefined) {
        setContact(r.contactForService);
        setAddress(r.contactForService);
      }
      if (r.message !== undefined) setNote(r.message);
    } catch {
      setNote("Could not reach the notice just now. Open it directly and paste the contact below.");
    } finally {
      setLoading(false);
    }
  }

  async function applyAddress() {
    const typed = address.trim();
    if (typed === "") return;
    setApplying(true);
    try {
      const r = await resolveLetter({
        kind: lead.signalKey,
        noticeUrl: lead.sourceUrl ?? "",
        subjectName: lead.subjectName ?? "",
        propertyAddress: lead.propertyAddress ?? "",
        contactOverride: typed,
      });
      setLetter(r.letter);
      setContact(typed);
      setNote(undefined);
    } catch {
      setNote("Could not update the letter just now — try again.");
    } finally {
      setApplying(false);
    }
  }

  function print() {
    const w = window.open("", "_blank", "width=820,height=1000");
    if (w === null) return;
    const escaped = letter
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Letter</title>` +
        `<style>@page{margin:25mm}` +
        `body{font:12pt/1.55 Georgia,"Times New Roman",serif;color:#111;white-space:pre-wrap;max-width:170mm}</style>` +
        `</head><body>${escaped}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  // The letter still carries the placeholder recipient until an address is set.
  const unaddressed = contact === undefined;

  return (
    <details
      className="mt-3 rounded-lg border hairline bg-surface-2"
      onToggle={(e) => {
        if (e.currentTarget.open) void onOpen();
      }}
    >
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-ink-200">
        Letter to the {recipientWord} — review &amp; print
      </summary>
      <div className="border-t hairline px-4 py-3">
        {loading && (
          <p className="mb-2 text-[12px] text-ink-400">
            Looking for the {holderWord} in the notice…
          </p>
        )}
        {contact !== undefined && (
          <p className="mb-2 border-l-2 border-emerald-500/70 pl-3 text-[13px] leading-relaxed text-ink-200">
            <span className="text-ink-300">Posting to:</span> {contact}
          </p>
        )}
        {note !== undefined && (
          <p className="mb-2 text-[12px] leading-relaxed text-amber-300/90">
            {note}{" "}
            {lead.sourceUrl !== undefined && (
              <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Open the notice →
              </a>
            )}
          </p>
        )}

        {/* Always offer the manual completion — it is the reliable path. */}
        <div className="mb-3 rounded-md border hairline bg-surface-1 p-3">
          <label className="block text-[12px] font-medium text-ink-200">
            {holderWord.replace(/^./, (c) => c.toUpperCase())} — name &amp; address
          </label>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-500">
            {lead.sourceUrl !== undefined ? (
              <>
                <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Open the notice →
                </a>{" "}
                to read who to write to, then paste it here and apply.
              </>
            ) : (
              "Paste the office-holder's name and address, then apply."
            )}
          </p>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={`e.g. Wards Solicitors, Prudential Buildings, 11-19 Wine Street, Bristol, BS1 2PH`}
            className="mt-2 w-full resize-y rounded-md border hairline bg-surface-2 px-2.5 py-1.5 text-[13px] leading-relaxed text-ink-100"
          />
          <button
            type="button"
            onClick={applyAddress}
            disabled={applying || address.trim() === ""}
            className="mt-2 inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] font-medium text-ink-100 transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply to letter"}
          </button>
        </div>

        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-300">
          {letter}
        </pre>
        <button
          type="button"
          onClick={print}
          disabled={unaddressed}
          title={unaddressed ? "Add the recipient's address first" : undefined}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-[13px] font-medium text-ink-950 transition-colors hover:bg-lode-300 disabled:opacity-50"
        >
          Print this letter →
        </button>
        <p className="mt-2 text-[11px] leading-snug text-ink-500">
          {unaddressed
            ? "Add the recipient's address above before printing — nothing is sent from here."
            : "Check the address and any bracketed placeholder before posting. Post it yourself — nothing is sent from here."}
        </p>
      </div>
    </details>
  );
}
