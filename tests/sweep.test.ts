import { describe, expect, it } from "vitest";
import { MAX_SWEEP_AREAS, parseAreas, sweepAreas } from "@backend/discovery/sweep";
import type { AreaRunResult } from "@backend/discovery/sourcingRun";
import type { SourcedLead } from "@shared/domain/sourcedLead";
import { attribute } from "@shared/domain/sources";

const preparedLead: SourcedLead = {
  signalKey: "prepared-but-unsold",
  label: "Prepared for sale, never sold",
  addressKey: "B1 1AA|10|TEST ROAD",
  postcode: "B1 1AA",
  summary: "A certificate was lodged with no sale registered since.",
  strength: "strong",
  heightenedProtection: false,
  provenance: attribute("epc-register", "2024-06-01"),
  lawfulNextStep: "Confirm the registered owner on the title.",
  propertyAddress: "10 Test Road",
};

const negEquityLead: SourcedLead = {
  ...preparedLead,
  signalKey: "negative-equity",
  addressKey: "B1 1AA|12|TEST ROAD",
};

function run(leads: readonly SourcedLead[]): AreaRunResult {
  return { leads, flips: [], certificates: leads.length, sales: 0, notes: [], note: "a note" };
}

describe("parseAreas", () => {
  it("splits on commas and newlines, trims, and drops blanks", () => {
    expect(parseAreas("B29 6AD, Birmingham\nLeeds")).toEqual(["B29 6AD", "Birmingham", "Leeds"]);
    expect(parseAreas(undefined)).toEqual([]);
    expect(parseAreas("   ")).toEqual([]);
  });

  it("bounds how many areas one sweep covers", () => {
    const many = Array.from({ length: MAX_SWEEP_AREAS + 10 }, (_, i) => `B${i} 1AA`).join(",");
    expect(parseAreas(many)).toHaveLength(MAX_SWEEP_AREAS);
  });
});

describe("sweepAreas", () => {
  it("routes a postcode to the area run and a name to the council run, saving only property-fact leads", async () => {
    const calls: string[] = [];
    const saved: string[] = [];
    const result = await sweepAreas(["b29 6ad", "Birmingham"], {
      runArea: async (pc) => {
        calls.push(`area:${pc}`);
        return run([preparedLead, negEquityLead]);
      },
      runCouncil: async (c) => {
        calls.push(`council:${c}`);
        return run([preparedLead]);
      },
      save: async (e) => {
        saved.push(e.id);
      },
      now: new Date("2026-10-27T00:00:00.000Z"),
    });

    // Postcode is upper-cased for the exact search; a name goes to the council sweep.
    expect(calls).toEqual(["area:B29 6AD", "council:Birmingham"]);
    // Only prepared-but-unsold leads reach the worklist; negative equity never does.
    expect(saved).toEqual(["B1 1AA|10|TEST ROAD", "B1 1AA|10|TEST ROAD"]);
    expect(result.totalSaved).toBe(2);
    expect(result.areas[0]?.kind).toBe("postcode");
    expect(result.areas[1]?.kind).toBe("council");
    expect(result.ranAt).toBe("2026-10-27T00:00:00.000Z");
  });

  it("is a no-op on an empty area list", async () => {
    const result = await sweepAreas([], { save: async () => { throw new Error("should not save"); } });
    expect(result.totalSaved).toBe(0);
    expect(result.areas).toEqual([]);
  });
});
