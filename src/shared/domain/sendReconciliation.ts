/**
 * What to do when an outbound message's fate is unknown (spec A13, §13).
 *
 * A provider can accept a message and then the connection times out before it
 * confirms. The message may or may not have gone. The one thing that must never
 * happen is a blind resend — "a provider-accepted message cannot be recalled",
 * so resending on a timeout is how one enquiry becomes two to the same person.
 *
 * This is the decision, isolated and deterministic. It takes the result of a
 * provider lookup — did the provider, asked afterwards, say the message exists?
 * — and returns the only safe action:
 *
 *  - the provider has it → it was sent; do not resend.
 *  - the provider does not have it → it never landed; a retry is safe.
 *  - the provider cannot say, or offers no lookup at all → a person reconciles
 *    it. Escalation is the floor, never a guess, because the cost of guessing
 *    wrong is contacting a vulnerable person twice.
 *
 * Fails closed exactly like `screening.ts`: with no lookup-capable provider the
 * answer is always escalate. The transport that can actually report an
 * accepted-then-timeout and answer a lookup is a provider integration (an
 * Outstanding item), the same class as the payment and screening adapters.
 */

/** What a post-timeout provider lookup found. `undefined` = no lookup available. */
export type SendLookup = "accepted" | "not-found" | "unknown";

export type SendReconciliation = "already-sent" | "safe-to-retry" | "escalate";

export interface ReconciliationDecision {
  readonly decision: SendReconciliation;
  readonly reason: string;
}

export function reconcileSend(lookup: SendLookup | undefined): ReconciliationDecision {
  switch (lookup) {
    case "accepted":
      return {
        decision: "already-sent",
        reason: "The provider confirms the message exists — it was sent. Resending would double-contact the recipient.",
      };
    case "not-found":
      return {
        decision: "safe-to-retry",
        reason: "The provider has no record of the message — it never landed, so a retry is safe.",
      };
    case "unknown":
      return {
        decision: "escalate",
        reason: "The provider could not confirm the message either way. A person reconciles it; it is never auto-resent on a guess.",
      };
    default:
      return {
        decision: "escalate",
        reason: "No lookup-capable provider is configured, so an ambiguous send cannot be checked. A person reconciles it rather than risk a duplicate.",
      };
  }
}
