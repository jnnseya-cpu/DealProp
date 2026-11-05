import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Badge } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { listAgentRuns } from "@backend/store/repository";
import { agentPause } from "@backend/agentControls";
import { anyAgentPaused, describePause } from "@shared/domain/agentControls";
import { needsAttention } from "@shared/domain/agentRun";
import type { AgentRunKind, AgentRunRecord, AgentRunState } from "@shared/domain/agentRun";
import { acknowledgeRunAction } from "@/app/operator/agents/actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Agent runs — Lode" };

/**
 * The agent Control Room (spec §20.12, reading the §20.5 ledger).
 *
 * Every agent execution — the live analysis runtime, the intake qualification
 * seam, in time the deterministic observers — leaves a durable record of that
 * it ran, how it ended, and why. This is where a person reads them: what is
 * waiting for a human, what failed, what a run cost in tool calls and time, and
 * which runs were superseded by a newer read of the same subject. It is a read
 * surface only — the ledger is written by the runs themselves, never here.
 */

const STATE: Record<AgentRunState, { label: string; tone: "neutral" | "accent" | "good" | "warn" | "bad" }> = {
  running: { label: "Running", tone: "accent" },
  validating: { label: "Validating", tone: "accent" },
  succeeded: { label: "Succeeded", tone: "good" },
  "awaiting-human": { label: "Awaiting a person", tone: "warn" },
  "awaiting-data": { label: "Awaiting data", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

const KIND: Record<AgentRunKind, string> = {
  "live-analysis": "Live analysis",
  "intake-qualification": "Intake",
  deterministic: "Deterministic",
};

function duration(run: AgentRunRecord): string {
  if (run.finishedAt === undefined) return "—";
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default async function AgentRunsPage() {
  await requirePermission("view-audit-log", "/operator/agents");
  const runs = (await listAgentRuns()).slice(0, 100);
  const pause = agentPause();

  const waiting = runs.filter(needsAttention).length;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/agents" />} />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <span className="eyebrow">Agent runs</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {runs.length === 0 ? "No runs recorded yet" : `${runs.length} recent runs`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          A durable record of every agent execution — what it ran over, how it ended and why. Agents
          propose and draft; a figure here is a tool&rsquo;s, never the model&rsquo;s.
          {waiting > 0 && (
            <>
              {" "}
              <span className="text-amber-300/90">{waiting} {waiting === 1 ? "run is" : "runs are"} waiting for a person.</span>
            </>
          )}
        </p>

        {anyAgentPaused(pause) && (
          <p className="mt-6 border-l-2 border-amber-400/70 py-1 pl-4 text-[13px] leading-[1.6] text-amber-200/90">
            {describePause(pause)} Model-backed runs will not execute until the <code className="text-ink-300">AGENTS_PAUSED</code> environment
            value is cleared and the app is recreated. Deterministic figures are unaffected.
          </p>
        )}

        {runs.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            No agent runs recorded. Start a seller intake chat or run a live deal analysis to see
            entries appear.
          </p>
        ) : (
          <div className="mt-10 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b hairline text-xs uppercase tracking-[0.1em] text-ink-500">
                  <th className="py-2 pr-4 font-normal">When</th>
                  <th className="py-2 pr-4 font-normal">Agent</th>
                  <th className="py-2 pr-4 font-normal">Subject</th>
                  <th className="py-2 pr-4 font-normal">State</th>
                  <th className="py-2 font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const state = STATE[r.state];
                  return (
                    <tr key={r.id} className="border-b border-ink-800/60 align-top">
                      <td className="tnum py-2.5 pr-4 text-xs text-ink-400">
                        {r.startedAt.replace("T", " ").slice(0, 19)}
                        <span className="block text-ink-600">{duration(r)}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-ink-300">
                        {r.agentId}
                        <span className="block text-xs text-ink-500">
                          {KIND[r.kind]} · {r.autonomy}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-ink-400">
                        {r.subjectType}
                        <span className="block text-ink-500">{r.subjectId.slice(0, 8)}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={state.tone}>{state.label}</Badge>
                        {r.repairAttempted && (
                          <span className="mt-1 block text-[11px] text-ink-500">schema repaired</span>
                        )}
                      </td>
                      <td className="py-2.5 text-ink-300">
                        {r.summary !== "" ? r.summary : <span className="text-ink-600">—</span>}
                        {r.reasonCodes.length > 0 && (
                          <span className="mt-1 block text-xs text-amber-300/80">{r.reasonCodes.join(", ")}</span>
                        )}
                        {r.errorCode !== undefined && (
                          <span className="mt-1 block text-xs text-red-300/80">{r.errorCode}</span>
                        )}
                        {r.model !== "none" && r.model !== "" && (
                          <span className="mt-1 block text-[11px] text-ink-600">
                            {r.provider}/{r.model}
                            {r.toolCalls > 0 && ` · ${r.toolCalls} tool ${r.toolCalls === 1 ? "call" : "calls"}`}
                            {(r.inputTokens ?? 0) + (r.outputTokens ?? 0) > 0 &&
                              ` · ${(r.inputTokens ?? 0) + (r.outputTokens ?? 0)} tokens`}
                          </span>
                        )}
                        {r.acknowledgedAt !== undefined && (
                          <span className="mt-1 block text-[11px] text-emerald-300/80">
                            ✓ Acknowledged by {r.acknowledgedByName ?? "a person"}
                          </span>
                        )}
                        {needsAttention(r) && (
                          <form action={acknowledgeRunAction} className="mt-2 flex items-center gap-2">
                            <input type="hidden" name="runId" value={r.id} />
                            <input
                              type="text"
                              name="note"
                              required
                              maxLength={2000}
                              placeholder="Who's handling it, and how"
                              className="h-7 min-w-0 flex-1 rounded-md border hairline bg-surface-2 px-2 text-xs text-ink-100 placeholder:text-ink-600"
                            />
                            <button
                              type="submit"
                              className="h-7 shrink-0 rounded-md border hairline bg-surface-2 px-2.5 text-xs text-ink-200 transition-colors hover:border-ink-600 hover:bg-surface-3"
                            >
                              Acknowledge
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
