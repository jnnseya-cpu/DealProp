import { randomUUID } from "node:crypto";
import {
  interpretBrief,
  type GeographyResolution,
  type InterpretResult,
} from "@shared/domain/dealHuntBrief";
import { validateCriteria, type CriteriaDraft } from "@shared/domain/dealHunt";
import {
  DEAL_HUNT_POLICY_VERSION,
  DEFAULT_TENANT,
  type DealHuntQuery,
} from "@shared/domain/dealHuntRun";
import { saveDealHuntQuery } from "@backend/store/repository";
import { dealHuntSource } from "@backend/dealHunt/fixtureSource";
import { runDealHuntJob, type RunDealHuntOutcome } from "@backend/dealHunt/worker";

/**
 * Deal Hunt application service: interpret a brief, and create + run a confirmed
 * hunt. The authorised geography resolver lives here; everything deterministic
 * (validation, matching, ranking) lives below it in pure domain code.
 */

/** The pilot's authorised geography resolver (England and Wales pilot areas). */
export function resolvePilotGeography(brief: string): GeographyResolution {
  const b = brief.toLowerCase();
  if (/birmingham|erdington|kingstanding|b2[0-9]\b/.test(b)) {
    return { id: "pilot-birmingham", input: "Birmingham" };
  }
  if (/london/.test(b)) {
    return { ambiguous: ["Resolve to a specific London borough"], input: "London" };
  }
  return { input: brief.slice(0, 80) };
}

export function interpret(brief: string): InterpretResult {
  return interpretBrief(brief, resolvePilotGeography);
}

export interface CreateHuntInput {
  readonly investorId: string;
  readonly draft: CriteriaDraft;
  readonly briefRef?: string;
}

export interface CreateHuntResult {
  readonly ok: boolean;
  readonly errors?: readonly string[];
  readonly outcome?: RunDealHuntOutcome;
  readonly queryId?: string;
}

/**
 * Validate the confirmed draft, persist an immutable query revision, and run the
 * hunt to completion. A hunt is never run on an invalid draft (DH02).
 */
export async function createAndRunHunt(input: CreateHuntInput): Promise<CreateHuntResult> {
  const validation = validateCriteria(input.draft);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const now = new Date().toISOString();
  const query: DealHuntQuery = {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT,
    investorId: input.investorId,
    revision: 1,
    criteria: validation.criteria,
    policyVersion: DEAL_HUNT_POLICY_VERSION,
    ...(input.briefRef !== undefined ? { briefRef: input.briefRef } : {}),
    confirmedAt: now,
  };
  await saveDealHuntQuery(query);

  const outcome = await runDealHuntJob(query, dealHuntSource());
  return { ok: true, outcome, queryId: query.id };
}
