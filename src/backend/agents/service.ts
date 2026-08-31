import { randomUUID } from "node:crypto";
import { appraise } from "@shared/domain/economics";
import { borrowingReport } from "@shared/domain/borrowing";
import { buildCloseReport, STANDARD_MILESTONES, type Milestone } from "@shared/domain/completion";
import { fundingMetrics } from "@shared/domain/fundingMetrics";
import { fundingReadiness } from "@shared/domain/fundingReadiness";
import { classifyRoute } from "@shared/domain/regulatoryRoute";
import { matchFundingBox, rankMatches } from "@shared/domain/matching";
import { compareRecordedOffers } from "@shared/domain/offers";
import { runDealDirector } from "@shared/domain/director";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import {
  authoriseDecision,
  runAgents,
  type Actor,
  type AgentContext,
  type AgentDecision,
  type AgentProposal,
  type AgentRun,
} from "@shared/domain/agents";
import { operatorPermissions } from "@backend/permissions";
import { audit } from "@backend/audit";
import {
  getDeal,
  listAgentDecisions,
  listFundingBoxes,
  saveAgentDecision,
  saveDeal,
} from "@backend/store/repository";
import type { DealRecord } from "@backend/store/schema";

/**
 * Running the §12 agents over a stored deal, and recording what a person
 * decided about what they said.
 *
 * The context is assembled here, once, from the same engines every other
 * surface reads. That is the point: the Deal Room, the funding page and the
 * agent board cannot show different numbers, because there is only one set.
 *
 * The decision path is deliberately narrow, and narrow in the same way the
 * checkout is. A request from the browser names a deal and a proposal key and
 * nothing else — no effect, no headline, no figures. The agents are re-run on
 * the server, the proposal is looked up in *that* run, and its effect is taken
 * from the definition rather than from the request. A client that could name
 * its own effect could adopt a conditions plan by asking nicely, and validation
 * of a field the client supplies is only ever as good as the validation.
 */

export interface DealAgentRun {
  readonly record: DealRecord;
  readonly run: AgentRun;
  readonly decisions: readonly AgentDecision[];
}

export async function buildAgentContext(
  record: DealRecord,
  decisions: readonly AgentDecision[],
  now: Date = new Date(),
): Promise<AgentContext> {
  const working = toWorkingDeal(record.inputs);
  const briefing = runDealDirector(working.inputs);
  const appraisal = briefing.scored.appraisal;

  const route =
    record.borrowerFacts !== undefined
      ? classifyRoute(record.borrowerFacts, "unregulated-business-lender", operatorPermissions())
      : undefined;

  const evidence = record.evidence ?? {};
  const offers = record.offers ?? [];
  const milestones = record.milestones ?? [];

  const fundingBoxes = await listFundingBoxes();

  return {
    dealId: record.id,
    reference: record.reference,
    status: record.status,
    modelled: working.modelled,
    briefing,
    readiness: fundingReadiness(appraisal, evidence, route),
    metrics: fundingMetrics(appraisal, evidence.committedCash),
    borrowing: borrowingReport(appraisal),
    ...(route !== undefined ? { route } : {}),
    ...(record.borrowerFacts !== undefined ? { borrowerFacts: record.borrowerFacts } : {}),
    evidence,
    offers,
    comparison: compareRecordedOffers(working.inputs, offers),
    funderMatches: rankMatches(
      fundingBoxes
        .filter((b) => b.active)
        .map((b) => matchFundingBox(b, briefing.scored, record.borrowerCompletedDeals)),
    ),
    milestones,
    // No plan, no close report. A close score computed from an empty milestone
    // list is zero, which reads as "nothing done" rather than "not started".
    ...(milestones.length > 0 ? { close: buildCloseReport(milestones) } : {}),
    decisions,
    now,
  };
}

export async function runAgentsForDeal(
  dealId: string,
  now: Date = new Date(),
): Promise<DealAgentRun | undefined> {
  const record = await getDeal(dealId);
  if (record === undefined) return undefined;

  const decisions = await listAgentDecisions(dealId);
  const context = await buildAgentContext(record, decisions, now);
  return { record, run: runAgents(context), decisions };
}

export interface DecisionRequest {
  readonly dealId: string;
  readonly proposalKey: string;
  readonly decision: "accepted" | "dismissed";
  readonly note: string;
  readonly actor: Actor;
}

export interface DecisionOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export async function decideProposal(request: DecisionRequest): Promise<DecisionOutcome> {
  const authorisation = authoriseDecision(request.actor, request.note);
  if (!authorisation.ok) return { ok: false, message: authorisation.reason };
  // Narrowed by `authoriseDecision`, which refuses anything but a named
  // account. Repeated here so the narrowing is visible rather than implied.
  if (request.actor.kind !== "account") return { ok: false, message: authorisation.reason };

  const current = await runAgentsForDeal(request.dealId);
  if (current === undefined) return { ok: false, message: "No such deal." };

  const proposal = current.run.proposals.find((p) => p.key === request.proposalKey);
  if (proposal === undefined) {
    return {
      ok: false,
      message:
        "That proposal is no longer being made. The deal has changed since the page was loaded — reload it and look at what the agents say now.",
    };
  }

  const at = new Date().toISOString();
  const decision: AgentDecision = {
    id: randomUUID(),
    dealId: request.dealId,
    agentId: proposal.agentId,
    proposalKey: proposal.key,
    decision: request.decision,
    byAccountId: request.actor.id,
    byName: request.actor.name,
    note: request.note.trim(),
    at,
    proposalHeadline: proposal.headline,
    effect: proposal.action.effect,
  };

  if (request.decision === "accepted") {
    await applyEffect(current.record, proposal);
  }

  await saveAgentDecision(decision);
  await audit(request.decision === "accepted" ? "agent-proposal-accepted" : "agent-proposal-dismissed", {
    account: { id: request.actor.id, email: request.actor.email },
    subject: request.dealId,
    detail: `${proposal.agentId} · ${proposal.key} · ${proposal.headline} — ${decision.note}`,
  });

  return {
    ok: true,
    message:
      request.decision === "accepted"
        ? `Recorded against ${request.actor.name}.`
        : `Dismissed, with your reason, against ${request.actor.name}.`,
  };
}

/**
 * The only thing accepting a proposal writes to the deal.
 *
 * Three of the four effects record a human judgement and change nothing else;
 * they are handled by writing the decision, above. The fourth adopts the
 * standard conditions plan, and it is built here from `STANDARD_MILESTONES`
 * rather than from anything the agent or the request supplied — every condition
 * starts "not-started", so this cannot mark anything satisfied. §19.8's
 * four-eyes control is about who may clear a condition, and an automated writer
 * that could set a status would be the first way round it.
 */
async function applyEffect(record: DealRecord, proposal: AgentProposal): Promise<void> {
  if (proposal.action.effect !== "adopt-conditions-plan") return;
  // Adopting twice would silently reset a plan somebody has been working
  // through, which is a data loss dressed as an idempotent write.
  if ((record.milestones ?? []).length > 0) return;

  const milestones: Milestone[] = STANDARD_MILESTONES.map((m) => ({ ...m, status: "not-started" }));
  await saveDeal({ ...record, milestones });
}
