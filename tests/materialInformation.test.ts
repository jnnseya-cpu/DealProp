import { describe, expect, it } from "vitest";
import { bps, fromMajor } from "@shared/money";
import type { PropertyFacts } from "@shared/domain/types";
import {
  itemsFor,
  materialInformation,
  MATERIAL_ITEMS,
  type MaterialRecord,
} from "@shared/domain/materialInformation";

/**
 * Material information.
 *
 * The failure this prevents is the one that reads as diligence: publishing
 * what is known and staying silent about the rest. A buyer cannot tell the
 * difference between "no covenants" and "nobody looked", and omitting the
 * second is a misleading omission under the Consumer Protection Regulations —
 * enforced against whoever published the listing.
 */

function property(over: Partial<PropertyFacts> = {}): PropertyFacts {
  return {
    id: "p",
    jurisdiction: "GB-ENG",
    postcodeArea: "B23",
    locality: "Erdington",
    propertyType: "house",
    tenure: "freehold",
    bedrooms: 3,
    occupancy: "vacant",
    openMarketValue: fromMajor(212_000),
    valuationConfidence: bps(8_500),
    refurbishmentEstimate: fromMajor(34_000),
    postWorksValue: fromMajor(285_000),
    monthlyRent: fromMajor(1_250),
    knownIssues: [],
    ...over,
  };
}

const PART_A: MaterialRecord = {
  price: { state: "stated", value: "£172,000" },
  tenure: { state: "stated", value: "Freehold" },
  "council-tax": { state: "stated", value: "Band B" },
};

describe("Part A stops a listing outright", () => {
  it("refuses to market a property with nothing recorded", () => {
    const nothing = materialInformation(property());
    expect(nothing.mayMarket).toBe(false);
    expect(nothing.missingPartA).toEqual(["Asking price", "Tenure", "Council tax band"]);
    expect(nothing.summary).toContain("is not a listing");
  });

  it("allows marketing once Part A is answered, with the rest published as unanswered", () => {
    const partial = materialInformation(property(), PART_A);
    expect(partial.mayMarket).toBe(true);
    expect(partial.unanswered.length).toBeGreaterThan(0);
    // Published rather than left out. That is the whole distinction.
    expect(partial.summary).toContain("nobody looked");
  });

  it("will not let an always-applicable question be closed with \"not applicable\"", () => {
    // Otherwise every Part A question is answerable in one word.
    const dodged = materialInformation(property(), {
      ...PART_A,
      tenure: { state: "not-applicable", why: "not relevant" },
    });
    expect(dodged.mayMarket).toBe(false);
    expect(dodged.missingPartA).toContain("Tenure");
  });
});

describe("three states, not two", () => {
  it("says who was asked when the answer is not known", () => {
    const asked = materialInformation(property(), {
      ...PART_A,
      flood: { state: "not-known", whoWasAsked: "The owner" },
    });
    const flood = asked.items.find((i) => i.item.key === "flood");
    expect(flood?.answered).toBe(true);
    expect(flood?.shown).toContain("The owner was asked and could not say");
    expect(flood?.shown).toContain("commission their own check");
  });

  it("never softens an unasked question into a statement about the property", () => {
    // "No information available" reads as a fact about the house. It is a fact
    // about our own diligence, and the sentence has to say so.
    const silent = materialInformation(property(), PART_A);
    const covenants = silent.items.find((i) => i.item.key === "covenants");
    expect(covenants?.shown).toBe("Not established. Nobody has answered this yet.");
  });

  it("treats not-applicable as an answer where the item may not apply", () => {
    const answered = materialInformation(property(), {
      ...PART_A,
      mining: { state: "not-applicable", why: "outside any recorded coalfield" },
    });
    const mining = answered.items.find((i) => i.item.key === "mining");
    expect(mining?.answered).toBe(true);
    expect(mining?.shown).toContain("Does not apply");
  });
});

describe("which questions apply", () => {
  it("asks a leaseholder about the lease and a freeholder not at all", () => {
    const leasehold = itemsFor(property({ tenure: "leasehold" })).map((i) => i.key);
    expect(leasehold).toContain("lease-term");
    expect(leasehold).toContain("building-safety");

    const freehold = itemsFor(property()).map((i) => i.key);
    expect(freehold).not.toContain("lease-term");
    expect(freehold).not.toContain("building-safety");
  });

  it("blocks a leasehold listing that has not stated the lease terms", () => {
    // Part A for a leasehold property includes the lease, so answering the
    // freehold three is not enough.
    const flat = materialInformation(property({ tenure: "leasehold" }), PART_A);
    expect(flat.mayMarket).toBe(false);
    expect(flat.missingPartA).toContain("Lease length, ground rent and service charge");
  });
});

describe("every item earns its place", () => {
  it("says why a buyer would want it, not only that it is required", () => {
    for (const item of MATERIAL_ITEMS) {
      expect(item.why.length, item.key).toBeGreaterThan(30);
      expect(["A", "B", "C"], item.key).toContain(item.part);
    }
  });

  it("keeps every Part A item mandatory and no Part C item mandatory", () => {
    for (const item of MATERIAL_ITEMS) {
      if (item.part === "A") expect(item.alwaysApplies, item.key).toBe(true);
      if (item.part === "C") expect(item.alwaysApplies, item.key).toBe(false);
    }
  });
});
