import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import {
  buildDecisionOutput,
  summariseCoverage,
  type DecisionInput,
} from "@shared/domain/decisionOutput";

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    investigationPriority: ["Returned to market 8 days ago, down 7.0%."],
    basePence: fromMajor(30_000),
    downsidePence: fromMajor(5_000),
    maxSupportedPricePence: fromMajor(200_000),
    currentAskPence: fromMajor(190_000),
    executionBlockers: [{ label: "Tenure confirmed", cleared: true }],
    evidenceCoverage: { confirmed: 5, userReported: 1, inferred: 0, missing: [] },
    inputsComplete: true,
    ...over,
  };
}

describe("LODE decision output (§3 / IND09)", () => {
  it("computes headroom as supported price minus current ask", () => {
    const d = buildDecisionOutput(input());
    expect(toMajor(d.economics.headroomPence)).toBe(10_000);
    expect(d.verdict).toBe("within-target");
  });

  it("shows 'Below target at asking price' for a negative headroom with complete inputs", () => {
    const d = buildDecisionOutput(input({ currentAskPence: fromMajor(210_000) }));
    expect(toMajor(d.economics.headroomPence)).toBe(-10_000);
    expect(d.verdict).toBe("below-target");
    expect(d.statement).toMatch(/Below target/i);
  });

  it("shows 'Needs evidence' with the missing fields when inputs are incomplete", () => {
    const d = buildDecisionOutput(input({ evidenceCoverage: { confirmed: 2, userReported: 0, inferred: 0, missing: ["tenure", "floor area"] } }));
    expect(d.verdict).toBe("needs-evidence");
    expect(d.statement).toMatch(/tenure/);
  });

  it("shows 'Blocked for this strategy' even when the return is positive (§3)", () => {
    const d = buildDecisionOutput(
      input({ executionBlockers: [{ label: "No funding confirmed", cleared: false, nextAction: "Confirm a lender." }] }),
    );
    expect(d.verdict).toBe("blocked");
    expect(d.statement).toMatch(/Blocked for this strategy/i);
    expect(d.nextCheck).toMatch(/Confirm a lender/);
  });
});

describe("summariseCoverage", () => {
  it("counts confidence classes and names the still-missing fields", () => {
    const cov = summariseCoverage(
      [
        { field: "tenure", confidence: "confirmed" },
        { field: "asking_price", confidence: "user_reported" },
        { field: "epc", confidence: "missing" },
      ],
      ["tenure", "asking_price", "epc", "floor_area"],
    );
    expect(cov.confirmed).toBe(1);
    expect(cov.userReported).toBe(1);
    expect([...cov.missing].sort()).toEqual(["epc", "floor_area"]);
  });
});
