import { listBuyBoxes, listRevealsForDeal } from "@backend/store/repository";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { matchBuyBox } from "@shared/domain/matching";
import { saleIsConfirmed } from "@shared/domain/inventory";
import { materialInformation } from "@shared/domain/materialInformation";
import { sellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import { workflowPosition, type WorkflowPosition } from "@shared/domain/workflow";
import type { DealRecord } from "@backend/store/schema";

/**
 * Assembling the facts the workflow reads.
 *
 * Every one of them is something somebody had to record. None of them is a
 * stage anybody set, which is the whole point: a stage field tells you what a
 * person believes, and this tells you what can be proved.
 */
export async function positionOf(
  record: DealRecord,
  now: Date = new Date(),
): Promise<WorkflowPosition> {
  const inputs = toWorkingDeal(record.inputs).inputs;
  const scored = scoreDeal(inputs);
  const [boxes, reveals] = await Promise.all([listBuyBoxes(), listRevealsForDeal(record.id)]);

  const material = materialInformation(inputs.property, record.material ?? {});
  const checks = sellerDueDiligence(record.sellerChecks, now);

  return workflowPosition({
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
  });
}
