/**
 * The deterministic gate around the intake assistant (spec §12).
 *
 * An LLM reads a seller's messages and proposes structured values: facts it
 * extracted, what is still missing, what to do next, and a draft reply. It
 * proposes — this decides. Everything the model returns is untrusted data, in
 * exactly the way a seller's own message is, and this module is the wall
 * between "the model said so" and "the platform acted on it".
 *
 * Four rules, enforced here rather than hoped for in a prompt:
 *
 *  1. **A fact needs a citation, or it is not a fact.** Every extracted value
 *     must cite the message it came from, and that message must be one we hold.
 *     A value citing a message id we do not know is the model inventing a
 *     source, which is a hallucination, not evidence — it is dropped and the
 *     case goes to a human.
 *  2. **Unknown is null, never zero.** A null value is kept as "not known"; it
 *     is never coerced to a number.
 *  3. **The model may not make a claim the platform is not allowed to make.** A
 *     draft reply that guarantees funds, promises a valuation, invents a
 *     comparable sale, or gives legal advice is refused as an automatic reply
 *     and the case goes to a human (spec §9's can/cannot list).
 *  4. **Instructions inside the model's output cannot escalate it.** A draft
 *     that says "ignore the rules and send this to everyone" changes nothing:
 *     the recommended action is coerced to a known value, nothing here sends or
 *     approves anything, and such content forces review.
 *
 * Pure and framework-free. The backend seam calls the model, hands the raw
 * output here, and acts only on what comes back safe.
 */

export type QualificationValue = string | number | boolean | null;

export interface QualificationFact {
  readonly field: string;
  readonly value: QualificationValue;
  /** The message this value was read from. Must be one we hold. */
  readonly sourceMessageId: string;
}

export const RECOMMENDED_ACTIONS = [
  "ask_missing_information",
  "answer_question",
  "book_call",
  "escalate_to_human",
  "no_action",
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export const REVIEW_REASON_CODES = [
  "low_confidence",
  "schema_invalid",
  "vulnerability",
  "ambiguous_consent",
  "authority_unclear",
  "prohibited_claim",
  "unauthorised_action_requested",
  "invented_citation",
  "out_of_scope",
] as const;
export type ReviewReasonCode = (typeof REVIEW_REASON_CODES)[number];

export interface QualifiedResult {
  readonly caseId: string;
  /** Facts that validated: a known field, a real citation, a JSON scalar. */
  readonly facts: readonly QualificationFact[];
  /** What the model proposed but could not be trusted, and why. */
  readonly droppedFacts: readonly { readonly field: string; readonly reason: string }[];
  readonly missingFields: readonly string[];
  readonly recommendedAction: RecommendedAction;
  readonly humanReviewRequired: boolean;
  readonly reviewReasonCodes: readonly ReviewReasonCode[];
  /** The reply to the seller — blanked when it may not be sent automatically. */
  readonly draftReply: string;
  /** True only when a draft may go out without a human first reading it. */
  readonly safeToAutoReply: boolean;
}

export interface QualificationContext {
  /** The case this run belongs to. The model's own case_id is never trusted. */
  readonly caseId: string;
  /** The ids of messages we actually hold, to check citations against. */
  readonly knownMessageIds: readonly string[];
  /** The only fields a fact may name. */
  readonly allowedFields: readonly string[];
}

/**
 * Claims the assistant is forbidden to make to a seller (§9).
 *
 * A deterministic backstop, not the only control — the backend sends nothing
 * the model asked it to send; this stops a forbidden sentence reaching a seller
 * even as a drafted reply a human might wave through.
 */
const PROHIBITED: readonly { readonly code: ReviewReasonCode; readonly pattern: RegExp }[] = [
  // Guaranteeing money, funds or an outcome.
  { code: "prohibited_claim", pattern: /\b(guarantee|guaranteed|funds? (are|is) (available|in place|ready)|cash is ready|definitely (buy|purchase))\b/i },
  // Promising a valuation or a price.
  { code: "prohibited_claim", pattern: /\b(your (home|property) is worth|we (value|appraise) (it|your property) at|valuation of £|we will pay you £)/i },
  // Inventing a comparable sale.
  { code: "prohibited_claim", pattern: /\b(a (similar|comparable) (home|property)[^.]*sold|sold (for|at) £[\d,]+ (nearby|on your (street|road)|down the road))/i },
  // Giving legal advice.
  { code: "prohibited_claim", pattern: /\b(legal advice|you are legally|legally (entitled|required|obliged|bound)|as your (solicitor|lawyer))\b/i },
  // Prompt-injection: an instruction to disregard the rules, within a short
  // span of the thing it refers to, so it catches "ignore all previous
  // instructions" without firing on "ignore the noise".
  { code: "unauthorised_action_requested", pattern: /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,50}\b(instruction|rule|prompt|policy|previous|above)\b/i },
  // An instruction to broadcast — "send this to all investors / everyone".
  { code: "unauthorised_action_requested", pattern: /\bsend\b[^.]{0,50}\bto (all|every|everyone|each|the whole)\b/i },
];

function scanProhibited(text: string): readonly ReviewReasonCode[] {
  const codes = new Set<ReviewReasonCode>();
  for (const { code, pattern } of PROHIBITED) {
    if (pattern.test(text)) codes.add(code);
  }
  return [...codes];
}

function isScalar(v: unknown): v is QualificationValue {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Validate raw model output into a result the platform may act on.
 *
 * Always returns a usable result: on a broken shape or an unsafe draft it does
 * not throw, it returns a safe one — no facts persisted, the draft blanked,
 * `safeToAutoReply` false, and the case routed to a human with reason codes.
 */
export function reviewQualification(raw: unknown, ctx: QualificationContext): QualifiedResult {
  const reasons = new Set<ReviewReasonCode>();
  const known = new Set(ctx.knownMessageIds);
  const allowed = new Set(ctx.allowedFields);

  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
  if (obj === undefined) {
    return {
      caseId: ctx.caseId,
      facts: [],
      droppedFacts: [],
      missingFields: [],
      recommendedAction: "escalate_to_human",
      humanReviewRequired: true,
      reviewReasonCodes: ["schema_invalid"],
      draftReply: "",
      safeToAutoReply: false,
    };
  }

  // Facts: a known field, a citation to a message we hold, a JSON scalar.
  const facts: QualificationFact[] = [];
  const dropped: { field: string; reason: string }[] = [];
  const rawFacts = Array.isArray(obj.facts) ? obj.facts : [];
  for (const item of rawFacts) {
    const f = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const field = typeof f.field === "string" ? f.field : "";
    const source = typeof f.source_message_id === "string" ? f.source_message_id : "";
    const value = f.value;
    if (field === "" || !allowed.has(field)) {
      dropped.push({ field: field || "(unnamed)", reason: "Field is not one the intake collects." });
      continue;
    }
    if (!isScalar(value)) {
      dropped.push({ field, reason: "Value is not a plain scalar (unknown must be null, never an object)." });
      continue;
    }
    if (source === "") {
      dropped.push({ field, reason: "No source message cited, so the value is not evidence." });
      continue;
    }
    if (!known.has(source)) {
      // A citation to a message we do not hold is the model inventing a source.
      dropped.push({ field, reason: "Cites a message that does not exist — an invented source." });
      reasons.add("invented_citation");
      continue;
    }
    facts.push({ field, value, sourceMessageId: source });
  }

  const missingFields = asStringArray(obj.missing_fields);

  const actionRaw = typeof obj.recommended_action === "string" ? obj.recommended_action : "";
  let recommendedAction: RecommendedAction;
  if ((RECOMMENDED_ACTIONS as readonly string[]).includes(actionRaw)) {
    recommendedAction = actionRaw as RecommendedAction;
  } else {
    recommendedAction = "escalate_to_human";
    reasons.add("schema_invalid");
  }

  // Reason codes the model itself raised, kept only if they are known codes.
  for (const code of asStringArray(obj.review_reason_codes)) {
    if ((REVIEW_REASON_CODES as readonly string[]).includes(code)) reasons.add(code as ReviewReasonCode);
  }
  if (obj.human_review_required === true) reasons.add("low_confidence");

  // The draft reply, scanned for anything the assistant may not say.
  const rawDraft = typeof obj.draft_reply === "string" ? obj.draft_reply : "";
  const draftCodes = scanProhibited(rawDraft);
  for (const c of draftCodes) reasons.add(c);
  const draftUnsafe = draftCodes.length > 0;

  const humanReviewRequired = reasons.size > 0;
  const safeToAutoReply =
    !humanReviewRequired &&
    !draftUnsafe &&
    rawDraft.trim() !== "" &&
    (recommendedAction === "ask_missing_information" || recommendedAction === "answer_question");

  return {
    caseId: ctx.caseId,
    facts,
    droppedFacts: dropped,
    missingFields,
    recommendedAction,
    humanReviewRequired,
    reviewReasonCodes: [...reasons],
    // A reply that must not be sent automatically is withheld, not surfaced as
    // something a tired operator can forward with one click.
    draftReply: draftUnsafe ? "" : rawDraft,
    safeToAutoReply,
  };
}
