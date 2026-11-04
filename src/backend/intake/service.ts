import { createHash, randomUUID } from "node:crypto";
import {
  getIntakeConversation,
  saveAgentRun,
  saveIntakeConversation,
} from "@backend/store/repository";
import { qualifyIntake, type QualifyDeps } from "@backend/intakeAssistant";
import { beginRun, closeFromIntake } from "@shared/domain/agentRun";
import { audit } from "@backend/audit";
import type { QualificationContext } from "@shared/domain/qualification";
import type {
  IntakeConversation,
  IntakeMessage,
  IntakeReviewState,
} from "@shared/domain/intakeConversation";

/**
 * The intake conversation service (spec §12).
 *
 * This is the only thing that moves a conversation forward. It appends the
 * seller's turn, runs the assistant through the deterministic gate, and then —
 * this is the whole point — acts ONLY on what the gate says is safe:
 *
 *  - safe to auto-reply → the drafted reply is appended as an assistant turn
 *    and the ball goes back to the seller;
 *  - anything else → the conversation is left `needs-review` and no automated
 *    word reaches the seller. A distressed seller, an unclear authority, a
 *    prohibited claim, or simply no model configured all take this path.
 *
 * The assistant never has the last word on a seller who needs a person. That
 * is enforced here, by reading `safeToAutoReply`, not hoped for in a prompt.
 */

/**
 * The fields a fact may name. Passed to the gate as the allowlist: a fact
 * citing anything else is dropped, so the model cannot invent a field to carry
 * a value we never asked for.
 */
export const INTAKE_FIELDS = [
  "situation",
  "priorities",
  "timeline_days",
  "postcode_area",
  "locality",
  "property_type",
  "tenure",
  "bedrooms",
  "occupancy",
  "condition",
  "known_issues",
  "lease_years_remaining",
  "seller_valuation",
  "current_asking",
  "price_expectation",
  "contact_name",
  "contact_email",
  "contact_phone",
] as const;

function now(): string {
  return new Date().toISOString();
}

function message(from: IntakeMessage["from"], text: string): IntakeMessage {
  return { id: randomUUID(), from, text: text.trim(), at: now() };
}

/**
 * Run the assistant over the conversation so far and apply the gate's verdict.
 *
 * Pure-ish: it takes the messages, returns the assistant turn to append (or
 * none) and the review state. Nothing here persists — the caller saves.
 */
async function advance(
  conversation: IntakeConversation,
  deps: QualifyDeps,
): Promise<IntakeConversation> {
  const ctx: QualificationContext = {
    caseId: conversation.id,
    knownMessageIds: conversation.messages.map((m) => m.id),
    allowedFields: INTAKE_FIELDS,
  };

  const { result, run } = await qualifyIntake(ctx, conversation.messages, deps);

  // Record the run in the durable ledger (§20.5). The input hash is of the
  // message ids the run read, so a later run on a newer conversation is
  // distinguishable from this one.
  const inputHash = createHash("sha256").update(ctx.knownMessageIds.join("|")).digest("hex");
  const runRecord = closeFromIntake(
    beginRun({
      id: randomUUID(),
      kind: "intake-qualification",
      subjectType: "intake-conversation",
      subjectId: conversation.id,
      agentId: "seller_qualification",
      agentVersion: run.promptVersion,
      autonomy: "routine",
      provider: run.provider,
      model: run.model,
      startedAt: run.at,
      inputHash,
    }),
    {
      humanReviewRequired: run.humanReviewRequired,
      reasonCodes: run.reviewReasonCodes,
      repairAttempted: run.repairAttempted,
    },
    now(),
  );
  await saveAgentRun(runRecord);

  const review: IntakeReviewState = {
    recommendedAction: run.recommendedAction,
    humanReviewRequired: run.humanReviewRequired,
    reviewReasonCodes: run.reviewReasonCodes,
    safeToAutoReply: run.safeToAutoReply,
    provider: run.provider,
    model: run.model,
    at: run.at,
  };

  if (result.safeToAutoReply && result.draftReply.trim() !== "") {
    const reply = message("assistant", result.draftReply);
    await audit("intake-auto-replied", {
      subject: conversation.id,
      detail: `Assistant replied automatically (${run.provider}/${run.model}).`,
    });
    return {
      ...conversation,
      messages: [...conversation.messages, reply],
      status: "awaiting-seller",
      lastReview: review,
      updatedAt: now(),
    };
  }

  // Not safe to answer automatically: hold for a person. Nothing is said to the
  // seller, and the reasons are recorded for the operator queue.
  await audit("intake-flagged-for-review", {
    subject: conversation.id,
    detail: `Held for review: ${run.reviewReasonCodes.join(", ") || "no safe automatic reply"}.`,
  });
  return {
    ...conversation,
    status: "needs-review",
    lastReview: review,
    updatedAt: now(),
  };
}

/**
 * Start a conversation from a seller's first message. Returns the saved
 * conversation; its id is a capability token the seller uses to continue.
 */
export async function startIntakeConversation(
  text: string,
  deps: QualifyDeps = {},
): Promise<IntakeConversation> {
  const first = message("seller", text);
  const base: IntakeConversation = {
    id: randomUUID(),
    createdAt: now(),
    updatedAt: now(),
    status: "needs-review",
    messages: [first],
  };
  const advanced = await advance(base, deps);
  return saveIntakeConversation(advanced);
}

/**
 * Append a seller's reply and advance the conversation. Returns undefined if
 * the id is unknown; throws if the conversation is already closed.
 */
export async function addSellerReply(
  id: string,
  text: string,
  deps: QualifyDeps = {},
): Promise<IntakeConversation | undefined> {
  const existing = await getIntakeConversation(id);
  if (existing === undefined) return undefined;
  if (existing.status === "closed") {
    throw new Error("This conversation is closed. Start a new enquiry.");
  }
  const withSeller: IntakeConversation = {
    ...existing,
    messages: [...existing.messages, message("seller", text)],
    updatedAt: now(),
  };
  const advanced = await advance(withSeller, deps);
  return saveIntakeConversation(advanced);
}

/**
 * A named operator replies to the seller by hand (§51). This is the resolution
 * of a `needs-review` conversation: a person, not the model, has the word.
 */
export async function operatorReply(
  id: string,
  operator: { readonly id: string; readonly email: string; readonly name: string },
  text: string,
): Promise<IntakeConversation | undefined> {
  const existing = await getIntakeConversation(id);
  if (existing === undefined) return undefined;
  if (existing.status === "closed") {
    throw new Error("This conversation is closed.");
  }
  const updated: IntakeConversation = {
    ...existing,
    messages: [...existing.messages, message("operator", text)],
    status: "awaiting-seller",
    handledBy: operator.name,
    handledAt: now(),
    updatedAt: now(),
  };
  await audit("intake-operator-replied", {
    account: operator,
    subject: id,
    detail: `${operator.name} replied to a seller enquiry.`,
  });
  return saveIntakeConversation(updated);
}

/** Close a conversation — a call was booked, or it became a deal. */
export async function closeIntakeConversation(
  id: string,
  operator: { readonly id: string; readonly email: string; readonly name: string },
  dealId?: string,
): Promise<IntakeConversation | undefined> {
  const existing = await getIntakeConversation(id);
  if (existing === undefined) return undefined;
  const updated: IntakeConversation = {
    ...existing,
    status: "closed",
    handledBy: operator.name,
    handledAt: now(),
    updatedAt: now(),
    ...(dealId !== undefined ? { dealId } : {}),
  };
  await audit("intake-closed", {
    account: operator,
    subject: id,
    detail: `${operator.name} closed a seller enquiry.`,
  });
  return saveIntakeConversation(updated);
}
