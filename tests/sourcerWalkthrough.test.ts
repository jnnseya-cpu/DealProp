import { describe, expect, it } from "vitest";
import { STAGES, type StageKey, type WorkflowPosition } from "@shared/domain/workflow";
import {
  SOURCER_WALKTHROUGH,
  SOURCER_PREREQUISITES,
  SOURCER_EXCEPTIONS,
  sourcerWalkthrough,
} from "@shared/domain/sourcerWalkthrough";

/**
 * The walkthrough hangs on the workflow engine, so its contract is: one step
 * per stage, in the same order, and a projection that reports exactly what the
 * engine reports — reached is done, the first gap is where you work now.
 */

/** A position with a contiguous prefix of stages reached, like the real one. */
function positionReachedUpTo(key: StageKey | "none"): WorkflowPosition {
  const targetIndex = key === "none" ? -1 : STAGES.findIndex((s) => s.key === key);
  const stages = STAGES.map((stage, i) => ({
    stage,
    reached: i <= targetIndex,
    detail: i <= targetIndex ? "reached" : "not yet",
  }));
  const firstGap = stages.find((s) => !s.reached);
  return {
    at: stages[Math.max(0, targetIndex)]!.stage,
    stages,
    next: firstGap?.stage.evidencedBy,
    summary: "test",
    version: "workflow-1",
  };
}

describe("walkthrough content", () => {
  it("has exactly one step per workflow stage, in the same order", () => {
    expect(SOURCER_WALKTHROUGH.map((s) => s.key)).toEqual(STAGES.map((s) => s.key));
  });

  it("carries the one-time prerequisites and the exception routes", () => {
    expect(SOURCER_PREREQUISITES.map((p) => p.key)).toEqual(["aml-redress", "investor-brief", "fee-terms"]);
    expect(SOURCER_EXCEPTIONS.length).toBeGreaterThan(0);
  });

  it("states method and obligation, never a hardcoded money figure", () => {
    // Every figure is the engine's for the specific deal (decisions #4/#6). A
    // bare pound-amount in the guidance would be exactly the fake number the
    // house rules forbid; placeholders like £[amount] are fine.
    for (const step of SOURCER_WALKTHROUGH) {
      const text = [...step.actions, ...step.obligations, step.script ?? "", step.feeNote ?? ""].join(" ");
      expect(text, step.key).not.toMatch(/£\s?\d/);
    }
  });

  it("names the fee trigger as legal completion at the completion stage", () => {
    const completion = SOURCER_WALKTHROUGH.find((s) => s.key === "completed")!;
    expect(completion.feeNote?.toLowerCase()).toContain("completion");
  });
});

describe("projecting a live position", () => {
  it("marks reached stages done and the first gap as the current one", () => {
    const view = sourcerWalkthrough(positionReachedUpTo("buyers-matched"));
    const byKey = new Map(view.steps.map((s) => [s.step.key, s.state]));
    expect(byKey.get("discovered")).toBe("done");
    expect(byKey.get("buyers-matched")).toBe("done");
    expect(byKey.get("reveal-purchased")).toBe("current");
    expect(byKey.get("appraised")).toBe("upcoming");
    expect(view.current.step.key).toBe("reveal-purchased");
  });

  it("carries the workflow's own next-gate text, not its own", () => {
    const position = positionReachedUpTo("appraised");
    const view = sourcerWalkthrough(position);
    expect(view.nextGate).toBe(position.next);
  });

  it("points at the first stage when nothing is reached beyond discovery", () => {
    // discovered is always met (the deal exists), so the first real gap is
    // authority-verified.
    const view = sourcerWalkthrough(positionReachedUpTo("discovered"));
    expect(view.current.step.key).toBe("authority-verified");
    expect(view.fractionDone).toBeGreaterThan(0);
  });

  it("makes the last stage current when every stage is reached", () => {
    const view = sourcerWalkthrough(positionReachedUpTo("portfolio"));
    expect(view.current.step.key).toBe("portfolio");
    expect(view.fractionDone).toBe(1);
    expect(view.steps.every((s) => s.state === "done" || s.state === "current")).toBe(true);
  });
});
