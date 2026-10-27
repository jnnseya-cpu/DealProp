"use client";

import { useState } from "react";
import { resolveLetter } from "./actions";
import type { SourcedLead } from "@shared/domain/sourcedLead";

/**
 * Review and print the letter to a lead's office-holder.
 *
 * Kind-aware: a probate lead's letter goes to the estate's representatives (the
 * executor), a bankruptcy lead's to the trustee in bankruptcy / Official
 * Receiver — never to the bereaved or the bankrupt. When opened, the component
 * resolves the office-holder from the notice on demand — one fetch — and redraws
 * the letter with their address in the recipient block, so it is ready to post
 * without leaving Lode. Until it resolves (or if the notice names none), it
 * shows the drafted letter with the notice link, so there is always something in
 * hand. Never sent from here: it is printed and posted by a named person.
 */
export function PrintLetter({ lead }: { lead: SourcedLead }) {
  const insolvency = lead.signalKey === "owner-insolvent";
  const recipientWord = insolvency ? "trustee / Official Receiver" : "executors";

  const [letter, setLetter] = useState(lead.letterDraft ?? "");
  const [contact, setContact] = useState<string | undefined>(lead.contactForService);
  const [loading, setLoading] = useState(false);
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
      if (r.contactForService !== undefined) setContact(r.contactForService);
      if (r.message !== undefined) setNote(r.message);
      else if (r.contactForService === undefined) {
        setNote(
          `This notice named no ${insolvency ? "trustee" : "contact for service"} — open the notice to read who to write to.`,
        );
      }
    } catch {
      setNote("Could not reach the notice just now. Open it directly for the contact.");
    } finally {
      setLoading(false);
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
            Finding the {insolvency ? "trustee" : "contact for service"} in the notice…
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
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-300">
          {letter}
        </pre>
        <button
          type="button"
          onClick={print}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-[13px] font-medium text-ink-950 transition-colors hover:bg-lode-300"
        >
          Print this letter →
        </button>
        <p className="mt-2 text-[11px] leading-snug text-ink-500">
          Check the address and any bracketed placeholder before posting. Post it yourself — nothing
          is sent from here.
        </p>
      </div>
    </details>
  );
}
