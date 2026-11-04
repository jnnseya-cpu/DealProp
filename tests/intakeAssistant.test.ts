import { describe, expect, it } from "vitest";
import { qualifyIntake, type SellerMessage } from "@backend/intakeAssistant";
import type { QualificationContext } from "@shared/domain/qualification";

const CTX: QualificationContext = {
  caseId: "case-1",
  knownMessageIds: ["m1"],
  allowedFields: ["tenure", "seller_timescale_days"],
};
const MESSAGES: readonly SellerMessage[] = [
  { id: "m1", from: "seller", text: "It's a leasehold flat, I'd like to sell in a couple of months.", at: "2026-06-01T10:00:00Z" },
];

const reply = (json: string): typeof import("@backend/llm").complete =>
  (async () => json) as unknown as typeof import("@backend/llm").complete;

describe("qualifyIntake", () => {
  it("gates a clean JSON extraction and records the run", async () => {
    const { result, run } = await qualifyIntake(CTX, MESSAGES, {
      complete: reply(
        JSON.stringify({
          facts: [{ field: "tenure", value: "leasehold", source_message_id: "m1" }],
          missing_fields: ["seller_timescale_days"],
          recommended_action: "ask_missing_information",
          human_review_required: false,
          review_reason_codes: [],
          draft_reply: "Thanks — roughly how many weeks were you hoping to complete in?",
        }),
      ),
    });
    expect(result.facts).toHaveLength(1);
    expect(result.safeToAutoReply).toBe(true);
    expect(run.factsKept).toBe(1);
    expect(run.recommendedAction).toBe("ask_missing_information");
    expect(run.promptVersion).toBe("intake-1");
    expect(run.humanReviewRequired).toBe(false);
  });

  it("parses JSON wrapped in a code fence", async () => {
    const { result } = await qualifyIntake(CTX, MESSAGES, {
      complete: reply("```json\n" + JSON.stringify({ facts: [], recommended_action: "no_action", draft_reply: "" }) + "\n```"),
    });
    expect(result.recommendedAction).toBe("no_action");
  });

  it("routes a model error to human review rather than crashing", async () => {
    const { result, run } = await qualifyIntake(CTX, MESSAGES, {
      complete: (async () => {
        throw new Error("model 500");
      }) as unknown as typeof import("@backend/llm").complete,
    });
    expect(result.humanReviewRequired).toBe(true);
    expect(result.reviewReasonCodes).toContain("schema_invalid");
    expect(run.recommendedAction).toBe("escalate_to_human");
  });

  it("routes to human review when no model is configured, making no call", async () => {
    // No deps.complete injected and no BLOG_MODEL_API_KEY in the test env.
    const { result } = await qualifyIntake(CTX, MESSAGES);
    expect(result.humanReviewRequired).toBe(true);
    expect(result.recommendedAction).toBe("escalate_to_human");
  });

  it("repairs a single unparseable answer, then uses the repaired reply", async () => {
    const valid = JSON.stringify({
      facts: [{ field: "tenure", value: "leasehold", source_message_id: "m1" }],
      recommended_action: "ask_missing_information",
      draft_reply: "Thanks — roughly how many weeks were you hoping to complete in?",
    });
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return calls === 1 ? "sorry, here is my answer: not json at all" : valid;
    }) as unknown as typeof import("@backend/llm").complete;

    const { result, run } = await qualifyIntake(CTX, MESSAGES, { complete: stub });
    expect(calls).toBe(2);
    expect(run.repairAttempted).toBe(true);
    expect(result.facts).toHaveLength(1);
    expect(result.safeToAutoReply).toBe(true);
  });

  it("attempts repair at most once, then routes to human review", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return "still not json";
    }) as unknown as typeof import("@backend/llm").complete;

    const { result, run } = await qualifyIntake(CTX, MESSAGES, { complete: stub });
    expect(calls).toBe(2); // first + one repair, never a third
    expect(run.repairAttempted).toBe(true);
    expect(result.humanReviewRequired).toBe(true);
    expect(result.recommendedAction).toBe("escalate_to_human");
    expect(result.reviewReasonCodes).toContain("schema_invalid");
  });

  it("does not repair a clean first answer", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return JSON.stringify({ facts: [], recommended_action: "no_action", draft_reply: "" });
    }) as unknown as typeof import("@backend/llm").complete;

    const { run } = await qualifyIntake(CTX, MESSAGES, { complete: stub });
    expect(calls).toBe(1);
    expect(run.repairAttempted).toBe(false);
  });

  it("does not repair after a thrown model error — fails closed in one call", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      throw new Error("model 500");
    }) as unknown as typeof import("@backend/llm").complete;

    const { result, run } = await qualifyIntake(CTX, MESSAGES, { complete: stub });
    expect(calls).toBe(1);
    expect(run.repairAttempted).toBe(false);
    expect(result.humanReviewRequired).toBe(true);
  });

  it("still blanks a prohibited draft the model returns", async () => {
    const { result } = await qualifyIntake(CTX, MESSAGES, {
      complete: reply(
        JSON.stringify({
          facts: [],
          recommended_action: "answer_question",
          draft_reply: "Your property is worth £400,000 and we guarantee we will buy it.",
        }),
      ),
    });
    expect(result.draftReply).toBe("");
    expect(result.reviewReasonCodes).toContain("prohibited_claim");
    expect(result.safeToAutoReply).toBe(false);
  });
});
