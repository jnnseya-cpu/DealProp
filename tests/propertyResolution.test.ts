import { describe, expect, it } from "vitest";
import type { ListingObservationRecord } from "@shared/domain/marketWatch";
import {
  groupEpisodes,
  linkInboundAndListing,
  mergeProperties,
  reconcileMerge,
  resolveListing,
  reverseMerge,
  type ListingIdentity,
  type PropertyRecord,
} from "@shared/domain/propertyResolution";

/**
 * Market Watch property identity — the acceptance cases the gap analysis flagged
 * as the one genuinely-missing model piece (MW02 flats, MW03 relist history,
 * MW13 case linking, MW14 reversible merge).
 */

const prop = (over: Partial<PropertyRecord> & Pick<PropertyRecord, "propertyId">): PropertyRecord => ({
  addressKey: "14 ACACIA ROAD B23 5AB",
  ...over,
});

const listing = (over: Partial<ListingIdentity> & Pick<ListingIdentity, "listingId">): ListingIdentity => ({
  source: "feed",
  addressKey: "14 ACACIA ROAD B23 5AB",
  ...over,
});

const obs = (over: Partial<ListingObservationRecord> & Pick<ListingObservationRecord, "id" | "listingId" | "observedAt">): ListingObservationRecord => ({
  propertyId: "p1",
  status: "available",
  priceQualifier: "asking",
  source: "feed",
  ...over,
});

describe("resolveListing (§19.4 order)", () => {
  it("matches on a verified UPRN", () => {
    const r = resolveListing(listing({ listingId: "L1", uprn: "100" }), [prop({ propertyId: "p1", uprn: "100" })]);
    expect(r.status).toBe("matched");
    expect(r.status === "matched" && r.method).toBe("uprn");
  });

  it("sends a UPRN that disagrees with the recorded address to review, not a silent merge", () => {
    const r = resolveListing(
      listing({ listingId: "L1", uprn: "100", addressKey: "99 OTHER ST B1 1AA" }),
      [prop({ propertyId: "p1", uprn: "100", addressKey: "14 ACACIA ROAD B23 5AB" })],
    );
    expect(r.status).toBe("candidate");
  });

  it("will not auto-resolve a flat with no unit (MW02)", () => {
    const r = resolveListing(listing({ listingId: "L1", isFlat: true }), [prop({ propertyId: "p1" })]);
    expect(r.status).toBe("pending");
  });

  it("keeps two flats at one postcode as separate properties (MW02)", () => {
    const properties = [
      prop({ propertyId: "flat1", isFlat: true, unit: "1", addressKey: "FLAT 1 14 ACACIA ROAD B23 5AB" }),
      prop({ propertyId: "flat2", isFlat: true, unit: "2", addressKey: "FLAT 2 14 ACACIA ROAD B23 5AB" }),
    ];
    const r = resolveListing(listing({ listingId: "L2", isFlat: true, unit: "2", addressKey: "FLAT 2 14 ACACIA ROAD B23 5AB" }), properties);
    expect(r.status === "matched" && r.propertyId).toBe("flat2");
  });

  it("creates a pending property when nothing matches", () => {
    expect(resolveListing(listing({ listingId: "L1", addressKey: "NEW PLACE" }), []).status).toBe("pending");
  });
});

describe("merge, split and reconciliation (MW14)", () => {
  const base = { id: "m1", survivingPropertyId: "p1", mergedPropertyId: "p2", by: "alice", reason: "same home", at: "2026-01-01T00:00:00Z" };

  it("refuses to merge a property into itself", () => {
    expect(() => mergeProperties({ ...base, mergedPropertyId: "p1" })).toThrow();
  });

  it("cancels the merged side's duplicate tasks and re-evaluates the survivor", () => {
    const rec = mergeProperties(base);
    const recon = reconcileMerge(rec, [
      { key: "t-surv", propertyId: "p1", actionType: "call" },
      { key: "t-dup", propertyId: "p2", actionType: "call" },
      { key: "t-keep", propertyId: "p2", actionType: "viewing" },
    ]);
    expect(recon.tasksToCancel).toEqual(["t-dup"]);
    expect(recon.signalsToReEvaluate).toEqual(["p1"]);
  });

  it("reverses a merge once, preserving the audit, and rebuilds both histories", () => {
    const rec = mergeProperties(base);
    const split = reverseMerge(rec, "bob", "actually two homes", "2026-02-01T00:00:00Z");
    expect(split.reversed?.by).toBe("bob");
    expect(() => reverseMerge(split, "bob", "again", "2026-03-01T00:00:00Z")).toThrow();
    expect(reconcileMerge(split, []).signalsToReEvaluate).toEqual(["p1", "p2"]);
  });
});

describe("episode grouping (MW03)", () => {
  const observations = [
    obs({ id: "o1", listingId: "L1", observedAt: "2026-01-01T00:00:00Z" }),
    obs({ id: "o2", listingId: "L1", observedAt: "2026-02-01T00:00:00Z" }),
    obs({ id: "o3", listingId: "L2", observedAt: "2026-06-01T00:00:00Z" }), // relist, new agent
  ];

  it("keeps a relist as a separate episode until a reviewer links it", () => {
    const episodes = groupEpisodes(observations);
    expect(episodes).toHaveLength(2);
    // The original observed history is preserved on the first episode.
    expect(episodes[0]!.observationIds).toEqual(["o1", "o2"]);
  });

  it("unions episodes only on a reviewer-confirmed link, history preserved", () => {
    const episodes = groupEpisodes(observations, [
      { fromEpisodeId: "L2", toEpisodeId: "L1", confirmedBy: "alice", at: "2026-06-02T00:00:00Z" },
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.listingIds).toEqual(["L1", "L2"]);
    expect(episodes[0]!.observationIds).toEqual(["o1", "o2", "o3"]);
    expect(episodes[0]!.startedAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("inbound ↔ listing link (MW13)", () => {
  it("links the two touchpoints and suppresses a duplicate approach", () => {
    const link = linkInboundAndListing("p1", "case-9", ["L2", "L1", "L1"]);
    expect(link.suppressDuplicateContact).toBe(true);
    expect(link.listingIds).toEqual(["L1", "L2"]);
    expect(link.sellerCaseId).toBe("case-9");
  });
});
