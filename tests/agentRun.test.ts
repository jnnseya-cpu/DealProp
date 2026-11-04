import { describe, expect, it } from "vitest";
import {
  beginRun,
  canTransition,
  closeFailed,
  closeFromAnalysis,
  closeFromIntake,
  closeRun,
  isTerminalRunState,
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
  it("a completed loop succeeds, summarised from the first line of the prose", () => {
    const run = closeFromAnalysis(beginRun(SEED), { complete: true, text: "The deal clears.\nMore detail.", toolCalls: 4 }, LATER);
    expect(run.state).toBe("succeeded");
    expect(run.summary).toBe("The deal clears.");
    expect(run.toolCalls).toBe(4);
  });

  it("a loop that ran out of steps is a bounded stop for a person, not a success (AG09)", () => {
    const run = closeFromAnalysis(beginRun(SEED), { complete: false, text: "", toolCalls: 8 }, LATER);
    expect(run.state).toBe("awaiting-human");
    expect(run.humanReviewRequired).toBe(true);
    expect(run.reasonCodes).toContain("step-budget-exhausted");
    expect(run.stepsUsed).toBe(SEED.maxSteps);
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
