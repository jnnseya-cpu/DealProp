import { describe, expect, it } from "vitest";
import {
  focusCoverage,
  LAUNCH_FOCUS,
  LAUNCH_REGION,
  RECENT_DAYS,
  supplyPosition,
  type SupplyRecord,
} from "@shared/domain/supply";

/**
 * The supply statement.
 *
 * An investor's first question is how many, where and how often. The tests
 * that matter here are the ones proving the answer is not flattered: that a
 * blocked deal is never counted as available, that a rate is withheld until
 * there is enough history for one to mean anything, and that zero is reported
 * as zero.
 */

const NOW = new Date("2026-09-01T12:00:00.000Z");

function deal(overrides: Partial<SupplyRecord> = {}): SupplyRecord {
  return {
    createdAt: "2026-08-20T00:00:00.000Z",
    status: "qualified",
    postcodeArea: "B23",
    locality: "Erdington",
    jurisdiction: "GB-ENG",
    blocked: false,
    ...overrides,
  };
}

const NO_MANDATES = { buy: 0, funding: 0 };

describe("what is actually available", () => {
  it("counts only deals a buyer could act on", () => {
    const position = supplyPosition(
      [
        deal({ status: "new" }),
        deal({ status: "qualified" }),
        deal({ status: "in-market" }),
        deal({ status: "funded" }),
        deal({ status: "completed" }),
        deal({ status: "withdrawn" }),
      ],
      NO_MANDATES,
      NOW,
    );
    expect(position.open).toBe(3);
    expect(position.total).toBe(6);
    expect(position.completed).toBe(2);
  });

  it("never counts a blocked deal as available", () => {
    // Seller Protection stopping a deal is the whole point of the engine. A
    // supply figure that quietly includes them is the one number on the page
    // that would be a lie.
    const position = supplyPosition(
      [deal(), deal({ blocked: true }), deal({ blocked: true })],
      NO_MANDATES,
      NOW,
    );
    expect(position.open).toBe(1);
    expect(position.blocked).toBe(2);
    expect(position.summary).toContain("refused by the protection engine");
  });

  it("says nothing rather than something when there is nothing", () => {
    const position = supplyPosition([], NO_MANDATES, NOW);
    expect(position.open).toBe(0);
    expect(position.areas).toEqual([]);
    expect(position.summary).toContain("No deals are on the platform yet");
    expect(position.summary).toContain("untrue");
  });
});

describe("where", () => {
  it("reports the areas of open deals, not of every record", () => {
    const position = supplyPosition(
      [
        deal({ postcodeArea: "B23", locality: "Erdington" }),
        deal({ postcodeArea: "B17", locality: "Harborne" }),
        deal({ postcodeArea: "M14", locality: "Fallowfield", status: "withdrawn" }),
        deal({ postcodeArea: "B23", locality: "Erdington" }),
      ],
      NO_MANDATES,
      NOW,
    );
    expect(position.areas).toEqual(["B17", "B23"]);
    expect(position.localities).toEqual(["Erdington", "Harborne"]);
    // Jurisdictions cover everything, because that is a statement about the
    // rate tables rather than about what is for sale.
    expect(position.jurisdictions).toEqual(["GB-ENG"]);
  });

  it("names one area rather than counting to one", () => {
    const position = supplyPosition([deal({ postcodeArea: "B23" })], NO_MANDATES, NOW);
    expect(position.summary).toContain("in B23");
    expect(position.summary).not.toContain("1 postcode areas");
  });
});

describe("how often", () => {
  it("withholds a rate until there is enough history to support one", () => {
    // Two deals entered on the same afternoon are not "one every zero days",
    // they are a seeding. A cadence figure from four records is a number that
    // would be quoted back at us.
    const position = supplyPosition([deal(), deal(), deal(), deal()], NO_MANDATES, NOW);
    expect(position.tooEarlyForCadence).toBe(true);
    expect(position.summary).toContain("early-stage volume");
    expect(position.summary).toContain("not yet enough history");
  });

  it("computes a mean interval once there is a span and enough deals", () => {
    const spread: SupplyRecord[] = Array.from({ length: 10 }, (_, i) =>
      deal({ createdAt: new Date(Date.UTC(2026, 5, 1 + i * 3)).toISOString() }),
    );
    const position = supplyPosition(spread, NO_MANDATES, NOW);
    expect(position.tooEarlyForCadence).toBe(false);
    expect(position.meanDaysBetween).toBe(3);
    expect(position.firstAt?.slice(0, 10)).toBe("2026-06-01");
    expect(position.latestAt?.slice(0, 10)).toBe("2026-06-28");
  });

  it("gives no rate where every deal arrived on the same day", () => {
    const sameDay = Array.from({ length: 10 }, () => deal({ createdAt: "2026-08-30T09:00:00.000Z" }));
    const position = supplyPosition(sameDay, NO_MANDATES, NOW);
    expect(position.meanDaysBetween).toBeUndefined();
    expect(position.tooEarlyForCadence).toBe(true);
  });

  it("counts only what arrived inside the recent window", () => {
    const position = supplyPosition(
      [
        deal({ createdAt: "2026-08-30T00:00:00.000Z" }),
        deal({ createdAt: "2026-08-05T00:00:00.000Z" }),
        deal({ createdAt: "2026-01-05T00:00:00.000Z" }),
      ],
      NO_MANDATES,
      NOW,
    );
    expect(RECENT_DAYS).toBe(30);
    expect(position.recent).toBe(2);
  });
});

describe("what it never says", () => {
  it("reports no return, yield or margin anywhere", () => {
    // A public statement that deals are available at a given margin is an
    // inducement to engage in investment activity, and under FSMA s.21 only an
    // authorised person may communicate or approve one. Counts, coverage and
    // cadence are facts about the business; the economics stay behind
    // categorisation.
    const position = supplyPosition(
      [deal(), deal({ status: "in-market" }), deal({ blocked: true })],
      { buy: 3, funding: 2 },
      NOW,
    );
    const everything = JSON.stringify(position).toLowerCase();
    for (const word of ["margin", "yield", "return", "profit", "roi", "£"]) {
      expect(everything, `supply position mentions "${word}"`).not.toContain(word);
    }
  });
});

describe("what we say we are focusing on", () => {
  it("says the region and reports coverage inside it", () => {
    const inside = focusCoverage(["B23", "WV1", "DY4"]);
    expect(inside.outside).toEqual([]);
    expect(inside.statement).toContain(LAUNCH_REGION.label);
    expect(inside.statement).toContain("every open opportunity is inside it");
  });

  it("states drift rather than tidying it away", () => {
    // A page that says "the West Midlands" while the pipeline is half in Leeds
    // is a page whose first checkable claim is wrong, and a reader who catches
    // one stops believing the figures that are true.
    const drifted = focusCoverage(["B23", "LS1", "M14"]);
    expect(drifted.outside).toEqual(["LS1", "M14"]);
    expect(drifted.statement).toContain("outside it");
    expect(drifted.statement).toContain("LS1, M14");
  });

  it("does not claim coverage it has not got", () => {
    const empty = focusCoverage([]);
    expect(empty.statement).toContain("Nothing is on the platform yet");
  });

  it("keeps the focus free of any return, yield or margin", () => {
    // Same rule as the rest of this file: a public statement that deals are
    // available at a given margin is a financial promotion under FSMA s.21.
    //
    // Word boundaries rather than substrings. "Property returning after a
    // failed sale" is a kind of stock, not a rate of return, and a substring
    // ban fails on it — which teaches whoever hits it to weaken the check.
    const text = LAUNCH_FOCUS.join(" ").toLowerCase();
    for (const pattern of [
      /\bmargins?\b/,
      /\byields?\b/,
      /\breturns?\b/,
      /\bprofits?\b/,
      /\broi\b/,
      /%/,
      /\u00a3/,
    ]) {
      expect(pattern.test(text), pattern.source).toBe(false);
    }
  });
});
