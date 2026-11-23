import { describe, expect, it } from "vitest";
import {
  mapBrownfieldEntity,
  mapBrownfieldPlanning,
  parseWktPoint,
  opportunityToLandSite,
  type BrownfieldEntity,
  type LandOpportunity,
} from "@shared/domain/land/brownfield";
import { buildBrownfieldUrl, fetchBrownfieldSites } from "@backend/land/brownfieldSource";
import { landSourcing } from "@backend/land/sourcingService";
import { Fetcher } from "@backend/discovery/fetcher";
import { sourcePermits } from "@shared/domain/sources";

/**
 * Brownfield Land Registers — the licensed, free land-sourcing feed. The things
 * that matter: it is OGL-licensed for display, the register's own fields map
 * faithfully (capacity, planning, ownership), unknown planning never becomes a
 * guessed consent, and a point query reaches only the one bound host.
 */

describe("brownfield-land is OGL-licensed for display", () => {
  it("permits internal analysis and display", () => {
    expect(sourcePermits("brownfield-land", "internal-analysis")).toBe(true);
    expect(sourcePermits("brownfield-land", "display")).toBe(true);
  });
});

describe("parseWktPoint", () => {
  it("parses a WKT point", () => {
    expect(parseWktPoint("POINT (-1.56 52.34)")).toEqual({ longitude: -1.56, latitude: 52.34 });
  });
  it("is undefined for junk", () => {
    expect(parseWktPoint("not a point")).toBeUndefined();
    expect(parseWktPoint(undefined)).toBeUndefined();
  });
});

describe("mapBrownfieldPlanning", () => {
  it("maps permission type to a status", () => {
    expect(mapBrownfieldPlanning("permissioned", "full planning permission")).toBe("full");
    expect(mapBrownfieldPlanning("permissioned", "outline planning permission")).toBe("outline");
    expect(mapBrownfieldPlanning("permissioned", "permission in principle")).toBe("outline");
  });
  it("defaults unknown/absent to none, never a guessed consent (decision #5)", () => {
    expect(mapBrownfieldPlanning("not permissioned", "")).toBe("none");
    expect(mapBrownfieldPlanning(undefined, undefined)).toBe("none");
  });
  it("treats a pending decision as pre-application, not consented", () => {
    expect(mapBrownfieldPlanning("pending decision", "")).toBe("pre-application");
  });
});

const entity = (over: Partial<BrownfieldEntity> = {}): BrownfieldEntity => ({
  reference: "BLR-1",
  name: "Former depot",
  organisation: "Coventry City Council",
  point: "POINT (-1.49 52.42)",
  hectares: "0.62",
  "ownership-status": "owned by a public authority",
  "minimum-net-dwellings": "12",
  "maximum-net-dwellings": "20",
  "planning-permission-status": "permissioned",
  "planning-permission-type": "full planning permission",
  deliverable: "yes",
  "entry-date": "2025-12-31",
  ...over,
});

describe("mapBrownfieldEntity", () => {
  it("maps a full register entity to an opportunity", () => {
    const o = mapBrownfieldEntity(entity());
    expect(o).toBeDefined();
    expect(o?.reference).toBe("BLR-1");
    expect(o?.location).toEqual({ longitude: -1.49, latitude: 52.42 });
    expect(o?.areaHectares).toBe(0.62);
    expect(o?.minUnits).toBe(12);
    expect(o?.maxUnits).toBe(20);
    expect(o?.planningStatus).toBe("full");
    expect(o?.ownershipPublic).toBe(true);
    expect(o?.deliverable).toBe(true);
  });

  it("drops an entity with no reference or no positive area", () => {
    expect(mapBrownfieldEntity(entity({ reference: "" }))).toBeUndefined();
    expect(mapBrownfieldEntity(entity({ hectares: "0" }))).toBeUndefined();
    expect(mapBrownfieldEntity(entity({ hectares: undefined }))).toBeUndefined();
  });

  it("keeps a site with no point (still assessable by area)", () => {
    const o = mapBrownfieldEntity(entity({ point: undefined }));
    expect(o).toBeDefined();
    expect(o?.location).toBeUndefined();
  });

  it("reads private/unknown ownership as not public", () => {
    expect(mapBrownfieldEntity(entity({ "ownership-status": "not owned by a public authority" }))?.ownershipPublic).toBe(false);
    expect(mapBrownfieldEntity(entity({ "ownership-status": "unknown" }))?.ownershipPublic).toBe(false);
  });
});

describe("opportunityToLandSite", () => {
  it("carries a consented site's register capacity as the consented count", () => {
    const o = mapBrownfieldEntity(entity()) as LandOpportunity;
    const site = opportunityToLandSite(o);
    expect(site.planningStatus).toBe("full");
    expect(site.consentedUnits).toBe(20);
    expect(site.currentUse).toBe("brownfield");
    expect(site.ownerKnown).toBe(true);
  });

  it("does not invent a consent for an unpermissioned site", () => {
    const o = mapBrownfieldEntity(entity({ "planning-permission-status": "not permissioned", "planning-permission-type": "" })) as LandOpportunity;
    const site = opportunityToLandSite(o);
    expect(site.planningStatus).toBe("none");
    expect(site.consentedUnits).toBeUndefined();
  });
});

describe("buildBrownfieldUrl", () => {
  it("queries the brownfield-land dataset, with a point when given", () => {
    const url = buildBrownfieldUrl({ longitude: -1.5, latitude: 52.4, limit: 100 });
    expect(url).toContain("dataset=brownfield-land");
    expect(url).toContain("longitude=-1.5");
    expect(url).toContain("latitude=52.4");
    expect(url).toContain("limit=100");
  });
});

/** A transport answering the entity.json call from a fixture; robots 404 → allowed. */
function fetcherReturning(body: string | undefined, status = 200): Fetcher {
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/robots.txt")) return new Response("", { status: 404 });
    if (url.includes("entity.json")) {
      return body === undefined ? new Response("boom", { status: 500 }) : new Response(body, { status });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return new Fetcher({ transport: fn, now: () => 0, sleep: async () => undefined });
}

describe("fetchBrownfieldSites (through the Fetcher)", () => {
  it("maps a real-shaped response to opportunities", async () => {
    const body = JSON.stringify({ entities: [entity(), entity({ reference: "BLR-2", hectares: "0" })] });
    const r = await fetchBrownfieldSites(fetcherReturning(body), { longitude: -1.49, latitude: 52.42 });
    expect(r.ok).toBe(true);
    // The zero-area entity is dropped, not shown as a zero-area site.
    expect(r.opportunities).toHaveLength(1);
    expect(r.opportunities[0]?.reference).toBe("BLR-1");
  });

  it("returns no opportunities (not a false 'none here') when the fetch fails", async () => {
    const r = await fetchBrownfieldSites(fetcherReturning(undefined), { longitude: -1.49, latitude: 52.42 });
    expect(r.ok).toBe(false);
    expect(r.opportunities).toHaveLength(0);
    expect(r.outcome).not.toBe("ok");
  });

  it("refuses a host the source is not bound to", async () => {
    const r = await new Fetcher({
      transport: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
      now: () => 0,
      sleep: async () => undefined,
    }).get("brownfield-land", "https://evil.example.com/entity.json");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("host-not-allowed");
  });
});

describe("landSourcing", () => {
  it("is empty by default (feed gated at the source)", () => {
    delete process.env.LAND_SOURCING_FIXTURES;
    const v = landSourcing();
    expect(v.sites).toHaveLength(0);
    expect(v.feedConnected).toBe(false);
    expect(v.pilot).toBe(false);
  });

  it("serves the pilot set when fixtures are on, assessed and ranked by score", () => {
    process.env.LAND_SOURCING_FIXTURES = "1";
    try {
      const v = landSourcing();
      expect(v.pilot).toBe(true);
      expect(v.sites.length).toBeGreaterThan(0);
      // Ranked: each score is >= the next.
      for (let i = 1; i < v.sites.length; i++) {
        expect(v.sites[i - 1]!.assessment.sourceabilityScore).toBeGreaterThanOrEqual(v.sites[i]!.assessment.sourceabilityScore);
      }
      // A connected LIVE feed is still false — fixtures are a pilot, not a feed.
      expect(v.feedConnected).toBe(false);
    } finally {
      delete process.env.LAND_SOURCING_FIXTURES;
    }
  });
});
