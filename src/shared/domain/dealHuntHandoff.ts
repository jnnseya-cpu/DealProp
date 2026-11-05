import type { Money } from "@shared/money";
import type { DealHuntResult } from "@shared/domain/dealHuntRun";

/**
 * Carrying a Deal Hunt result into an appraisal draft (Deal Hunt spec §6,
 * DH07/DH13/DH15).
 *
 * The handoff is deterministic and does three careful things:
 *  - **DH15 (idempotent):** the draft id is derived from the investor and the
 *    result, so opening the appraisal twice links the same single draft.
 *  - **DH13 (entitlement at the moment of transfer):** every provenance source
 *    is re-checked for display rights *now*, not when the hunt ran. A source
 *    whose licence was revoked is withheld, and if nothing is still entitled the
 *    evidence bundle does not transfer at all — unauthorised evidence cannot move
 *    into the draft.
 *  - **DH07/§6 (observed inputs, not conclusions):** the asking price is carried
 *    as an observed input and the investor must confirm their intended purchase
 *    price and cost assumptions. A snapshot gone stale, or a listing no longer
 *    available, is flagged rather than hidden (research-only if unavailable).
 *
 * Pure: the entitlement check and the live listing state are injected.
 */

export interface AppraisalSeed {
  readonly draftId: string;
  readonly investorId: string;
  readonly resultId: string;
  readonly propertyId: string;
  /** The current asking price, as an observed input (never a valuation). */
  readonly observedAskingPence: Money;
  /** Transferred only when at least one provenance source is still entitled. */
  readonly evidenceBundleId?: string;
  readonly provenanceTransferred: readonly string[];
  /** Sources withheld because their licence no longer permits display (DH13). */
  readonly withheldSources: readonly string[];
  /** Inputs that changed since the snapshot, surfaced not hidden (DH07/§6). */
  readonly staleInputs: readonly string[];
  /** The listing is still available; if not, the draft is research-only (§6). */
  readonly listingAvailable: boolean;
  /** §6: the investor confirms their intended purchase price and assumptions. */
  readonly requiresPurchasePriceConfirmation: true;
}

export function appraisalDraftIdFor(investorId: string, resultId: string): string {
  return `dh-draft-${investorId}-${resultId}`;
}

export function buildAppraisalSeed(input: {
  readonly investorId: string;
  readonly result: DealHuntResult;
  readonly entitled: (sourceKey: string) => boolean;
  readonly listingState?: { readonly available: boolean; readonly currentAskPence?: Money };
}): AppraisalSeed {
  const { investorId, result, entitled, listingState } = input;

  const transferred = result.provenance.filter((s) => entitled(s));
  const withheld = result.provenance.filter((s) => !entitled(s));
  const anyEntitled = transferred.length > 0;

  const staleInputs: string[] = [];
  if (result.stale) staleInputs.push("The listing snapshot is stale; re-check before relying on it.");
  const currentAsk = listingState?.currentAskPence;
  if (currentAsk !== undefined && currentAsk !== result.currentPence) {
    staleInputs.push("The asking price changed since the hunt; confirm the current figure.");
  }
  const listingAvailable = listingState?.available ?? true;
  if (!listingAvailable) {
    staleInputs.push("The listing is no longer available; this is a research-only appraisal.");
  }

  return {
    draftId: appraisalDraftIdFor(investorId, result.id),
    investorId,
    resultId: result.id,
    propertyId: result.propertyId,
    observedAskingPence: currentAsk ?? result.currentPence,
    ...(anyEntitled && result.evidenceBundleId !== undefined ? { evidenceBundleId: result.evidenceBundleId } : {}),
    provenanceTransferred: transferred,
    withheldSources: withheld,
    staleInputs,
    listingAvailable,
    requiresPurchasePriceConfirmation: true,
  };
}
