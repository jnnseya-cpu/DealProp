import { describe, expect, it } from "vitest";
import {
  mapBrownfieldEntity,
  mapBrownfieldPlanning,
  parseWktPoint,
  postcodeFromAddress,
  opportunityToLandSite,
  type BrownfieldEntity,
  type LandOpportunity,
} from "@shared/domain/land/brownfield";
import { buildBrownfieldUrl, bboxPolygon, fetchBrownfieldSites } from "@backend/land/brownfieldSource";
import { landSourcing, WEST_MIDLANDS_BBOX } from "@backend/land/sourcingService";
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

// Real planning.data.gov.uk field shapes, confirmed against a live request:
// hyphenated controlled vocabularies and the site label in `site-address`.
describe("real register shapes (hyphenated vocabularies)", () => {
  const real = (over: Partial<BrownfieldEntity> = {}): BrownfieldEntity => ({
    reference: "BFR001",
    name: "BFR001",
    "site-address": "Glendaragh, Barn Park Road, Teignmouth TQ14 8PN",
    "organisation-entity": 336,
    point: "POINT (-3.493786 50.549744)",
    hectares: "0.26",
    "ownership-status": "not-owned-by-a-public-authority",
    "minimum-net-dwellings": "15",
    "maximum-net-dwellings": "15",
    "planning-permission-status": "permissioned",
    "planning-permission-type": "full-planning-permission",
    deliverable: "yes",
    "entry-date": "2024-12-16",
    ...over,
  });

  it("reads 'not-owned-by-a-public-authority' as private, not public", () => {
    expect(mapBrownfieldEntity(real())?.ownershipPublic).toBe(false);
  });

  it("reads 'owned-by-a-public-authority' as public", () => {
    expect(mapBrownfieldEntity(real({ "ownership-status": "owned-by-a-public-authority" }))?.ownershipPublic).toBe(true);
  });

  it("never invents a consent from 'not-permissioned'", () => {
    const o = mapBrownfieldEntity(real({ "planning-permission-status": "not-permissioned", "planning-permission-type": "" }));
    expect(o?.planningStatus).toBe("none");
    expect(opportunityToLandSite(o as LandOpportunity).consentedUnits).toBeUndefined();
  });

  it("maps hyphenated 'full-planning-permission' to full", () => {
    expect(mapBrownfieldEntity(real())?.planningStatus).toBe("full");
  });

  it("takes the display name and postcode from site-address", () => {
    const o = mapBrownfieldEntity(real());
    expect(o?.name).toContain("Teignmouth");
    expect(o?.postcode).toBe("TQ14 8PN");
    expect(o?.organisationEntity).toBe(336);
  });
});

describe("postcodeFromAddress", () => {
  it("parses and normalises a trailing postcode", () => {
    expect(postcodeFromAddress("Glendaragh, Barn Park Road, Teignmouth TQ14 8PN")).toBe("TQ14 8PN");
    expect(postcodeFromAddress("Site, Dudley DY11PY")).toBe("DY1 1PY");
  });
  it("is undefined when there is no postcode", () => {
    expect(postcodeFromAddress("A field with no postcode")).toBeUndefined();
    expect(postcodeFromAddress(undefined)).toBeUndefined();
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

  it("uses an intersects geometry for a region box", () => {
    const url = buildBrownfieldUrl({ bbox: WEST_MIDLANDS_BBOX });
    expect(url).toContain("geometry_relation=intersects");
    expect(decodeURIComponent(url)).toContain("POLYGON((");
    // A box query must not also pin a single point.
    expect(url).not.toContain("longitude=");
  });

  it("appends an organisation_entity for each authority filter", () => {
    const url = buildBrownfieldUrl({ organisationEntities: [55, 76] });
    expect(url).toContain("organisation_entity=55");
    expect(url).toContain("organisation_entity=76");
  });
});

describe("bboxPolygon", () => {
  it("produces a closed ring in lng lat order", () => {
    expect(bboxPolygon({ west: -2, south: 52, east: -1, north: 53 })).toBe(
      "POLYGON((-2 52, -1 52, -1 53, -2 53, -2 52))",
    );
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
  it("is empty by default (feed gated at the source)", async () => {
    delete process.env.LAND_SOURCING_FIXTURES;
    delete process.env.BROWNFIELD_LIVE;
    const v = await landSourcing();
    expect(v.sites).toHaveLength(0);
    expect(v.feedConnected).toBe(false);
    expect(v.pilot).toBe(false);
  });

  it("serves the pilot set when fixtures are on, assessed and ranked by score", async () => {
    delete process.env.BROWNFIELD_LIVE;
    process.env.LAND_SOURCING_FIXTURES = "1";
    try {
      const v = await landSourcing();
      expect(v.pilot).toBe(true);
      expect(v.sites.length).toBeGreaterThan(0);
      for (let i = 1; i < v.sites.length; i++) {
        expect(v.sites[i - 1]!.assessment.sourceabilityScore).toBeGreaterThanOrEqual(v.sites[i]!.assessment.sourceabilityScore);
      }
      expect(v.feedConnected).toBe(false);
    } finally {
      delete process.env.LAND_SOURCING_FIXTURES;
    }
  });

  it("reads the live register (bbox) when BROWNFIELD_LIVE=1", async () => {
    process.env.BROWNFIELD_LIVE = "1";
    try {
      const body = JSON.stringify({
        entities: [
          {
            reference: "L1",
            "site-address": "Live site, Coventry CV1 1AA",
            point: "POINT (-1.5 52.41)",
            hectares: "0.5",
            "ownership-status": "owned-by-a-public-authority",
            "maximum-net-dwellings": "10",
            "planning-permission-status": "permissioned",
            "planning-permission-type": "full-planning-permission",
          },
        ],
      });
      const v = await landSourcing(fetcherReturning(body));
      expect(v.feedConnected).toBe(true);
      expect(v.pilot).toBe(false);
      expect(v.sites).toHaveLength(1);
      expect(v.sites[0]?.opportunity.postcode).toBe("CV1 1AA");
    } finally {
      delete process.env.BROWNFIELD_LIVE;
    }
  });

  it("shows unknown coverage, not a false empty, when the live feed fails", async () => {
    process.env.BROWNFIELD_LIVE = "1";
    try {
      const v = await landSourcing(fetcherReturning(undefined));
      expect(v.feedConnected).toBe(true);
      expect(v.sites).toHaveLength(0);
      expect(v.error).toBeDefined();
    } finally {
      delete process.env.BROWNFIELD_LIVE;
    }
  });
});
