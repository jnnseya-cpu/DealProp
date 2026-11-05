import { sourcePermits } from "@shared/domain/sources";
import { buildAppraisalSeed, type AppraisalSeed } from "@shared/domain/dealHuntHandoff";
import { getDealHuntResult, saveDealHuntResult } from "@backend/store/repository";

/**
 * Open (or re-open) an appraisal draft from a Deal Hunt result (spec §6).
 *
 * Idempotent per investor + result (DH15): the first call links the draft and
 * records it on the result; a second call returns the same draft. Entitlement is
 * re-checked at the moment of handoff against current display rights, so a
 * source whose licence was revoked since the hunt is withheld and cannot
 * transfer (DH13).
 */
export interface HandoffOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly seed?: AppraisalSeed;
  readonly alreadyLinked?: boolean;
}

export async function openAppraisalFromResult(
  resultId: string,
  investorId: string,
): Promise<HandoffOutcome> {
  const result = await getDealHuntResult(resultId);
  if (result === undefined) return { ok: false, reason: "No such result." };

  const seed = buildAppraisalSeed({
    investorId,
    result,
    entitled: (sourceKey) => sourcePermits(sourceKey, "display"),
  });

  const alreadyLinked = result.appraisalDraftId !== undefined;
  if (!alreadyLinked) {
    // Record the link once; the draft id is deterministic, so this is the write
    // that makes "opened twice" one draft rather than two.
    await saveDealHuntResult({ ...result, appraisalDraftId: seed.draftId });
  }

  return { ok: true, seed, alreadyLinked };
}
