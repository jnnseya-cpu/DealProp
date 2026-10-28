import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { getSource } from "@shared/domain/sources";
import { sourcingReadiness } from "@backend/discovery/sourcingRun";
import { listContactedLeads, listSourcedProperties } from "@backend/store/repository";
import type { LeadSignal, ReadinessState } from "@shared/domain/sourcedLead";
import { signalCoverage } from "@shared/domain/sourcingSignals";
import { SourcingRun } from "./SourcingRun";
import { OPERATOR_SIGNATURE } from "@/app/components/signature";
import { WorklistLeads, type WorklistItem } from "./WorklistLeads";
import { ContactedLeads, type ContactedRow } from "./ContactedLeads";
import { companyIdentity } from "@shared/domain/identity";
import { draftHomeownerLetter } from "@shared/domain/homeownerLetter";

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
  const contacted = await listContactedLeads();
  const contactedKeys = new Set(contacted.map((c) => c.key));

  // Active worklist excludes both what a person set aside and what a letter has
  // already gone to — the latter keyed by the property's id (its address key).
  const active = worklist.filter((p) => p.dismissed === undefined && !contactedKeys.has(p.id));
  const setAside = worklist.filter((p) => p.dismissed !== undefined).length;

  // The contacted list spans all three doors. For a prepared-but-unsold property
  // the worklist still holds its address to show; a probate or insolvency notice
  // is keyed by its public URL and nothing else is stored, so that URL is all
  // there is to show — which is exactly the point.
  const CONTACTED_TITLE: Record<LeadSignal, string> = {
    "prepared-but-unsold": "Prepared for sale, never sold",
    "probate-notice": "Probate (deceased estate)",
    "owner-insolvent": "Owner in insolvency",
    "negative-equity": "Possible negative equity",
  };
  const worklistById = new Map(worklist.map((p) => [p.id, p]));
  const contactedRows: readonly ContactedRow[] = contacted.map((c) => {
    const address = worklistById.get(c.key)?.lead.propertyAddress;
    const isNotice = /^https?:\/\//i.test(c.key);
    return {
      key: c.key,
      signalKey: c.signalKey,
      contactedAt: c.contactedAt,
      by: c.by,
      title: CONTACTED_TITLE[c.signalKey],
      ...(address !== undefined ? { address } : {}),
      ...(isNotice ? { noticeUrl: c.key } : {}),
    };
  });

  // One signature source for the whole page (env override, else the baked default).
  const signature = process.env.LETTER_SIGNATURE_URL || OPERATOR_SIGNATURE;

  // Refresh each worklist row's homeowner letter from the stored property facts,
  // so rows saved before the letter existed — and all rows after a wording change
  // — carry a current letter, to "The Homeowner" at the property. Only where there
  // is an address to write to.
  const sender = companyIdentity(process.env);
  const today = new Date().toISOString().slice(0, 10);
  const worklistItems: readonly WorklistItem[] = active.map((entry) => {
    const address = entry.lead.propertyAddress;
    const letter =
      address !== undefined && address !== ""
        ? draftHomeownerLetter({
            sender,
            propertyAddress: address,
            ...(entry.lead.postcode !== undefined && entry.lead.postcode !== ""
              ? { postcode: entry.lead.postcode }
              : {}),
            today,
          })
        : undefined;
    return {
      id: entry.id,
      lead: letter !== undefined ? { ...entry.lead, letterDraft: letter } : entry.lead,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
    };
  });

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

        <SourcingRun signatureUrl={signature} />

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
            <WorklistLeads items={worklistItems} signature={signature} />
          </section>
        )}

        {contactedRows.length > 0 && (
          <section className="mt-12">
            <h2 className="eyebrow">
              Contacted — {contactedRows.length} suppressed from future searches
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
              A letter has been printed for each of these, so they are kept out of the three sourcing
              doors to stop a second approach. Only the property reference is held — never the
              person. Restore any one to let it surface again on the next run.
            </p>
            <ContactedLeads items={contactedRows} />
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
