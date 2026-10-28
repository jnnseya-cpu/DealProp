"use client";

import { useActionState } from "react";
import { runAreaAction, runRegistersAction, type SourcingResult } from "./actions";
import { PrintLetter } from "./PrintLetter";
import { StartDealForm } from "./StartDealForm";
import type { FlipEvidence, SourcedLead } from "@shared/domain/sourcedLead";
import { gbp, percent } from "@shared/format";
import { bps } from "@shared/money";

/**
 * Two run paths, side by side, and the leads they produce.
 *
 * Neither contacts anyone. A lead is something a named person investigates, and
 * the lawful next step travels with it — confirm the owner on the title, screen,
 * record the assessment, write by post. There is no "approach" button, because
 * the automated-outreach version of this is the unlawful one.
 */
export function SourcingRun({ signatureUrl }: { signatureUrl?: string }) {
  const [area, runArea, runningArea] = useActionState<SourcingResult | undefined, FormData>(
    runAreaAction,
    undefined,
  );
  const [registers, runRegisters, runningRegisters] = useActionState<SourcingResult | undefined, FormData>(
    runRegistersAction,
    undefined,
  );

  return (
    <>
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <form action={runArea} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">Search an area for prepared-but-unsold</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            Enter a <span className="text-ink-100">postcode</span> for an exact search, or a{" "}
            <span className="text-ink-100">council name</span> (e.g. Birmingham) to sweep the whole
            city. The EPC register and Land Registry Price Paid are joined on the address: a
            certificate lodged with no sale registered since is a property prepared for sale that
            never sold — which no portal publishes. Open data, no bulk file to download.
          </p>

          <label className="mt-4 block text-xs text-ink-500" htmlFor="postcode">
            Postcode or council
          </label>
          <input
            id="postcode"
            name="postcode"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="B29 6AD  ·  or  ·  Birmingham"
            className="mt-1.5 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100"
          />

          <button
            type="submit"
            disabled={runningArea}
            className="mt-4 inline-flex h-9.5 items-center justify-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
          >
            {runningArea ? "Searching…" : "Search"}
          </button>

          {area !== undefined && (
            <>
              <p className={`mt-4 text-sm leading-relaxed ${area.ok ? "text-emerald-300" : "text-amber-300"}`} role="status">
                {area.message}
              </p>
              {area.notes.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {area.notes.map((note, i) => (
                    <li key={i} className="font-mono text-[11px] leading-relaxed text-ink-500">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </form>

        <form action={runRegisters} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">Fetch the public registers</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            The Gazette's deceased-estates and personal-insolvency notices, read through the Fetcher
            under the Open Government Licence. These are the root-cause motivation signals — probate
            and insolvency — at source, not a listing tag. Every one carries heightened protection.
          </p>

          <button
            type="submit"
            disabled={runningRegisters}
            className="mt-4 inline-flex h-9.5 items-center justify-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
          >
            {runningRegisters ? "Fetching…" : "Fetch register notices"}
          </button>

          {registers !== undefined && (
            <>
              <p className={`mt-4 text-sm leading-relaxed ${registers.ok ? "text-emerald-300" : "text-amber-300"}`} role="status">
                {registers.message}
              </p>
              {registers.notes.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {registers.notes.map((note, i) => (
                    <li key={i} className="font-mono text-[11px] leading-relaxed text-ink-500">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </form>
      </div>

      <Leads
        leads={[...(area?.leads ?? []), ...(registers?.leads ?? [])]}
        {...(signatureUrl !== undefined ? { signatureUrl } : {})}
      />
      <Flips flips={area?.flips ?? []} />
    </>
  );
}

function Flips({ flips }: { flips: readonly FlipEvidence[] }) {
  if (flips.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="eyebrow">Finished values nearby — market evidence, not leads</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
        A refurbishment someone else already completed and sold on. It evidences what the street
        actually pays for a finished property, from a registered sale rather than an asking price.
      </p>
      <ul className="mt-4 space-y-3">
        {flips.map((flip, i) => (
          <li
            key={`${flip.addressKey}-${i}`}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-2xl border hairline bg-surface-1 px-5 py-3"
          >
            <p className="text-sm text-ink-200 tabular-nums">
              {flip.postcode} · bought {gbp(flip.boughtFor)} ({flip.boughtAt.slice(0, 7)}) → sold{" "}
              {gbp(flip.soldFor)} ({flip.soldAt.slice(0, 7)})
            </p>
            <p className="font-mono text-xs text-emerald-300 tabular-nums">
              +{percent(bps(flip.upliftBps))} gross · {flip.monthsHeld}mo
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Leads({ leads, signatureUrl }: { leads: readonly SourcedLead[]; signatureUrl?: string }) {
  if (leads.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="eyebrow">{leads.length} lead{leads.length === 1 ? "" : "s"} to investigate</h2>
      <ul className="mt-4 space-y-4">
        {leads.map((lead, i) => (
          <li key={`${lead.signalKey}-${lead.addressKey ?? lead.postcode ?? i}`} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="font-display text-base text-ink-100">{lead.label}</p>
              <p className="font-mono text-xs">
                <span className={lead.strength === "strong" ? "text-emerald-300" : "text-ink-400"}>{lead.strength}</span>
                {lead.postcode !== undefined && (
                  <>
                    <span className="text-ink-600"> · </span>
                    <span className="text-ink-300 tabular-nums">{lead.postcode}</span>
                  </>
                )}
              </p>
            </div>

            {lead.propertyAddress !== undefined && (
              <p className="mt-1 text-sm font-medium text-ink-100">{lead.propertyAddress}</p>
            )}

            <p className="mt-3 text-sm leading-relaxed text-ink-300">{lead.summary}</p>

            {lead.heightenedProtection && (
              <p className="mt-3 border-l-2 border-amber-400/70 pl-3 text-sm leading-relaxed text-amber-200">
                Heightened protection. This is a sign of vulnerability, so it raises the bar to make
                contact rather than lowering it.
              </p>
            )}

            {lead.letterDraft !== undefined && (
              <PrintLetter lead={lead} {...(signatureUrl !== undefined ? { signatureUrl } : {})} />
            )}

            {(lead.signalKey === "probate-notice" || lead.signalKey === "prepared-but-unsold") &&
              lead.postcode !== undefined && <StartDealForm lead={lead} />}

            <p className="mt-3 border-l-2 border-ink-700 pl-3 text-sm leading-relaxed text-ink-400">
              <span className="text-ink-300">Lawful next step.</span> {lead.lawfulNextStep}
            </p>

            <p className="mt-3 flex flex-wrap items-center gap-x-3 font-mono text-[10px] uppercase tracking-wider text-ink-600">
              <span>
                {lead.provenance.sourceKey} · as of {lead.provenance.asOf.slice(0, 10)}
              </span>
              {lead.sourceUrl !== undefined && (
                <a
                  href={lead.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-lode-300 underline-offset-2 hover:underline"
                >
                  Open the notice →
                </a>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
