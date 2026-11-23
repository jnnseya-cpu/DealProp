import { describe, expect, it } from "vitest";
import { mapPlanningEntities, LAND_CONSTRAINT_DATASETS, type PlanningEntity } from "@shared/domain/land/planningConstraints";
import { Fetcher } from "@backend/discovery/fetcher";
import { fetchPlanningConstraints } from "@backend/land/planningData";
import { enrichConstraints } from "@backend/land/enrich";
import { sourcePermits } from "@shared/domain/sources";
import type { LandSite } from "@shared/domain/land/types";

/**
 * planning.data.gov.uk — the free, licensed constraint source. The two tests
 * that matter in discovery: nothing is read from a host the licence does not
 * cover, and a designation means exactly what the dataset says (green belt and
 * flood zone 3 are hard vetoes; a conservation area is soft).
 */

describe("planning-data is licensed under the OGL", () => {
  it("is readable for internal analysis and display", () => {
    expect(sourcePermits("planning-data", "internal-analysis")).toBe(true);
    expect(sourcePermits("planning-data", "display")).toBe(true);
  });
});

describe("LAND_CONSTRAINT_DATASETS", () => {
  it("does not query flood from planning.data.gov.uk (it is EA data, not on this platform)", () => {
    // Querying flood here would always return nothing and imply a check we are
    // not making — the honesty fix after a real site (Coxford Road) exposed it.
    expect(LAND_CONSTRAINT_DATASETS).not.toContain("flood-risk-zone");
  });

  it("still queries the green-belt and TPO designations", () => {
    expect(LAND_CONSTRAINT_DATASETS).toContain("green-belt");
    expect(LAND_CONSTRAINT_DATASETS).toContain("tree-preservation-zone");
  });
});

describe("mapPlanningEntities", () => {
  it("maps green belt, flood zone 3 and SSSI to hard constraints", () => {
    const entities: PlanningEntity[] = [
      { dataset: "green-belt", name: "West Midlands Green Belt" },
      { dataset: "flood-risk-zone", "flood-risk-level": "3" },
      { dataset: "site-of-special-scientific-interest", name: "Cannock Chase" },
    ];
    const m = mapPlanningEntities(entities);
    const hard = m.constraints.filter((c) => c.severity === "hard").map((c) => c.code);
    expect(hard).toContain("green-belt");
    expect(hard).toContain("flood-zone-3");
    expect(hard).toContain("sssi");
  });

  it("maps a conservation area and flood zone 2 as soft", () => {
    const m = mapPlanningEntities([
      { dataset: "conservation-area", name: "Old Town" },
      { dataset: "flood-risk-zone", "flood-risk-level": "2" },
    ]);
    expect(m.constraints.find((c) => c.code === "conservation-area")?.severity).toBe("soft");
    expect(m.constraints.find((c) => c.code === "flood-zone-2")?.severity).toBe("soft");
  });

  it("keeps the hardest severity when a code appears twice", () => {
    const m = mapPlanningEntities([
      { dataset: "flood-risk-zone", "flood-risk-level": "2" },
      { dataset: "flood-risk-zone", "flood-risk-level": "3" },
    ]);
    // Both are flood zones but map to different codes; zone 3 must be hard.
    expect(m.constraints.find((c) => c.code === "flood-zone-3")?.severity).toBe("hard");
  });

  it("preserves an unmapped designation rather than dropping it", () => {
    const m = mapPlanningEntities([{ dataset: "article-4-direction", name: "Town centre A4" }]);
    expect(m.designations).toContain("article-4-direction");
    expect(m.constraints).toHaveLength(0);
  });

  it("sets the allocation flag from an allocation dataset", () => {
    const m = mapPlanningEntities([{ dataset: "site-allocation", name: "SA12" }]);
    expect(m.allocation).toBe(true);
  });

  it("ignores entities with no dataset", () => {
    expect(mapPlanningEntities([{ name: "nameless" }]).constraints).toHaveLength(0);
  });
});

/** A transport that answers the entity.json call from a fixture; robots 404 → allowed. */
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

describe("fetchPlanningConstraints (through the Fetcher)", () => {
  const point = { longitude: -1.5, latitude: 52.4 };

  it("fetches and maps a real-shaped response", async () => {
    const body = JSON.stringify({
      entities: [
        { dataset: "green-belt", name: "WM Green Belt" },
        { dataset: "conservation-area", name: "Old Town" },
      ],
    });
    const r = await fetchPlanningConstraints(fetcherReturning(body), point);
    expect(r.ok).toBe(true);
    expect(r.constraints.map((c) => c.code)).toEqual(expect.arrayContaining(["green-belt", "conservation-area"]));
  });

  it("returns no constraints (not a false 'clear') when the fetch fails", async () => {
    const r = await fetchPlanningConstraints(fetcherReturning(undefined), point);
    expect(r.ok).toBe(false);
    expect(r.constraints).toHaveLength(0);
    // A feed gap is unknown data, never an invented clear result.
    expect(r.outcome).not.toBe("ok");
  });

  it("refuses a host the source is not bound to", async () => {
    // The connector only ever asks for planning.data.gov.uk; prove the gate
    // itself refuses an off-allowlist host for this source key.
    const r = await new Fetcher({ transport: (async () => new Response("", { status: 200 })) as unknown as typeof fetch, now: () => 0, sleep: async () => undefined })
      .get("planning-data", "https://evil.example.com/entity.json");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("host-not-allowed");
  });
});

const site = (over: Partial<LandSite> = {}): LandSite => ({
  id: "s1",
  postcodeArea: "WV",
  locality: "x",
  location: { longitude: -2.1, latitude: 52.59 },
  areaHectares: 2,
  currentUse: "agricultural",
  settlement: "edge-of-settlement",
  planningStatus: "none",
  constraints: [],
  ownerKnown: false,
  openlyMarketed: false,
  ...over,
});

describe("enrichConstraints", () => {
  it("merges real planning constraints into the site", async () => {
    const body = JSON.stringify({ entities: [{ dataset: "green-belt", name: "GB" }] });
    const e = await enrichConstraints(site({ constraints: [] }), fetcherReturning(body));
    expect(e.enriched).toBe(true);
    expect(e.site.constraints.map((c) => c.code)).toContain("green-belt");
  });

  it("fails open to recorded constraints when the fetch fails (no false clear)", async () => {
    const recorded: LandSite = site({ constraints: [{ code: "tpo", severity: "soft" }] });
    const e = await enrichConstraints(recorded, fetcherReturning(undefined));
    expect(e.enriched).toBe(false);
    expect(e.site.constraints.map((c) => c.code)).toEqual(["tpo"]);
  });

  it("skips a site with no point", async () => {
    const e = await enrichConstraints(site({ location: undefined }), fetcherReturning("{}"));
    expect(e.enriched).toBe(false);
    expect(e.note).toMatch(/no point/);
  });
});
