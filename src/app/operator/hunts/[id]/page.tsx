import { notFound } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Stat } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import {
  getComparableBundle,
  getDealHuntRun,
  listDealHuntResults,
} from "@backend/store/repository";
import { gbp, percent } from "@shared/format";
import { sourcePermits } from "@shared/domain/sources";
import { buildAppraisalSeed } from "@shared/domain/dealHuntHandoff";
import type { DealHuntResult, DealHuntRunState } from "@shared/domain/dealHuntRun";
import type { StoredComparableBundle } from "@backend/store/schema";
import { openAppraisalAction } from "@/app/operator/hunts/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal Hunt — Lode" };

const STATE_TONE: Record<DealHuntRunState, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  queued: "neutral",
  searching: "accent",
  enriching: "accent",
  completed: "good",
  partial: "warn",
  failed: "bad",
  cancelled: "neutral",
};

function EvidenceLine({ bundle }: { bundle: StoredComparableBundle | undefined }) {
  if (bundle === undefined) {
    return <p className="text-[12px] text-ink-500">No comparable evidence bundle.</p>;
  }
  const c = bundle.bundle.coverage;
  const parts = [
    `Sold: ${c.soldCount}${c.soldThin ? " (thin)" : ""}`,
    c.rentUnavailable
      ? "Rent: unavailable"
      : `Rent: ${c.advertisedRentCount} advertised, ${c.agreedRentCount} agreed`,
  ];
  return <p className="text-[12px] text-ink-500">{parts.join(" · ")}</p>;
}

function Handoff({ result, runId, investorId }: { result: DealHuntResult; runId: string; investorId: string }) {
  if (result.appraisalDraftId === undefined) {
    return (
      <form action={openAppraisalAction} className="mt-3">
        <input type="hidden" name="resultId" value={result.id} />
        <input type="hidden" name="runId" value={runId} />
        <button
          type="submit"
          className="h-7 rounded-md border hairline bg-surface-2 px-2.5 text-xs text-ink-200 transition-colors hover:border-ink-600 hover:bg-surface-3"
        >
          Open appraisal
        </button>
      </form>
    );
  }
  // Linked: recompute the seed to surface withheld/stale at the moment of view.
  const seed = buildAppraisalSeed({ investorId, result, entitled: (k) => sourcePermits(k, "display") });
  return (
    <div className="mt-3 border-l-2 border-[color:var(--accent)] py-1 pl-3">
      <p className="text-[12px] text-ink-300">
        Appraisal draft linked: <span className="font-mono text-ink-200">{result.appraisalDraftId}</span>
      </p>
      {seed.withheldSources.length > 0 && (
        <p className="mt-1 text-[12px] text-amber-200/90">
          Evidence withheld (licence not permitting display): {seed.withheldSources.join(", ")}.
        </p>
      )}
      {seed.staleInputs.map((s) => (
        <p key={s} className="mt-1 text-[12px] text-amber-200/90">{s}</p>
      ))}
    </div>
  );
}

function ResultRow({
  result,
  bundle,
  runId,
  investorId,
}: {
  result: DealHuntResult;
  bundle: StoredComparableBundle | undefined;
  runId: string;
  investorId: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-ink-500">#{result.rank}</span>
          <Badge tone={result.reason === "confirmed_fall_through" ? "good" : "neutral"}>
            {result.reason === "confirmed_fall_through" ? "Confirmed fall-through" : "Returned — reason unverified"}
          </Badge>
          {result.stale && <Badge tone="warn">Stale</Badge>}
        </div>
        <span className="font-mono text-[11px] text-ink-600">{result.provenance.join(", ")}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Baseline" value={gbp(result.baselinePence)} size="sm" />
        <Stat label="Current ask" value={gbp(result.currentPence)} size="sm" />
        <Stat label="Reduction" value={gbp(result.dropPence)} size="sm" />
        <Stat label="Drop" value={percent(result.dropBps)} size="sm" />
      </div>

      <ul className="mt-3 space-y-1">
        {result.matchReasons.map((r) => (
          <li key={r} className="text-[12px] leading-relaxed text-ink-400">{r}</li>
        ))}
      </ul>
      <div className="mt-2">
        <EvidenceLine bundle={bundle} />
      </div>
      <Handoff result={result} runId={runId} investorId={investorId} />
    </div>
  );
}

export default async function HuntDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("view-audit-log", "/operator/hunts");
  const { id } = await params;
  const run = await getDealHuntRun(id);
  if (run === undefined) notFound();

  const results = await listDealHuntResults(id);
  const bundles = new Map<string, StoredComparableBundle>();
  for (const r of results) {
    if (r.evidenceBundleId !== undefined) {
      const b = await getComparableBundle(r.evidenceBundleId);
      if (b !== undefined) bundles.set(r.id, b);
    }
  }

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/hunts" />} />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <a href="/operator/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">&larr; All hunts</a>
        <div className="mt-3 flex items-center gap-3">
          <Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>
          <h1 className="font-display text-[26px] leading-tight text-ink-100">
            {run.counts !== undefined ? `${run.counts.eligible} match${run.counts.eligible === 1 ? "" : "es"}` : "Deal Hunt"}
          </h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{run.coverage}</p>
        {run.counts !== undefined && (
          <div className="mt-5 grid grid-cols-3 gap-4">
            <Stat label="Eligible" value={String(run.counts.eligible)} size="sm" />
            <Stat label="Excluded" value={String(run.counts.excluded)} size="sm" />
            <Stat label="Capped" value={run.counts.capped ? "Yes" : "No"} size="sm" />
          </div>
        )}

        {results.length === 0 ? (
          <Panel className="mt-8" eyebrow="Shortlist" title="No qualifying matches">
            <p className="text-sm text-ink-400">{run.coverage}</p>
          </Panel>
        ) : (
          <Panel className="mt-8" flush eyebrow="Shortlist" title={`${results.length} evidenced match${results.length === 1 ? "" : "es"}`}>
            <div className="divide-y divide-ink-800/60">
              {results.map((r) => (
                <ResultRow key={r.id} result={r} bundle={bundles.get(r.id)} runId={run.id} investorId={run.investorId} />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </main>
  );
}
