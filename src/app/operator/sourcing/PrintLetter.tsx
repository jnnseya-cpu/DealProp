"use client";

import { useState } from "react";
import { resolveLetter, markLeadContacted } from "./actions";
import { leadContactKey, type SourcedLead } from "@shared/domain/sourcedLead";

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
export function PrintLetter({ lead, signatureUrl }: { lead: SourcedLead; signatureUrl?: string }) {
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
  const [contacted, setContacted] = useState(false);

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
        ...(lead.court !== undefined ? { court: lead.court } : {}),
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
        ...(lead.court !== undefined ? { court: lead.court } : {}),
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
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // The signature sits in the signing space after "Yours faithfully", so split
    // the letter there and drop the image in; the rest (the name and footer)
    // follows. If the letter has no such line, the signature goes at the end.
    const marker = "Yours faithfully";
    const at = letter.indexOf(marker);
    const head = at === -1 ? letter : letter.slice(0, at + marker.length);
    const tail = at === -1 ? "" : letter.slice(at + marker.length).replace(/^\n+/, "");

    // A site-relative signature path is made absolute for the print window, which
    // has no base; an absolute URL or a data: URI is used as-is.
    const sig =
      signatureUrl === undefined || signatureUrl === ""
        ? ""
        : signatureUrl.startsWith("/")
          ? `${window.location.origin}${signatureUrl}`
          : signatureUrl;

    // The Lode mark as a letterhead — inline SVG so it prints with no network
    // dependency. Colour is the brand gold (globals.css --color-lode-400).
    const letterhead =
      `<div class="lh">` +
      `<svg width="30" height="30" viewBox="0 0 26 26" fill="none">` +
      `<path d="M13 2 3 8v10l10 6 10-6V8L13 2Z" stroke="#c9a44e" stroke-width="1.3"/>` +
      `<path d="M8 11.5 13 8.5l5 3v5.5l-5 3-5-3v-5.5Z" fill="#c9a44e" fill-opacity="0.22"/>` +
      `<path d="M13 8.5v9M8 11.5l10 5.5M18 11.5 8 17" stroke="#c9a44e" stroke-width="0.9" stroke-opacity="0.75"/>` +
      `</svg><span class="wm">Lode</span></div>`;

    const sigImg = sig === "" ? "" : `<img class="sig" src="${sig}" alt="Signature">`;

    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Letter</title>` +
        `<style>@page{margin:25mm}` +
        `body{font:12pt/1.55 Georgia,"Times New Roman",serif;color:#111;max-width:170mm}` +
        `.txt{white-space:pre-wrap}` +
        `.lh{display:flex;align-items:center;gap:8px;margin-bottom:10mm}` +
        `.wm{font:600 20px/1 Georgia,serif;letter-spacing:.02em;color:#1a1a1a}` +
        `.sig{display:block;height:28px;margin:2mm 0 1mm}` +
        `</style></head><body>` +
        letterhead +
        `<div class="txt">${esc(head)}</div>` +
        sigImg +
        `<div class="txt">${esc(tail)}</div>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();

    // Print once the signature image has loaded, or immediately if there is none.
    const img = sig === "" ? null : (w.document.querySelector("img.sig") as HTMLImageElement | null);
    if (img !== null && !img.complete) {
      img.addEventListener("load", () => w.print());
      img.addEventListener("error", () => w.print());
    } else {
      w.print();
    }

    // Printing is the one moment we know this property or estate has actually
    // been approached, so record it and suppress the lead from future runs —
    // that is the whole point of printing a letter here. Only the stable key is
    // stored, never the person. Reversible from the Contacted list on the page.
    const key = leadContactKey(lead);
    if (key !== undefined && !contacted) {
      void markLeadContacted({
        key,
        signalKey: lead.signalKey,
        // The three facts that let "Start a deal" work from the Contacted list
        // later, even after the live notice has rotated out of the feed.
        ...(lead.postcode !== undefined ? { postcode: lead.postcode } : {}),
        ...(lead.propertyAddress !== undefined ? { address: lead.propertyAddress } : {}),
        ...(lead.subjectName !== undefined ? { subjectName: lead.subjectName } : {}),
      }).then((r) => {
        if (r.ok) setContacted(true);
      });
    }
  }

  // Only the office-holder letters (probate / bankruptcy) need a contact resolved
  // before they are fully addressed; the homeowner letter is already addressed to
  // "The Homeowner" at the property. Used only to nudge — printing is never
  // blocked, because the operator addresses the envelope and checks before posting.
  const needsOfficeHolder = lead.signalKey === "probate-notice" || lead.signalKey === "owner-insolvent";
  const unaddressed = needsOfficeHolder && contact === undefined;

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
          className="mt-3 inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-[13px] font-medium text-ink-950 transition-colors hover:bg-lode-300"
        >
          Print this letter →
        </button>
        <p className="mt-2 text-[11px] leading-snug text-ink-500">
          {unaddressed
            ? "No office-holder address resolved yet — paste it above, or address the envelope from the notice. Post it yourself — nothing is sent from here."
            : "Check the address and any bracketed placeholder before posting. Post it yourself — nothing is sent from here."}
          {" "}The printed copy carries the Lode letterhead
          {signatureUrl !== undefined ? " and your signature" : ""} — the preview above is plain text.
        </p>
        {contacted && (
          <p className="mt-2 border-l-2 border-emerald-500/70 pl-3 text-[12px] leading-relaxed text-ink-300">
            Marked as written to — this lead won&apos;t appear in future searches. You can restore it
            from the <span className="text-ink-200">Contacted</span> list on the sourcing page.
          </p>
        )}
      </div>
    </details>
  );
}
