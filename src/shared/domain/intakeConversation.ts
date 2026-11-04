import type { RecommendedAction, ReviewReasonCode } from "@shared/domain/qualification";

/**
 * A stored seller-intake conversation (spec §12).
 *
 * The conversational counterpart to the structured `/sell` form: a seller can
 * talk to the automated assistant in plain language, and every turn is recorded
 * here. The shapes are pure data so the seller chat screen — a client component
 * that may not import the backend — can render a transcript, while the backend
 * seam (`intakeAssistant.ts`) produces the runs and the store holds the record.
 *
 * The assistant only ever proposes; `reviewQualification` decides what is safe.
 * A conversation whose latest run was not safe to answer automatically is left
 * `needs-review`, which is what the operator queue reads — the whole point of
 * the design is that an automated assistant never has the last word on a
 * distressed or unclear seller.
 */

/** Who wrote a turn. An operator may step in; the model is never a person. */
export type IntakeAuthor = "seller" | "assistant" | "operator";

export interface IntakeMessage {
  readonly id: string;
  readonly from: IntakeAuthor;
  readonly text: string;
  readonly at: string;
}

export type IntakeConversationStatus =
  /** The assistant or an operator has replied; the ball is with the seller. */
  | "awaiting-seller"
  /** The latest turn routed to a human: no safe automatic reply went out. */
  | "needs-review"
  /** An operator closed it — a call was booked, or it became a deal. */
  | "closed";

/**
 * What the deterministic gate decided about the most recent assistant run.
 *
 * A trimmed, storable projection of a `QualifiedResult` plus the run's
 * provenance, so the operator queue can show why a conversation needs a human
 * without re-running the model.
 */
export interface IntakeReviewState {
  readonly recommendedAction: RecommendedAction;
  readonly humanReviewRequired: boolean;
  readonly reviewReasonCodes: readonly ReviewReasonCode[];
  readonly safeToAutoReply: boolean;
  /** Which model answered, for the audit trail. "none" when no key is set. */
  readonly provider: string;
  readonly model: string;
  readonly at: string;
}

export interface IntakeConversation {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: IntakeConversationStatus;
  readonly messages: readonly IntakeMessage[];
  /** The gate's decision on the most recent assistant run, if any. */
  readonly lastReview?: IntakeReviewState;
  /** Set once a named operator has reviewed, replied to, or closed it (§51). */
  readonly handledBy?: string;
  readonly handledAt?: string;
  /** A linked deal, once the conversation is converted to one. */
  readonly dealId?: string;
}

/** True where a human must look before anything else is said to the seller. */
export function needsReview(conversation: IntakeConversation): boolean {
  return conversation.status === "needs-review";
}

/** Reason codes rendered in the operator's own words. */
const REASON_LABELS: Record<ReviewReasonCode, string> = {
  low_confidence: "The assistant was not confident in its own reading.",
  schema_invalid: "The assistant's output could not be used, so nothing was sent.",
  vulnerability: "The seller may be vulnerable or distressed.",
  ambiguous_consent: "Consent to be contacted is unclear.",
  authority_unclear: "It is not clear the seller has authority to sell.",
  prohibited_claim: "A drafted reply made a claim the assistant may not make.",
  unauthorised_action_requested: "The message tried to make the assistant act outside its remit.",
  invented_citation: "The assistant cited a fact to a message that does not exist.",
  out_of_scope: "The enquiry is outside what the assistant can handle.",
};

export function reviewReasonLabel(code: ReviewReasonCode): string {
  return REASON_LABELS[code] ?? code;
}
