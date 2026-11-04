import { createHash, randomUUID } from "node:crypto";
import {
  getIntakeConversation,
  saveAgentRun,
  saveIntakeConversation,
  saveIntakeConversationIfCurrent,
} from "@backend/store/repository";
import { qualifyIntake, type QualifyDeps } from "@backend/intakeAssistant";
import { beginRun, closeFromIntake, closeRun, supersede, type AgentRunRecord } from "@shared/domain/agentRun";
import { agentPaused } from "@shared/domain/agentControls";
import { agentPause } from "@backend/agentControls";
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

interface Advanced {
  /** The next state of the conversation, if this run's result is applied. */
  readonly conversation: IntakeConversation;
  /**
   * The run record, still OPEN (running). The caller closes it: to its outcome
   * when the write lands, or superseded when a newer turn won the race. A run
   * is not "succeeded" until its result was actually applied.
   */
  readonly run: AgentRunRecord;
  /** How to close the run if it is applied. */
  readonly outcome: {
    readonly humanReviewRequired: boolean;
    readonly reasonCodes: readonly string[];
    readonly repairAttempted: boolean;
  };
  /** True when the run is already terminal (e.g. cancelled by the kill switch). */
  readonly closed?: boolean;
}

/**
 * Run the assistant over the conversation so far and compute the next state.
 *
 * Pure of persistence: it runs the model through the gate, opens the run record
 * and builds the would-be next conversation, and returns them. It does NOT save
 * the run, close it, or audit — the caller does that only once it knows whether
 * this result was actually applied. A run whose write loses a concurrency race
 * is superseded, and must not leave behind a "succeeded" ledger entry or an
 * "auto-replied" audit for a reply that never landed.
 */
async function advance(conversation: IntakeConversation, deps: QualifyDeps): Promise<Advanced> {
  const ctx: QualificationContext = {
    caseId: conversation.id,
    knownMessageIds: conversation.messages.map((m) => m.id),
    allowedFields: INTAKE_FIELDS,
  };

  // The kill switch (§20.8): when intake is paused, the model is not called at
  // all. The seller's turn is held for a person and the would-be run is
  // recorded cancelled, so the pause is visible rather than a silent non-reply.
  if (agentPaused(agentPause(), "intake-qualification")) {
    const at = now();
    const run = closeRun(
      beginRun({
        id: randomUUID(),
        kind: "intake-qualification",
        subjectType: "intake-conversation",
        subjectId: conversation.id,
        agentId: "seller_qualification",
        agentVersion: "paused",
        autonomy: "routine",
        provider: "none",
        model: "none",
        startedAt: at,
      }),
      { state: "cancelled", finishedAt: at, reasonCodes: ["agents-paused"], summary: "Agents paused; held for a person." },
    );
    const review: IntakeReviewState = {
      recommendedAction: "escalate_to_human",
      humanReviewRequired: true,
      reviewReasonCodes: [],
      safeToAutoReply: false,
      provider: "none",
      model: "none",
      at,
    };
    return {
      run,
      closed: true,
      outcome: { humanReviewRequired: true, reasonCodes: ["agents-paused"], repairAttempted: false },
      conversation: { ...conversation, status: "needs-review", lastReview: review, updatedAt: at },
    };
  }

  const { result, run } = await qualifyIntake(ctx, conversation.messages, deps);

  // The input hash is of the message ids this run read, so a run over a newer
  // conversation is distinguishable from this one.
  const inputHash = createHash("sha256").update(ctx.knownMessageIds.join("|")).digest("hex");
  const runRecord = beginRun({
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
  });
  const outcome = {
    humanReviewRequired: run.humanReviewRequired,
    reasonCodes: run.reviewReasonCodes,
    repairAttempted: run.repairAttempted,
  };

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
    return {
      run: runRecord,
      outcome,
      conversation: {
        ...conversation,
        messages: [...conversation.messages, reply],
        status: "awaiting-seller",
        lastReview: review,
        updatedAt: now(),
      },
    };
  }

  // Not safe to answer automatically: hold for a person.
  return {
    run: runRecord,
    outcome,
    conversation: { ...conversation, status: "needs-review", lastReview: review, updatedAt: now() },
  };
}

/** Audit the outcome of an advance that was actually applied. */
async function auditApplied(conversation: IntakeConversation): Promise<void> {
  if (conversation.status === "awaiting-seller") {
    const review = conversation.lastReview;
    await audit("intake-auto-replied", {
      subject: conversation.id,
      detail: `Assistant replied automatically (${review?.provider ?? "?"}/${review?.model ?? "?"}).`,
    });
    return;
  }
  await audit("intake-flagged-for-review", {
    subject: conversation.id,
    detail: `Held for review: ${conversation.lastReview?.reviewReasonCodes.join(", ") || "no safe automatic reply"}.`,
  });
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
  const { conversation, run, outcome, closed } = await advance(base, deps);
  // A brand-new id has no concurrent writer, so this first write is
  // unconditional. rev starts at 1.
  const saved = await saveIntakeConversation({ ...conversation, rev: 1 });
  await saveAgentRun(closed ? run : closeFromIntake(run, outcome, now()));
  await auditApplied(saved);
  return saved;
}

/** One seller reply cannot spawn an unbounded chain of re-runs under contention. */
const MAX_ADVANCE_ATTEMPTS = 3;

/**
 * Append a seller's reply and advance the conversation. Returns undefined if
 * the id is unknown; throws if the conversation is already closed.
 *
 * If a newer turn lands while this run is in flight (spec §20.5 / AG05), the
 * compare-and-swap write is refused: the run is superseded in the ledger and
 * the reply is re-applied over the current state, so a stale result never
 * overwrites newer conversation state and no turn is lost. Each attempt is its
 * own run over the latest messages — the latest turn always gets a fresh run.
 */
export async function addSellerReply(
  id: string,
  text: string,
  deps: QualifyDeps = {},
): Promise<IntakeConversation | undefined> {
  for (let attempt = 0; attempt < MAX_ADVANCE_ATTEMPTS; attempt += 1) {
    const existing = await getIntakeConversation(id);
    if (existing === undefined) return undefined;
    if (existing.status === "closed") {
      throw new Error("This conversation is closed. Start a new enquiry.");
    }
    const expectedRev = existing.rev ?? 0;
    const withSeller: IntakeConversation = {
      ...existing,
      messages: [...existing.messages, message("seller", text)],
      updatedAt: now(),
    };
    const { conversation, run, outcome, closed } = await advance(withSeller, deps);
    const saved = await saveIntakeConversationIfCurrent(
      { ...conversation, rev: expectedRev + 1 },
      expectedRev,
    );
    if (saved !== undefined) {
      await saveAgentRun(closed ? run : closeFromIntake(run, outcome, now()));
      await auditApplied(saved);
      return saved;
    }
    // A newer turn landed during this run. Its result is stale: record it
    // superseded and try again over the current state.
    await saveAgentRun(supersede(run, now()));
  }
  // Sustained contention beyond the attempt bound — return the current state
  // rather than clobber it. Nothing stale was applied.
  return getIntakeConversation(id);
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
    // Bump the version so an in-flight auto-reply run loses its CAS and is
    // superseded — the operator has stepped in and has the word.
    rev: (existing.rev ?? 0) + 1,
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
    rev: (existing.rev ?? 0) + 1,
    ...(dealId !== undefined ? { dealId } : {}),
  };
  await audit("intake-closed", {
    account: operator,
    subject: id,
    detail: `${operator.name} closed a seller enquiry.`,
  });
  return saveIntakeConversation(updated);
}
