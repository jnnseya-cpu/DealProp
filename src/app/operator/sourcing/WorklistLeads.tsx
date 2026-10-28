"use client";

import { PrintLetter } from "./PrintLetter";
import { StartDealForm } from "./StartDealForm";
import { DismissForm } from "./DismissForm";
import type { SourcedLead } from "@shared/domain/sourcedLead";

/**
 * The saved worklist, rendered so each row can be acted on — not just set aside.
 *
 * Every row carries the "write to The Homeowner" letter (with the Lode letterhead
 * and the operator signature) and the "start a deal" action, the same two the
 * live run offers. It is a client component for one reason beyond interactivity:
 * the signature is a ~15KB data URI, and passing it as a prop to hundreds of
 * server-rendered rows would serialise it hundreds of times. Here it is received
 * once and handed to each letter by reference, so the page stays light.
 */
export interface WorklistItem {
  readonly id: string;
  /** The saved lead, with its homeowner letter refreshed for the current wording. */
  readonly lead: SourcedLead;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export function WorklistLeads({ items, signature }: { items: readonly WorklistItem[]; signature: string }) {
  return (
    <ul className="mt-4 space-y-4">
      {items.map((entry) => (
        <li key={entry.id} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="font-display text-base text-ink-100">{entry.lead.label}</p>
            <p className="font-mono text-xs">
              <span className={entry.lead.strength === "strong" ? "text-emerald-300" : "text-ink-400"}>
                {entry.lead.strength}
              </span>
              {entry.lead.postcode !== undefined && (
                <>
                  <span className="text-ink-600"> · </span>
                  <span className="text-ink-300 tabular-nums">{entry.lead.postcode}</span>
                </>
              )}
            </p>
          </div>
          {entry.lead.propertyAddress !== undefined && (
            <p className="mt-1 text-sm font-medium text-ink-100">{entry.lead.propertyAddress}</p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-ink-300">{entry.lead.summary}</p>
          <p className="mt-3 border-l-2 border-ink-700 pl-3 text-sm leading-relaxed text-ink-400">
            <span className="text-ink-300">Lawful next step.</span> {entry.lead.lawfulNextStep}
          </p>

          {entry.lead.letterDraft !== undefined && (
            <PrintLetter lead={entry.lead} signatureUrl={signature} />
          )}
          {entry.lead.postcode !== undefined && <StartDealForm lead={entry.lead} />}

          <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ink-600">
            first seen {entry.firstSeenAt.slice(0, 10)} · last seen {entry.lastSeenAt.slice(0, 10)}
          </p>
          <DismissForm id={entry.id} />
        </li>
      ))}
    </ul>
  );
}
