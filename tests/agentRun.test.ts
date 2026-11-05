import { describe, expect, it } from "vitest";
import {
  acknowledgeRun,
  beginRun,
  canTransition,
  closeFailed,
  closeFromAnalysis,
  closeFromIntake,
  closeRun,
  isTerminalRunState,
  isWaiting,
  needsAttention,
  supersede,
  type AgentRunRecord,
  type AgentRunSeed,
} from "@shared/domain/agentRun";

/**
 * The durable agent-run record and its lifecycle. The tests that matter are the
 * ones about the ledger telling the truth: a finished run is never silently
 * rewritten, a bounded stop is not a success, and a newer run supersedes an
 * older one but cannot touch one that already ended.
 */

const SEED: AgentRunSeed = {
  id: "run-1",
  kind: "live-analysis",
  subjectType: "deal",
  subjectId: "deal-1",
  agentId: "live-analysis",
  agentVersion: "1.0.0",
  autonomy: "shadow",
  provider: "anthropic",
  model: "claude-x",
  startedAt: "2026-06-15T12:00:00.000Z",
  maxSteps: 8,
};
const LATER = "2026-06-15T12:00:30.000Z";

describe("opening a run", () => {
  it("begins running, defaulting correlation id to the run id and an empty hash", () => {
    const run = beginRun(SEED);
    expect(run.state).toBe("running");
    expect(run.correlationId).toBe("run-1");
    expect(run.inputHash).toBe("");
    expect(run.finishedAt).toBeUndefined();
    expect(isTerminalRunState(run.state)).toBe(false);
  });

  it("keeps an explicit correlation id and input hash", () => {
    const run = beginRun({ ...SEED, correlationId: "evt-9", inputHash: "abc123" });
    expect(run.correlationId).toBe("evt-9");
    expect(run.inputHash).toBe("abc123");
  });
});

describe("the transition guard", () => {
  it("allows running to any terminal state and to validating", () => {
    expect(canTransition("running", "validating")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);
    expect(canTransition("validating", "failed")).toBe(true);
  });

  it("never leaves a terminal state", () => {
    for (const t of ["succeeded", "failed", "cancelled", "superseded", "awaiting-human", "awaiting-data"] as const) {
      expect(canTransition(t, "running")).toBe(false);
      expect(canTransition(t, "succeeded")).toBe(false);
      expect(isTerminalRunState(t)).toBe(true);
    }
  });
});

describe("closing a run", () => {
  it("applies the result fields and stamps the finish time", () => {
    const run = closeRun(beginRun(SEED), {
      state: "succeeded",
      finishedAt: LATER,
      summary: "Done.",
      toolCalls: 3,
    });
    expect(run.state).toBe("succeeded");
    expect(run.finishedAt).toBe(LATER);
    expect(run.summary).toBe("Done.");
    expect(run.toolCalls).toBe(3);
  });

  it("refuses to overwrite a run that already finished", () => {
    const done = closeRun(beginRun(SEED), { state: "succeeded", finishedAt: LATER, summary: "First." });
    const again = closeRun(done, { state: "failed", finishedAt: "2026-06-15T13:00:00.000Z", summary: "Second." });
    expect(again).toBe(done); // unchanged — the recorded ending stands
    expect(again.summary).toBe("First.");
  });
});

describe("superseding", () => {
  it("marks an unfinished run superseded", () => {
    const run = supersede(beginRun(SEED), LATER);
    expect(run.state).toBe("superseded");
    expect(run.finishedAt).toBe(LATER);
  });

  it("leaves a finished run exactly as it was", () => {
    const done: AgentRunRecord = closeRun(beginRun(SEED), { state: "succeeded", finishedAt: LATER });
    expect(supersede(done, "2026-06-15T13:00:00.000Z")).toBe(done);
  });
});

describe("mapping the live analysis outcome", () => {
  it("a completed loop succeeds, summarised from the first line, with usage recorded", () => {
    const run = closeFromAnalysis(
      beginRun(SEED),
      { complete: true, stop: "completed", text: "The deal clears.\nMore detail.", toolCalls: 4, modelCalls: 5, inputTokens: 1200, outputTokens: 300 },
      LATER,
    );
    expect(run.state).toBe("succeeded");
    expect(run.summary).toBe("The deal clears.");
    expect(run.toolCalls).toBe(4);
    expect(run.modelCalls).toBe(5);
    expect(run.inputTokens).toBe(1200);
    expect(run.outputTokens).toBe(300);
  });

  it("a loop that ran out of steps is a bounded stop for a person, not a success (AG09)", () => {
    const run = closeFromAnalysis(
      beginRun(SEED),
      { complete: false, stop: "step-limit", text: "", toolCalls: 8, modelCalls: 8, inputTokens: 5000, outputTokens: 1000 },
      LATER,
    );
    expect(run.state).toBe("awaiting-human");
    expect(run.humanReviewRequired).toBe(true);
    expect(run.reasonCodes).toContain("step-budget-exhausted");
    expect(run.stepsUsed).toBe(SEED.maxSteps);
  });

  it("a token-budget stop is awaiting-human with the token reason (AG09 / §20.11)", () => {
    const run = closeFromAnalysis(
      beginRun(SEED),
      { complete: false, stop: "token-limit", text: "", toolCalls: 2, modelCalls: 3, inputTokens: 30000, outputTokens: 2000 },
      LATER,
    );
    expect(run.state).toBe("awaiting-human");
    expect(run.reasonCodes).toContain("token-budget-exhausted");
    expect(run.inputTokens).toBe(30000);
  });
});

describe("acknowledging a waiting run (§20.12)", () => {
  const ack = { by: "acc-1", byName: "Jo Operator", note: "I'll ring the seller.", at: LATER };
  const waiting = (): AgentRunRecord =>
    closeRun(beginRun(SEED), { state: "awaiting-human", finishedAt: "2026-06-15T12:00:10.000Z", humanReviewRequired: true });

  it("a waiting run needs attention until a named person acknowledges it", () => {
    const run = waiting();
    expect(isWaiting(run)).toBe(true);
    expect(needsAttention(run)).toBe(true);

    const done = acknowledgeRun(run, ack);
    expect(done.acknowledgedByName).toBe("Jo Operator");
    expect(done.acknowledgementNote).toBe("I'll ring the seller.");
    expect(isWaiting(done)).toBe(true); // still a waiting outcome…
    expect(needsAttention(done)).toBe(false); // …but off the live queue
  });

  it("a run that is not waiting cannot be acknowledged", () => {
    const succeeded = closeRun(beginRun(SEED), { state: "succeeded", finishedAt: LATER });
    expect(acknowledgeRun(succeeded, ack)).toBe(succeeded);
  });

  it("keeps the first acknowledgement rather than letting a second overwrite it", () => {
    const first = acknowledgeRun(waiting(), ack);
    const second = acknowledgeRun(first, { by: "acc-2", byName: "Sam", note: "mine", at: "2026-06-15T13:00:00.000Z" });
    expect(second).toBe(first);
    expect(second.acknowledgedByName).toBe("Jo Operator");
  });
});

describe("mapping a failure and the intake outcome", () => {
  it("records a failure with a safe code, never a raw message", () => {
    const run = closeFailed(beginRun(SEED), "provider-unavailable", LATER);
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("provider-unavailable");
  });

  it("intake needing review ends awaiting-human and carries the reasons", () => {
    const seed: AgentRunSeed = { ...SEED, kind: "intake-qualification", subjectType: "intake-conversation", subjectId: "case-1", agentId: "seller_qualification" };
    const run = closeFromIntake(beginRun(seed), { humanReviewRequired: true, reasonCodes: ["vulnerability"], repairAttempted: true }, LATER);
    expect(run.state).toBe("awaiting-human");
    expect(run.repairAttempted).toBe(true);
    expect(run.reasonCodes).toContain("vulnerability");
  });

  it("a clean intake run succeeds", () => {
    const seed: AgentRunSeed = { ...SEED, kind: "intake-qualification", subjectType: "intake-conversation", subjectId: "case-1", agentId: "seller_qualification" };
    const run = closeFromIntake(beginRun(seed), { humanReviewRequired: false, reasonCodes: [], repairAttempted: false }, LATER);
    expect(run.state).toBe("succeeded");
  });
});
