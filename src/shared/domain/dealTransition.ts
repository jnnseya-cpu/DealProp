import type { DealStatus } from "@shared/domain/types";

/**
 * The deal status transition rules (spec §10).
 *
 * The workflow stage is *derived* and never set (decision #68); status is one
 * of the facts it derives from. This is the guard on recording that fact: a
 * status only advances when what it claims can be proved. It does not let
 * anybody "set the stage" — it refuses to record a status the evidence does not
 * support, which is the same discipline from the other side.
 *
 * Two parts: an ordering (a deal moves one step forward, or withdraws) and a
 * per-step evidence gate. The gate that matters most is completion — a sale is
 * not recorded as completed without a conveyancer instructed and a completion
 * date, so "mark it done" cannot trigger the completion fee on a deal that has
 * not completed (A16).
 */

/** What a deal may transition to from each status. Forward one step, or withdraw. */
export const ALLOWED_NEXT: Readonly<Record<DealStatus, readonly DealStatus[]>> = {
  new: ["qualified", "withdrawn"],
  qualified: ["in-market", "withdrawn"],
  "in-market": ["funded", "withdrawn"],
  funded: ["completed", "withdrawn"],
  completed: [],
  withdrawn: [],
};

/**
 * The recorded facts a transition is judged against — a subset of the
 * workflow's own facts, so there is one source for "what is proved" and the
 * guard cannot drift from the derivation. `completionRecorded` is the one input
 * particular to a transition: whether a completion date was supplied with it.
 */
export interface TransitionFacts {
  readonly saleConfirmed: boolean;
  readonly sellerChecked: boolean;
  readonly materialComplete: boolean;
  readonly protectionBlocked: boolean;
  readonly fundingRecorded: boolean;
  readonly solicitorInstructed: boolean;
  readonly completionRecorded: boolean;
}

export interface TransitionDecision {
  readonly ok: boolean;
  readonly reason: string;
}

/** Whether a status may be recorded against a deal, and why not where it may not. */
export function decideTransition(
  current: DealStatus,
  target: DealStatus,
  facts: TransitionFacts,
): TransitionDecision {
  if (current === target) return { ok: false, reason: `The deal is already "${current}".` };
  if (!ALLOWED_NEXT[current].includes(target)) {
    return {
      ok: false,
      reason: `A deal cannot go from "${current}" to "${target}" — it moves one step forward, or is withdrawn.`,
    };
  }
  if (target === "withdrawn") return { ok: true, reason: "Withdrawn." };

  switch (target) {
    case "qualified":
      return facts.saleConfirmed && facts.sellerChecked
        ? { ok: true, reason: "Authority verified and the seller checked." }
        : {
            ok: false,
            reason:
              "Authority is not verified: a sale confirmation and the seller's due diligence must be recorded before the deal is qualified.",
          };
    case "in-market":
      if (facts.protectionBlocked) {
        return { ok: false, reason: "Seller Protection blocks this deal; it may not be marketed." };
      }
      return facts.materialComplete
        ? { ok: true, reason: "Marketable: material information answered and Seller Protection not blocking." }
        : { ok: false, reason: "Part A of the material information is not answered, so the deal may not go to market." };
    case "funded":
      return facts.fundingRecorded
        ? { ok: true, reason: "A price agreed with capital behind it." }
        : {
            ok: false,
            reason: "No funding evidence or lender offer is recorded — there is no capital behind the price.",
          };
    case "completed":
      if (!facts.solicitorInstructed) {
        return { ok: false, reason: "No conveyancer is recorded as instructed; a sale does not complete without one." };
      }
      return facts.completionRecorded
        ? { ok: true, reason: "Completion recorded." }
        : { ok: false, reason: "A completion date must be recorded to mark the deal completed." };
    default:
      // "new" is never a target: nothing transitions back to the start.
      return { ok: false, reason: `"${target}" is not a status a deal can transition into.` };
  }
}

/** The transitions offered to an operator from a given status, for the UI. */
export function offeredTransitions(current: DealStatus): readonly DealStatus[] {
  return ALLOWED_NEXT[current];
}

/** True when a target transition needs a completion date entered alongside it. */
export function needsCompletionDate(target: DealStatus): boolean {
  return target === "completed";
}
