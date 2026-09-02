import { describe, expect, it } from "vitest";
import {
  STAGES,
  stageDefinition,
  workflowPosition,
  type WorkflowFacts,
} from "@shared/domain/workflow";

/**
 * Where a transaction has actually got to.
 *
 * The value is not the diagram. It is that each step is derived from what is
 * recorded rather than set by somebody clicking "next" — a stage field tells
 * you what a person believes, and the two diverge precisely when it matters.
 */

const NOTHING: WorkflowFacts = {
  saleConfirmed: false,
  sellerChecked: false,
  materialComplete: false,
  protectionBlocked: false,
  matchedMandates: 0,
  revealsSold: 0,
  fundingEvidenceRecorded: false,
  offersRecorded: 0,
  solicitorInstructed: false,
  milestonesStarted: 0,
  heldInPortfolio: false,
  status: "new",
};

const EVERYTHING: WorkflowFacts = {
  saleConfirmed: true,
  sellerChecked: true,
  materialComplete: true,
  protectionBlocked: false,
  matchedMandates: 2,
  revealsSold: 1,
  fundingEvidenceRecorded: true,
  offersRecorded: 3,
  solicitorInstructed: true,
  milestonesStarted: 4,
  heldInPortfolio: true,
  status: "completed",
};

describe("the first gap is where it stops", () => {
  it("starts at discovered and goes no further with nothing recorded", () => {
    const position = workflowPosition(NOTHING);
    expect(position.at.key).toBe("discovered");
    expect(position.next).toContain("Authority verified");
  });

  it("does not count a later step reached over an earlier gap", () => {
    // This is the whole design. A deal with an accepted price and no seller
    // checks is not at "offer accepted" — it is stuck at the check, and
    // reporting the furthest touched step is how a transaction reaches
    // exchange with a hole in it.
    const jumped = workflowPosition({
      ...EVERYTHING,
      sellerChecked: false,
      status: "funded",
    });
    expect(jumped.at.key).toBe("discovered");
    expect(jumped.next).toContain("due diligence is not complete");
  });

  it("advances one step at a time as the evidence arrives", () => {
    const confirmed = workflowPosition({ ...NOTHING, saleConfirmed: true, sellerChecked: true });
    expect(confirmed.at.key).toBe("authority-verified");

    const marketable = workflowPosition({
      ...NOTHING,
      saleConfirmed: true,
      sellerChecked: true,
      materialComplete: true,
    });
    expect(marketable.at.key).toBe("opportunity-protected");

    const matched = workflowPosition({
      ...NOTHING,
      saleConfirmed: true,
      sellerChecked: true,
      materialComplete: true,
      matchedMandates: 1,
    });
    expect(matched.at.key).toBe("buyers-matched");
  });

  it("stops at the protection block rather than calling it a missing document", () => {
    const blocked = workflowPosition({
      ...EVERYTHING,
      protectionBlocked: true,
    });
    expect(blocked.at.key).toBe("authority-verified");
    expect(blocked.next).toContain("There is no opportunity to protect");
  });
});

describe("what is not built says so", () => {
  it("has no unbuilt step left, and would say so if it did", () => {
    // The flag stays because the next specification will add a step that is
    // not built, and drawing that one as working would be worse than drawing
    // it as missing.
    for (const stage of STAGES) expect(stage.built, stage.key).toBe(true);
    expect(stageDefinition("portfolio").evidencedBy).toContain("Holding facts recorded");
  });

  it("runs all the way to the portfolio when the evidence exists", () => {
    const done = workflowPosition(EVERYTHING);
    expect(done.at.key).toBe("portfolio");
    expect(done.next).toBeUndefined();
    expect(done.summary).toContain("end of the workflow");
  });

  it("stops at completion where nothing is recorded about holding it", () => {
    // Completed and forgotten is exactly the marketplace behaviour this step
    // exists to replace, so it reads as a gap rather than as finished.
    const forgotten = workflowPosition({ ...EVERYTHING, heldInPortfolio: false });
    expect(forgotten.at.key).toBe("completed");
    expect(forgotten.next).toContain("nothing is counting down");
  });
});

describe("every step earns its place", () => {
  it("says what happens and what evidences it", () => {
    expect(STAGES).toHaveLength(12);
    for (const stage of STAGES) {
      expect(stage.what.length, stage.key).toBeGreaterThan(30);
      expect(stage.evidencedBy.length, stage.key).toBeGreaterThan(10);
    }
  });

  it("reports every step with a reason, reached or not", () => {
    const position = workflowPosition(NOTHING);
    expect(position.stages).toHaveLength(STAGES.length);
    for (const step of position.stages) {
      expect(step.detail.length, step.stage.key).toBeGreaterThan(5);
    }
  });
});
