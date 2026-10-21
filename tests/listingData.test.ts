import { describe, expect, it } from "vitest";
import {
  listingAvailability,
  signalsFrom,
  type ListingDataProvider,
  type ListingReport,
} from "@shared/domain/listingData";

const NOW = new Date("2026-10-21T00:00:00.000Z");

describe("the listing-data seam", () => {
  it("fails closed with no provider, and blames a contract not a bug", () => {
    const availability = listingAvailability(undefined);
    expect(availability.configured).toBe(false);
    if (!availability.configured) {
      expect(availability.reason).toContain("contract, not a scraper");
      // Must point at the lawful route, the way the source registry does.
      expect(availability.reason.toLowerCase()).toMatch(/propertydata|sprift|landinsight|reseller/);
    }
  });

  it("reports which provider answered when one is wired", () => {
    const provider: ListingDataProvider = {
      name: "PropertyData",
      lookup: async () => undefined,
    };
    const availability = listingAvailability(provider);
    expect(availability.configured).toBe(true);
    if (availability.configured) expect(availability.provider).toBe("PropertyData");
  });

  it("takes only present, fresh observations", () => {
    const report: ListingReport = {
      provider: "PropertyData",
      retrievedAt: NOW.toISOString(),
      observations: [
        { signal: "back-and-reduced", present: true, observedAt: "2026-10-01T00:00:00.000Z" },
        // Present but stale: a reduction from a year ago is not a seller today.
        { signal: "withdrawn-recently", present: true, observedAt: "2025-01-01T00:00:00.000Z" },
        // Fresh but absent: the provider looked and the signal does not hold.
        { signal: "cash-only", present: false, observedAt: "2026-10-10T00:00:00.000Z" },
      ],
    };
    expect(signalsFrom(report, NOW)).toEqual(["back-and-reduced"]);
  });

  it("treats a property with no observations as unknown, not clear", () => {
    const empty: ListingReport = {
      provider: "PropertyData",
      retrievedAt: NOW.toISOString(),
      observations: [],
    };
    // Nothing returned, rather than an assertion that the property is not
    // reduced. Absence must never read as a negative.
    expect(signalsFrom(empty, NOW)).toEqual([]);
  });
});
