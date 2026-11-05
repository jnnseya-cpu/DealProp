import { Panel, Badge, Stat } from "@/app/components/chrome";
import { gbp, percent } from "@shared/format";
import { sourcePermits } from "@shared/domain/sources";
import { buildAppraisalSeed } from "@shared/domain/dealHuntHandoff";
import { alignComparison, type ComparisonRun } from "@shared/domain/comparison";
import type { DecisionOutput, DecisionVerdict } from "@shared/domain/decisionOutput";
import type { DealHuntResult, DealHuntRun, DealHuntRunState } from "@shared/domain/dealHuntRun";
import type { WatchCursor } from "@shared/domain/watchCursor";
import type { StoredComparableBundle } from "@backend/store/schema";
import type { HuntDetail } from "@backend/dealHunt/read";
import {
  openAppraisalAction,
  saveSnapshotAction,
  compareAction,
  watchHuntAction,
  runWatchAction,
} from "@/app/operator/hunts/actions";

/**
 * Shared Deal Hunt views, rendered identically on the operator console and the
 * investor surface. `base` is the surface path ("/operator/hunts" or
 * "/invest/hunts") and is threaded into every link and form so an action returns
 * to the surface it was invoked from. One source of truth — the two surfaces
 * cannot drift apart.
 */

export const STATE_TONE: Record<DealHuntRunState, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  queued: "neutral",
  searching: "accent",
  enriching: "accent",
  completed: "good",
  partial: "warn",
  failed: "bad",
  cancelled: "neutral",
};

export const VERDICT_TONE: Record<DecisionVerdict, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  "within-target": "good",
  "below-target": "warn",
  "needs-evidence": "neutral",
  blocked: "bad",
};

function btn(extra = ""): string {
  return `h-7 shrink-0 rounded-md border hairline bg-surface-2 px-2.5 text-xs text-ink-200 transition-colors hover:border-ink-600 hover:bg-surface-3 ${extra}`;
}

export function HuntRunsList({ runs, base }: { runs: readonly DealHuntRun[]; base: string }) {
  if (runs.length === 0) {
    return (
      <p className="mt-3 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
        No hunts yet. Interpret a brief above and run one.
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-ink-800/60 overflow-hidden rounded-2xl border hairline bg-surface-1">
      {runs.map((r) => (
        <li key={r.id}>
          <a href={`${base}/${r.id}`} className="row-hover flex flex-col gap-1.5 px-5 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Badge tone={STATE_TONE[r.state]}>{r.state}</Badge>
                {r.counts !== undefined && (
                  <span className="text-sm text-ink-200">
                    {r.counts.eligible} match{r.counts.eligible === 1 ? "" : "es"}
                    {r.counts.capped ? " (capped)" : ""}
                  </span>
                )}
              </div>
              <span className="text-xs text-ink-600 tabular-nums">{r.createdAt.replace("T", " ").slice(0, 16)}</span>
            </div>
            <p className="text-[13px] text-ink-400">{r.coverage}</p>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function HuntWatchesList({ watches, base }: { watches: readonly WatchCursor[]; base: string }) {
  if (watches.length === 0) return null;
  return (
    <>
      <h2 className="eyebrow mt-12">My watches</h2>
      <ul className="mt-3 divide-y divide-ink-800/60 overflow-hidden rounded-2xl border hairline bg-surface-1">
        {watches.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={w.enabled ? "good" : "neutral"}>{w.enabled ? "active" : "paused"}</Badge>
                <span className="text-sm text-ink-200">{w.dedupeKeys.length} episode{w.dedupeKeys.length === 1 ? "" : "s"} alerted</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-ink-600">query {w.queryId.slice(0, 8)} · since {w.watermark.slice(0, 10)}</p>
            </div>
            <form action={runWatchAction}>
              <input type="hidden" name="watchId" value={w.id} />
              <input type="hidden" name="base" value={base} />
              <button type="submit" className={btn()}>Run now</button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}

function DecisionBlock({ decision }: { decision: DecisionOutput }) {
  const e = decision.economics;
  return (
    <div className="mt-3 rounded-lg border hairline bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <Badge tone={VERDICT_TONE[decision.verdict]}>{decision.verdict.replace("-", " ")}</Badge>
        <span className="text-[13px] text-ink-200">{decision.statement}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Max supported" value={gbp(e.maxSupportedPricePence)} size="sm" />
        <Stat label="Current ask" value={gbp(e.currentAskPence)} size="sm" />
        <Stat label="Headroom" value={gbp(e.headroomPence)} size="sm" warn={Number(e.headroomPence) < 0} />
        <Stat label="Downside" value={gbp(e.downsidePence)} size="sm" />
      </div>
      <p className="mt-3 text-[12px] text-ink-500">
        Coverage: {decision.evidenceCoverage.confirmed} confirmed, {decision.evidenceCoverage.userReported} reported
        {decision.evidenceCoverage.missing.length > 0 && ` · missing: ${decision.evidenceCoverage.missing.join(", ")}`}
      </p>
      {decision.nextCheck !== undefined && <p className="mt-1 text-[12px] text-ink-400">Next check: {decision.nextCheck}</p>}
    </div>
  );
}

function EvidenceLine({ bundle }: { bundle: StoredComparableBundle | undefined }) {
  if (bundle === undefined) return <p className="text-[12px] text-ink-500">No comparable evidence bundle.</p>;
  const c = bundle.bundle.coverage;
  const parts = [
    `Sold: ${c.soldCount}${c.soldThin ? " (thin)" : ""}`,
    c.rentUnavailable ? "Rent: unavailable" : `Rent: ${c.advertisedRentCount} advertised, ${c.agreedRentCount} agreed`,
  ];
  return <p className="text-[12px] text-ink-500">{parts.join(" · ")}</p>;
}

function Handoff({ result, runId, investorId, base }: { result: DealHuntResult; runId: string; investorId: string; base: string }) {
  if (result.appraisalDraftId === undefined) {
    return (
      <form action={openAppraisalAction}>
        <input type="hidden" name="resultId" value={result.id} />
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="base" value={base} />
        <button type="submit" className={btn()}>Open appraisal</button>
      </form>
    );
  }
  const seed = buildAppraisalSeed({ investorId, result, entitled: (k) => sourcePermits(k, "display") });
  return (
    <div className="border-l-2 border-[color:var(--accent)] py-1 pl-3">
      <p className="text-[12px] text-ink-300">
        Appraisal draft linked: <span className="font-mono text-ink-200">{result.appraisalDraftId}</span>
      </p>
      {seed.withheldSources.length > 0 && (
        <p className="mt-1 text-[12px] text-amber-200/90">Evidence withheld (licence not permitting display): {seed.withheldSources.join(", ")}.</p>
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
  decision,
  snapshotSaved,
  runId,
  investorId,
  base,
}: {
  result: DealHuntResult;
  bundle: StoredComparableBundle | undefined;
  decision: DecisionOutput;
  snapshotSaved: boolean;
  runId: string;
  investorId: string;
  base: string;
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

      <DecisionBlock decision={decision} />

      <div className="mt-2">
        <EvidenceLine bundle={bundle} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Handoff result={result} runId={runId} investorId={investorId} base={base} />
        {snapshotSaved ? (
          <span className="text-[12px] text-emerald-300/80">✓ Decision snapshot saved</span>
        ) : (
          <form action={saveSnapshotAction}>
            <input type="hidden" name="resultId" value={result.id} />
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="base" value={base} />
            <button type="submit" className={btn()}>Save decision snapshot</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function HuntShortlist({ detail, base }: { detail: HuntDetail; base: string }) {
  const { run, results, bundles, decisions, snapshotByResult, watched } = detail;
  return (
    <>
      <div className="mt-3 flex items-center gap-3">
        <Badge tone={STATE_TONE[run.state]}>{run.state}</Badge>
        <h1 className="font-display text-[26px] leading-tight text-ink-100">
          {run.counts !== undefined ? `${run.counts.eligible} match${run.counts.eligible === 1 ? "" : "es"}` : "Deal Hunt"}
        </h1>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{run.coverage}</p>

      <div className="mt-4">
        {watched ? (
          <span className="text-[12px] text-emerald-300/80">✓ Watching this search — new qualifying matches alert you</span>
        ) : (
          <form action={watchHuntAction}>
            <input type="hidden" name="runId" value={run.id} />
            <input type="hidden" name="base" value={base} />
            <button type="submit" className={btn()}>Watch this search</button>
          </form>
        )}
      </div>

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
              <ResultRow
                key={r.id}
                result={r}
                bundle={bundles.get(r.id)}
                decision={decisions.get(r.id)!}
                snapshotSaved={snapshotByResult.has(r.id)}
                runId={run.id}
                investorId={run.investorId}
                base={base}
              />
            ))}
          </div>
        </Panel>
      )}

      {results.length >= 2 && (
        <form action={compareAction} className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <input type="hidden" name="runId" value={run.id} />
          <input type="hidden" name="base" value={base} />
          <p className="eyebrow">Compare and decide</p>
          <p className="mt-2 text-[13px] text-ink-400">Select two to four to compare under one shared assumption set.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {results.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-[13px] text-ink-200">
                <input type="checkbox" name="ids" value={r.id} />
                <span className="font-mono text-[11px] text-ink-500">#{r.rank}</span>
                {r.propertyId}
                <Badge tone={VERDICT_TONE[decisions.get(r.id)!.verdict]}>{decisions.get(r.id)!.verdict.replace("-", " ")}</Badge>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <button type="submit" className="h-8 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3">
              Compare selected
            </button>
          </div>
        </form>
      )}
    </>
  );
}

export function ComparisonView({ run }: { run: ComparisonRun }) {
  const cols = alignComparison(run);
  return (
    <>
      <span className="eyebrow mt-3 block">Compare and Decide</span>
      <h1 className="mt-2.5 font-display text-[26px] leading-tight text-ink-100 sm:text-[32px]">
        {cols.length} properties, one assumption set
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">
        Judged under the shared <span className="text-ink-100">{run.sharedAssumptions.strategy}</span> assumptions
        (v{run.sharedAssumptions.version}). Property-specific departures are flagged.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {cols.map((c) => (
          <Panel key={c.propertyId} eyebrow={c.propertyId} title={c.label}>
            <div className="flex items-center gap-2">
              <Badge tone={VERDICT_TONE[c.verdict]}>{c.verdict.replace("-", " ")}</Badge>
              {c.hasOverrides && <Badge tone="warn">has overrides</Badge>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="Max supported" value={gbp(c.maxSupportedPricePence)} size="sm" />
              <Stat label="Current ask" value={gbp(c.currentAskPence)} size="sm" />
              <Stat label="Headroom" value={gbp(c.headroomPence)} size="sm" warn={Number(c.headroomPence) < 0} />
              <Stat label="Downside" value={gbp(c.downsidePence)} size="sm" />
            </div>
            {c.missing.length > 0 && <p className="mt-3 text-[12px] text-ink-500">Missing: {c.missing.join(", ")}</p>}
            {c.nextCheck !== undefined && <p className="mt-1 text-[12px] text-ink-400">Next: {c.nextCheck}</p>}
            {c.overrides.map((o) => (
              <p key={o.field} className="mt-1 text-[12px] text-amber-200/90">{o.field}: {o.value}</p>
            ))}
          </Panel>
        ))}
      </div>
    </>
  );
}
