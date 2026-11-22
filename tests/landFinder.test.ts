import { afterEach, describe, expect, it } from "vitest";
import { landFinder } from "@backend/land/service";

/**
 * Land finder producer — the live call site (decision #42). Empty by default
 * (honest coverage boundary); the staff-pilot fixtures exercise the real
 * assessment and ranking, including the green-belt block.
 */

describe("landFinder", () => {
  const prev = process.env.LAND_FIXTURES;
  afterEach(() => {
    if (prev === undefined) delete process.env.LAND_FIXTURES;
    else process.env.LAND_FIXTURES = prev;
  });

  it("is empty with no feed connected", () => {
    delete process.env.LAND_FIXTURES;
    const view = landFinder();
    expect(view.feedConnected).toBe(false);
    expect(view.assessments).toHaveLength(0);
  });

  it("assesses and ranks the staff-pilot sites when enabled", () => {
    process.env.LAND_FIXTURES = "1";
    const view = landFinder();
    expect(view.feedConnected).toBe(true);
    expect(view.assessments.length).toBeGreaterThan(0);
    const scores = view.assessments.map((a) => a.sourceabilityScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("blocks the green-belt fixture and caps its score, whatever its size", () => {
    process.env.LAND_FIXTURES = "1";
    const view = landFinder();
    const gb = view.assessments.find((a) => a.site.id === "land-fx-greenbelt");
    expect(gb?.riskBand).toBe("blocked");
    expect(gb?.structures).toEqual([]);
    expect(gb?.sourceabilityScore).toBeLessThanOrEqual(25);
  });

  it("offers the right structures for the allocated and strategic fixtures", () => {
    process.env.LAND_FIXTURES = "1";
    const view = landFinder();
    const allocated = view.assessments.find((a) => a.site.id === "land-fx-allocated");
    const strategic = view.assessments.find((a) => a.site.id === "land-fx-strategic");
    expect(allocated?.structures).toContain("conditional-contract");
    expect(strategic?.structures).toContain("promotion-agreement");
    expect(strategic?.structures).not.toContain("conditional-contract");
  });
});
