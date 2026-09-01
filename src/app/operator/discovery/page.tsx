import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { requirePermission } from "@/app/operator/guard";
import { listDiscoveryCandidates } from "@backend/store/repository";
import { getSource } from "@shared/domain/sources";
import { CandidateActions } from "./CandidateActions";
import { RunForm } from "./RunForm";
import type { VerificationStatus } from "@shared/domain/outreach";

export const dynamic = "force-dynamic";

export const metadata = { title: "Funder discovery — Lode" };

/**
 * Funders found by discovery, and what was done about each.
 *
 * Every candidate arrives quarantined and stays there until a named person
 * approves it. The page shows the evidence rather than a score: which official
 * records were checked, what the organisation published about itself, and —
 * the part that is usually hidden — what was found and deliberately *not*
 * taken, with the reason. A reviewer needs to see that the page was read
 * properly, not wonder whether the extractor simply missed something.
 */
const STATUS_TONE: Record<VerificationStatus, string> = {
  VERIFIED: "text-emerald-300",
  PARTIALLY_VERIFIED: "text-amber-300",
  STALE: "text-amber-300",
  CONFLICTING: "text-red-300",
  REJECTED: "text-red-300",
  UNVERIFIED: "text-ink-400",
};

export default async function DiscoveryPage() {
  await requirePermission("manage-mandates", "/operator/discovery");
  const candidates = await listDiscoveryCandidates();

  const approved = candidates.filter((c) => c.approvedAt !== undefined).length;
  const suppressed = candidates.filter((c) => c.candidate.doNotContact || c.candidate.optedOut).length;

  const licensed = ["companies-house", "fca-register", "funder-own-website"]
    .map((key) => getSource(key))
    .filter((s) => s !== undefined);
  const refused = ["linkedin-profiles", "inferred-contacts"]
    .map((key) => getSource(key))
    .filter((s) => s !== undefined);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/capital" className="transition hover:text-ink-100">Capital</Link>
            <Link href="/operator/discovery" className="text-ink-100">Discovery</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">
          Funder discovery
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {candidates.length === 0
            ? "Nothing discovered yet"
            : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"}, ${approved} approved`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Every candidate is quarantined until a named person approves it. Nothing is sent from this
          page — approval records that this organisation may be written to, and the outreach gate
          still decides whether a particular message to them would be lawful.
        </p>

        <RunForm />

        <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">
            What may be read, and what may not
          </h2>
          <ul className="mt-4 space-y-3">
            {licensed.map((source) => (
              <li key={source?.key} className="text-sm leading-relaxed">
                <span className="text-emerald-300">Licensed</span>
                <span className="text-ink-600"> · </span>
                <span className="text-ink-200">{source?.name}</span>
                <span className="block text-xs text-ink-500">{source?.provides}</span>
              </li>
            ))}
            {refused.map((source) => (
              <li key={source?.key} className="text-sm leading-relaxed">
                <span className="text-red-300">Refused</span>
                <span className="text-ink-600"> · </span>
                <span className="text-ink-200">{source?.name}</span>
                <span className="block text-xs text-ink-500">{source?.unlicensedReason}</span>
              </li>
            ))}
          </ul>
        </section>

        {candidates.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm leading-relaxed text-ink-400">
            No discovery run has been made. A run takes organisations you name — from a trade
            directory, a referral or a spreadsheet — and confirms each against Companies House and
            the FCA Register, then reads the mandate they published themselves. It does not go
            looking on its own: no source is licensed for harvesting the web, so the input is a list
            rather than a search.
          </p>
        ) : (
          <>
            {suppressed > 0 && (
              <p className="mt-6 text-sm leading-relaxed text-ink-400">
                {suppressed} suppressed. Suppression survives a rerun and is not something an
                approval overrides.
              </p>
            )}

            <ul className="mt-10 space-y-5">
              {candidates.map(({ candidate, notes, approvedAt, approvedBy }) => (
                <li key={candidate.id} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <p className="font-display text-lg text-ink-100">{candidate.organisationName}</p>
                    <p className="font-mono text-xs">
                      <span className={STATUS_TONE[candidate.status]}>{candidate.status}</span>
                      <span className="text-ink-600"> · </span>
                      <span className="text-ink-400">{candidate.recipientType}</span>
                    </p>
                  </div>

                  <dl className="mt-4 space-y-1 text-sm">
                    {candidate.domain !== undefined && (
                      <Fact label="Domain" value={candidate.domain.value} source={candidate.domain.provenance.sourceKey} />
                    )}
                    {candidate.companyNumber !== undefined && (
                      <Fact label="Company" value={candidate.companyNumber.value} source={candidate.companyNumber.provenance.sourceKey} />
                    )}
                    {candidate.publishedEmail !== undefined && (
                      <Fact label="Published address" value={candidate.publishedEmail.value} source={candidate.publishedEmail.provenance.sourceKey} />
                    )}
                    {candidate.mandateSummary !== undefined && (
                      <Fact label="Their words" value={`“${candidate.mandateSummary.value}”`} source={candidate.mandateSummary.provenance.sourceKey} />
                    )}
                  </dl>

                  {candidate.warningFlags.length > 0 && (
                    <p className="mt-3 text-sm leading-relaxed text-red-300">
                      {candidate.warningFlags.join("; ")}
                    </p>
                  )}

                  <details className="mt-4">
                    <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-ink-500">
                      What was checked, and what was not taken
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {notes.map((note, i) => (
                        <li key={`${candidate.id}-${i}`} className="text-xs leading-relaxed text-ink-400">
                          {note}
                        </li>
                      ))}
                    </ul>
                  </details>

                  {approvedAt !== undefined ? (
                    <p className="mt-4 text-sm text-emerald-300">
                      Approved by {approvedBy} on {approvedAt.slice(0, 10)}.
                    </p>
                  ) : (
                    <CandidateActions
                      candidateId={candidate.id}
                      canApprove={candidate.status === "VERIFIED"}
                      suppressed={candidate.doNotContact || candidate.optedOut}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function Fact({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-200">
        {value}
        <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-ink-600">
          {source}
        </span>
      </dd>
    </div>
  );
}
