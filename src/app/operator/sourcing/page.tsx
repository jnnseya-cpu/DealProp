import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { getSource } from "@shared/domain/sources";
import { sourcingReadiness } from "@backend/discovery/sourcingRun";
import { listSourcedProperties } from "@backend/store/repository";
import type { ReadinessState } from "@shared/domain/sourcedLead";
import { signalCoverage } from "@shared/domain/sourcingSignals";
import { SourcingRun } from "./SourcingRun";
import { DismissForm } from "./DismissForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Property sourcing — Lode" };

/**
 * Property sourcing: motivated sellers from licensed registers, not a portal.
 *
 * This is the surface that makes the register adapters reachable. It finds; it
 * does not contact. A run produces leads for a named person to investigate, and
 * the lawful next step — confirm the owner on the title, screen, record the
 * assessment, write by post — travels with each one. The autopilot-outreach
 * version competitors sell is a PECR breach aimed at the vulnerable, and it is
 * absent here by design.
 */

const STATE_TONE: Record<ReadinessState, string> = {
  ready: "text-emerald-300",
  "needs-dataset": "text-amber-300",
  "needs-credential": "text-amber-300",
  "needs-arrangement": "text-ink-400",
};

const STATE_LABEL: Record<ReadinessState, string> = {
  ready: "Ready",
  "needs-dataset": "Needs a dataset",
  "needs-credential": "Needs a credential",
  "needs-arrangement": "Needs an arrangement",
};

export default async function SourcingPage() {
  await requirePermission("manage-mandates", "/operator/sourcing");

  const readiness = sourcingReadiness({
    ...(process.env.EPC_API_KEY !== undefined ? { epcKey: process.env.EPC_API_KEY } : {}),
    ...(process.env.GAZETTE_DECEASED_CODE !== undefined ? { gazetteDeceasedCode: process.env.GAZETTE_DECEASED_CODE } : {}),
    ...(process.env.GAZETTE_INSOLVENCY_CODE !== undefined ? { gazetteInsolvencyCode: process.env.GAZETTE_INSOLVENCY_CODE } : {}),
  });
  const coverage = signalCoverage();
  const refused = getSource("portal-listings");

  const worklist = await listSourcedProperties();
  const active = worklist.filter((p) => p.dismissed === undefined);
  const setAside = worklist.length - active.length;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/sourcing" />} />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Property sourcing</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Motivated sellers, from the registers
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          The root-cause signals — a property prepared for sale that never sold, a deceased estate, an
          owner in insolvency — found at source from licensed open data. No portal, no reseller, no
          scraper. This page <span className="text-ink-100">finds</span>; it does not contact. A run
          produces leads for you to investigate, and the lawful next step travels with each one.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">{coverage.summary}</p>

        <SourcingRun />

        {active.length > 0 && (
          <section className="mt-12">
            <h2 className="eyebrow">
              Worklist — {active.length} propert{active.length === 1 ? "y" : "ies"} found
              {setAside > 0 ? `, ${setAside} set aside` : ""}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
              Property leads saved from a dataset run, kept so a run is a worklist and not a thing you
              do once. Only property facts are stored here — the distress signals (probate, insolvency)
              are shown live and never warehoused.
            </p>
            <ul className="mt-4 space-y-4">
              {active.map((entry) => (
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
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-ink-600">
                    first seen {entry.firstSeenAt.slice(0, 10)} · last seen {entry.lastSeenAt.slice(0, 10)}
                  </p>
                  <DismissForm id={entry.id} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">Source readiness</h2>
          <ul className="mt-4 space-y-3">
            {readiness.map((source) => (
              <li key={source.sourceKey} className="text-sm leading-relaxed">
                <span className={`font-mono text-xs ${STATE_TONE[source.state]}`}>
                  {STATE_LABEL[source.state]}
                </span>
                <span className="text-ink-600"> · </span>
                <span className="text-ink-200">{source.name}</span>
                <span className="block text-xs text-ink-500">{source.detail}</span>
              </li>
            ))}
            {refused !== undefined && (
              <li className="text-sm leading-relaxed">
                <span className="font-mono text-xs text-red-300">Refused</span>
                <span className="text-ink-600"> · </span>
                <span className="text-ink-200">{refused.name}</span>
                <span className="block text-xs text-ink-500">{refused.unlicensedReason}</span>
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
