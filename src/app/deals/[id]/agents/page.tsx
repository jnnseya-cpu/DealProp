import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel, SiteHeader } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { runAgentsForDeal } from "@backend/agents/service";
import {
  decisionFor,
  FORBIDDEN_ACTS,
  type AgentOutcome,
  type AgentProposal,
  type Severity,
} from "@shared/domain/agents";
import { DecisionForm } from "./DecisionForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Agents — Lode" };

/**
 * The agent board for one deal.
 *
 * Nine agents, each of which either has something to say or says why it has
 * not. Dormancy is shown as prominently as a finding: an agent that is quiet
 * because the deal is clean and an agent that is quiet because it has never
 * been reached look identical from the outside, and only the second one is a
 * problem.
 *
 * Nothing on this page has happened. Every card is a proposal with a person's
 * name still missing from it.
 */
export default async function AgentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/agents`);
  const result = await runAgentsForDeal(id);
  if (result === undefined) notFound();

  const { record, run, decisions } = result;
  const named = viewerAccount(viewer);

  await audit("agents-run", {
    ...(named !== undefined ? { account: named } : {}),
    subject: record.id,
    detail: `${run.outcomes.filter((o) => o.fired).length} of ${run.outcomes.length} agents fired, ${run.proposals.length} proposals, ${run.blockers} blocking`,
  });

  const undecided = run.proposals.filter((p) => decisionFor(decisions, p.key) === undefined);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href={`/deals/${record.id}`} className="transition hover:text-ink-100">Deal Room</Link>
            <Link href={`/deals/${record.id}/funding`} className="transition hover:text-ink-100">Funding</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">
          Agents · {record.reference}
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {undecided.length === 0
            ? "Nothing is waiting on a decision."
            : `${undecided.length} proposal${undecided.length === 1 ? "" : "s"} waiting on a person.`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-400">
          {run.blockers > 0
            ? `${run.blockers} of them would stop this deal going to a funder. `
            : ""}
          Every figure below was computed by the same engines the Deal Room reads. No agent has
          acted on any of it, and none of them can — they draft and they rank, and a named person
          decides.
        </p>

        {undecided.length > 0 && (
          <div className="mt-10 space-y-5">
            {undecided.map((proposal) => (
              <ProposalCard key={proposal.key} dealId={record.id} proposal={proposal} />
            ))}
          </div>
        )}

        <h2 className="mt-16 font-display text-[21px] leading-tight text-ink-100">The nine agents</h2>
        <div className="mt-6 space-y-3">
          {run.outcomes.map((outcome) => (
            <AgentRow
              key={outcome.agent.id}
              outcome={outcome}
              decided={outcome.proposals.filter(
                (p) => decisionFor(decisions, p.key) !== undefined,
              ).length}
            />
          ))}
        </div>

        {decisions.length > 0 && (
          <Panel className="mt-12" eyebrow="Recorded" title="What people decided">
            <ul className="space-y-4">
              {decisions.map((decision) => (
                <li key={decision.id} className="border-b hairline pb-4 last:border-0 last:pb-0">
                  <p className="text-sm leading-relaxed text-ink-200">
                    <span
                      className={
                        decision.decision === "accepted" ? "text-emerald-300" : "text-ink-400"
                      }
                    >
                      {decision.decision === "accepted" ? "Accepted" : "Dismissed"}
                    </span>{" "}
                    — {decision.proposalHeadline}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-400">{decision.note}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-600">
                    {decision.byName} · {decision.at.slice(0, 16).replace("T", " ")} ·{" "}
                    {decision.proposalKey}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel className="mt-12" eyebrow="Limits" title="What no agent may do">
          <ul className="space-y-3">
            {Object.entries(FORBIDDEN_ACTS).map(([act, why]) => (
              <li key={act} className="text-sm leading-relaxed text-ink-400">
                <span className="font-mono text-[11px] text-ink-500">{act}</span> — {why}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            These are enforced by the shape of the code rather than by policy. Accepting a proposal
            can record a review, a selection or a sign-off, or adopt the standard conditions plan at
            &ldquo;not started&rdquo;. There is no other effect for an agent to reach for.
          </p>
        </Panel>

        <p className="mt-10 font-mono text-[11px] leading-relaxed text-ink-600">
          {run.version} · deterministic · run at {run.at.slice(0, 16).replace("T", " ")}
        </p>
      </div>
    </main>
  );
}

const SEVERITY: Record<Severity, { label: string; border: string; text: string }> = {
  blocker: { label: "Blocker", border: "border-red-500/30", text: "text-red-300" },
  action: { label: "Action", border: "border-amber-500/30", text: "text-amber-300" },
  watch: { label: "Watch", border: "border-lode-500/30", text: "text-lode-300" },
};

function ProposalCard({ dealId, proposal }: { dealId: string; proposal: AgentProposal }) {
  const tone = SEVERITY[proposal.severity];

  return (
    <article className={`rounded-2xl border ${tone.border} bg-surface-1 px-5 py-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${tone.text}`}>
          {tone.label} · {proposal.agentId}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-600">
          {proposal.humanControl}
        </span>
      </div>

      <h3 className="mt-3 font-display text-lg leading-snug text-ink-100">{proposal.headline}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-300">{proposal.detail}</p>

      <details className="mt-4">
        <summary className="cursor-pointer eyebrow transition hover:text-ink-300">
          Where this came from
        </summary>
        <ul className="mt-3 space-y-1">
          {proposal.evidence.map((line) => (
            <li key={line} className="font-mono text-[11px] leading-relaxed text-ink-500">
              {line}
            </li>
          ))}
        </ul>
        {proposal.assumptions.length > 0 && (
          <ul className="mt-3 space-y-1">
            {proposal.assumptions.map((line) => (
              <li key={line} className="text-[12px] leading-relaxed text-ink-500">
                Assumes: {line}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-[11px] text-ink-600">
          {proposal.engine} · {proposal.version} · confidence: {proposal.confidence}
        </p>
      </details>

      <DecisionForm
        dealId={dealId}
        proposalKey={proposal.key}
        acceptLabel={proposal.action.label}
      />
    </article>
  );
}

function AgentRow({ outcome, decided }: { outcome: AgentOutcome; decided: number }) {
  const open = outcome.proposals.length - decided;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border hairline bg-ink-900/20 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm text-ink-100">{outcome.agent.name}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">
          {outcome.dormantReason ?? outcome.agent.output}
        </p>
        <p className="mt-1 font-mono text-[11px] text-ink-600">
          Triggers: {outcome.agent.trigger} · {outcome.agent.humanControl}
        </p>
      </div>
      <span
        className={`shrink-0 font-mono text-[11px] ${
          open > 0 ? "text-amber-300" : outcome.fired ? "text-emerald-300" : "text-ink-600"
        }`}
      >
        {open > 0 ? `${open} open` : outcome.fired ? "clear" : "dormant"}
      </span>
    </div>
  );
}
