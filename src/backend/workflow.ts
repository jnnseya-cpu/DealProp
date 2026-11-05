import { getDeal, listBuyBoxes, listRevealsForDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { matchBuyBox } from "@shared/domain/matching";
import { saleIsConfirmed } from "@shared/domain/inventory";
import { materialInformation } from "@shared/domain/materialInformation";
import { sellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import { workflowPosition, type WorkflowFacts, type WorkflowPosition } from "@shared/domain/workflow";
import { decideTransition, type TransitionFacts } from "@shared/domain/dealTransition";
import type { DealStatus } from "@shared/domain/types";
import type { DealRecord } from "@backend/store/schema";

/**
 * Assembling the facts the workflow reads.
 *
 * Every one of them is something somebody had to record. None of them is a
 * stage anybody set, which is the whole point: a stage field tells you what a
 * person believes, and this tells you what can be proved. The transition guard
 * (§10) reads the same facts, so "what is proved" has one source.
 */
export async function dealWorkflowFacts(record: DealRecord, now: Date = new Date()): Promise<WorkflowFacts> {
  const working = toWorkingDeal(record.inputs);
  const inputs = working.inputs;
  const scored = scoreDeal(inputs, { priceAgreed: !working.modelled });
  const [boxes, reveals] = await Promise.all([listBuyBoxes(), listRevealsForDeal(record.id)]);

  const material = materialInformation(inputs.property, record.material ?? {});
  const checks = sellerDueDiligence(record.sellerChecks, now);

  return {
    saleConfirmed: saleIsConfirmed(record.inventory),
    sellerChecked: checks.mayGoToMarket,
    materialComplete: material.mayMarket,
    protectionBlocked: scored.protection.blocked,
    matchedMandates: boxes.filter((b) => b.active && matchBuyBox(b, scored).eligible).length,
    revealsSold: reveals.filter((r) => r.refundedAt === undefined).length,
    fundingEvidenceRecorded: record.evidence !== undefined,
    offersRecorded: record.offers?.length ?? 0,
    solicitorInstructed: record.evidence?.solicitorInstructed === true,
    milestonesStarted: (record.milestones ?? []).filter((m) => m.status !== "not-started").length,
    heldInPortfolio: record.holding !== undefined,
    status: record.status,
  };
}

export async function positionOf(record: DealRecord, now: Date = new Date()): Promise<WorkflowPosition> {
  return workflowPosition(await dealWorkflowFacts(record, now));
}

export interface TransitionActor {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface TransitionResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Record a deal's advance to a new status (spec §10) — the one guarded path by
 * which `status` changes after creation.
 *
 * The decision is made against the deal's own recorded facts, the same ones the
 * workflow derives its stage from, so a status is never recorded that the
 * evidence does not support. Completion additionally takes a date, written onto
 * the deal atomically with the status; without a conveyancer instructed and a
 * date, the transition is refused and the completion fee stays unraisable (A16).
 */
export async function transitionDeal(
  dealId: string,
  target: DealStatus,
  actor: TransitionActor,
  opts: { completedAt?: string } = {},
  now: Date = new Date(),
): Promise<TransitionResult> {
  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const workflow = await dealWorkflowFacts(record, now);
  const completedAt = (opts.completedAt ?? "").trim();
  const completionRecorded = target === "completed" && completedAt !== "" && !Number.isNaN(Date.parse(completedAt));
  const facts: TransitionFacts = {
    saleConfirmed: workflow.saleConfirmed,
    sellerChecked: workflow.sellerChecked,
    materialComplete: workflow.materialComplete,
    protectionBlocked: workflow.protectionBlocked,
    fundingRecorded: workflow.fundingEvidenceRecorded || workflow.offersRecorded > 0,
    solicitorInstructed: workflow.solicitorInstructed,
    completionRecorded,
  };

  const decision = decideTransition(record.status, target, facts);
  if (!decision.ok) return { ok: false, message: decision.reason };

  await saveDeal({
    ...record,
    status: target,
    ...(target === "completed" ? { completedAt } : {}),
  });
  await audit("deal-transitioned", {
    account: { id: actor.id, email: actor.email },
    subject: dealId,
    detail: `${actor.name}: ${record.status} → ${target}. ${decision.reason}`,
  });
  return { ok: true, message: `Recorded: ${record.status} → ${target}.` };
}
