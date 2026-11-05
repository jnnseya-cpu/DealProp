import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import { buildDecisionOutput, type DecisionOutput } from "@shared/domain/decisionOutput";
import {
  alignComparison,
  buildComparisonRun,
  MAX_COMPARISON,
  type ComparisonEntry,
  type SharedAssumptions,
} from "@shared/domain/comparison";

const shared: SharedAssumptions = {
  version: "assumptions-v3",
  strategy: "buy-refurbish-sell",
  financeRateBps: 950,
  downsideDefinition: "value −12%, works +30%, 6 months late",
};

function decision(ask: number): DecisionOutput {
  return buildDecisionOutput({
    investigationPriority: ["Returned and reduced."],
    basePence: fromMajor(30_000),
    downsidePence: fromMajor(5_000),
    maxSupportedPricePence: fromMajor(200_000),
    currentAskPence: fromMajor(ask),
    executionBlockers: [{ label: "Tenure confirmed", cleared: true }],
    evidenceCoverage: { confirmed: 5, userReported: 0, inferred: 0, missing: [] },
    inputsComplete: true,
  });
}

function entry(id: string, ask: number, overrides?: ComparisonEntry["overrides"]): ComparisonEntry {
  return { propertyId: id, label: `Property ${id}`, decision: decision(ask), ...(overrides !== undefined ? { overrides } : {}) };
}

describe("Compare and Decide (IND08)", () => {
  it("aligns up to four under one shared assumption set, overrides visible", () => {
    const r = buildComparisonRun({
      id: "cmp-1",
      tenantId: "lode",
      investorId: "inv-1",
      sharedAssumptions: shared,
      entries: [
        entry("a", 190_000),
        entry("b", 210_000),
        entry("c", 185_000, [{ field: "refurbishment", value: "£45,000 (property-specific)" }]),
        entry("d", 199_000),
      ],
      createdAt: "2026-06-15T09:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.run.sharedAssumptions.version).toBe("assumptions-v3");
    const cols = alignComparison(r.run);
    expect(cols).toHaveLength(4);
    // headroom aligns (same supported price, differing asks).
    expect(toMajor(cols[0]!.headroomPence)).toBe(10_000); // 200k − 190k
    expect(cols[1]!.verdict).toBe("below-target"); // 200k − 210k < 0
    // the property-specific override is visible, not folded in.
    expect(cols[2]!.hasOverrides).toBe(true);
    expect(cols[2]!.overrides[0]!.field).toBe("refurbishment");
    expect(cols[0]!.hasOverrides).toBe(false);
  });

  it("refuses fewer than two or more than four, and duplicate properties", () => {
    const one = buildComparisonRun({ id: "x", tenantId: "lode", investorId: "i", sharedAssumptions: shared, entries: [entry("a", 1)], createdAt: "t" });
    expect(one.ok).toBe(false);
    const five = buildComparisonRun({
      id: "x", tenantId: "lode", investorId: "i", sharedAssumptions: shared,
      entries: Array.from({ length: MAX_COMPARISON + 1 }, (_, i) => entry(`p${i}`, 190_000)),
      createdAt: "t",
    });
    expect(five.ok).toBe(false);
    const dupe = buildComparisonRun({
      id: "x", tenantId: "lode", investorId: "i", sharedAssumptions: shared,
      entries: [entry("a", 1), entry("a", 2)], createdAt: "t",
    });
    expect(dupe.ok).toBe(false);
  });
});
