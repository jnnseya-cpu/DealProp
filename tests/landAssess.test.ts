import { describe, expect, it } from "vitest";
import { assessSiteFromInput } from "@backend/land/assess";
import { Fetcher } from "@backend/discovery/fetcher";

/**
 * The end-to-end "assess a site you're considering" path: parse → geocode →
 * pull real planning designations → run the engine. The invariants that matter:
 * a parse error stops before any network call; a live green-belt designation
 * caps the verdict exactly as a declared one would; and a planning/geocode
 * outage never produces a false "all clear" — the verdict still stands on what
 * the user entered, with an honest note.
 */

/** A transport answering both postcodes.io and planning entity.json from fixtures. */
function stack(opts: { geo?: string | undefined; planning?: string | undefined }): Fetcher {
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/robots.txt")) return new Response("", { status: 404 });
    if (url.includes("api.postcodes.io")) {
      return opts.geo === undefined ? new Response("boom", { status: 500 }) : new Response(opts.geo, { status: 200 });
    }
    if (url.includes("entity.json")) {
      return opts.planning === undefined ? new Response("boom", { status: 500 }) : new Response(opts.planning, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return new Fetcher({ transport: fn, now: () => 0, sleep: async () => undefined });
}

const geo = JSON.stringify({ status: 200, result: { longitude: -1.56, latitude: 52.34 } });

describe("assessSiteFromInput", () => {
  it("returns errors and runs no assessment when the input is invalid", async () => {
    const r = await assessSiteFromInput({ postcode: "", acres: "0" }, stack({}));
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.assessment).toBeUndefined();
    expect(r.planningChecked).toBe(false);
  });

  it("assesses a clean allocated site and offers the control structures", async () => {
    const r = await assessSiteFromInput(
      { postcode: "CV8 1AA", acres: "3", settlement: "edge-of-settlement", planning: "allocated" },
      stack({ geo, planning: JSON.stringify({ entities: [] }) }),
    );
    expect(r.assessment).toBeDefined();
    expect(r.planningChecked).toBe(true);
    expect(r.assessment?.structures).toEqual(
      expect.arrayContaining(["option", "conditional-contract", "promotion-agreement"]),
    );
    expect(r.assessment?.riskBand).toBe("promotable");
  });

  it("caps the verdict when the live planning map returns green belt", async () => {
    const r = await assessSiteFromInput(
      { postcode: "CV8 1AA", acres: "5", planning: "allocated" },
      stack({ geo, planning: JSON.stringify({ entities: [{ dataset: "green-belt", name: "WM Green Belt" }] }) }),
    );
    expect(r.assessment?.vetoes).toContain("green-belt");
    expect(r.assessment?.riskBand).toBe("blocked");
    expect(r.assessment?.sourceabilityScore).toBeLessThanOrEqual(25);
  });

  it("still assesses on declared inputs, with a note, when the geocode fails (no false clear)", async () => {
    const r = await assessSiteFromInput(
      { postcode: "CV8 1AA", acres: "3", planning: "allocated" },
      stack({ geo: undefined }),
    );
    expect(r.assessment).toBeDefined();
    expect(r.planningChecked).toBe(false);
    expect(r.notes.join(" ")).toMatch(/could not place the postcode/i);
  });

  it("still assesses when the planning fetch fails after a good geocode", async () => {
    const r = await assessSiteFromInput(
      { postcode: "CV8 1AA", acres: "3", planning: "allocated" },
      stack({ geo, planning: undefined }),
    );
    expect(r.assessment).toBeDefined();
    expect(r.planningChecked).toBe(false);
    expect(r.notes.join(" ")).toMatch(/live planning check could not be run/i);
  });

  it("honours a user-declared constraint even when the live check cannot run", async () => {
    const r = await assessSiteFromInput(
      { postcode: "CV8 1AA", acres: "3", planning: "allocated", constraints: ["green-belt"] },
      stack({ geo: undefined }),
    );
    expect(r.assessment?.vetoes).toContain("green-belt");
    expect(r.assessment?.riskBand).toBe("blocked");
  });
});
