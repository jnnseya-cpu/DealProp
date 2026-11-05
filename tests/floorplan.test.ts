import { describe, expect, it } from "vitest";
import { buildLayoutHypothesis, canCreateScenario, type BuildLayoutInput } from "@shared/domain/floorplan";

function input(over: Partial<BuildLayoutInput> = {}): BuildLayoutInput {
  return {
    id: "lh-1",
    tenantId: "lode",
    propertyId: "p-1",
    planVersion: "plan-v1",
    page: 1,
    coordinateUnits: "pixels",
    scaleReadable: true,
    proposedChange: "Knock through kitchen and dining into one room.",
    regions: [{ label: "Kitchen", bbox: [10, 10, 100, 80] }],
    createdAt: "2026-06-15T09:00:00.000Z",
    ...over,
  };
}

describe("floorplan layout review (IND10)", () => {
  it("permits dimensions and higher confidence when scale is readable", () => {
    const h = buildLayoutHypothesis(input({ scaleReadable: true }));
    expect(h.dimensionsPermitted).toBe(true);
    expect(h.scaleConfirmed).toBe(true);
    expect(h.unresolvedChecks).not.toContain("scale");
  });

  it("stays a hypothesis with no dimensions and low confidence when unscaled", () => {
    const h = buildLayoutHypothesis(input({ scaleReadable: false }));
    expect(h.dimensionsPermitted).toBe(false);
    expect(h.confidence).toBe("low");
    expect(h.unresolvedChecks).toContain("scale");
  });

  it("blocks scenario creation until scale and the reviewer checks are resolved", () => {
    const unscaled = buildLayoutHypothesis(input({ scaleReadable: false }));
    expect(canCreateScenario(unscaled, []).ok).toBe(false);
    expect(canCreateScenario(unscaled, []).blocking).toContain("scale");

    const scaled = buildLayoutHypothesis(input({ scaleReadable: true }));
    expect(canCreateScenario(scaled, []).ok).toBe(false); // circulation/access/planning open
    const ok = canCreateScenario(scaled, scaled.unresolvedChecks);
    expect(ok.ok).toBe(true);
    expect(ok.blocking).toEqual([]);
  });
});
