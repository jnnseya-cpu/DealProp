import { describe, expect, it } from "vitest";
import { siteFromInput, postcodeArea, DECLARABLE_CONSTRAINTS } from "@shared/domain/land/input";
import { geocodePostcode } from "@backend/land/geocode";
import { Fetcher } from "@backend/discovery/fetcher";

/**
 * The "paste a site, get a verdict" input path: parse what a user typed into a
 * LandSite, and geocode the postcode through the one sanctioned outbound path.
 * The parse is pure; it must apply safe defaults, never understate, and report
 * what was missing rather than guess.
 */

describe("postcodeArea", () => {
  it("takes the leading letters, uppercased", () => {
    expect(postcodeArea("b29 6ad")).toBe("B");
    expect(postcodeArea("CV8 1AA")).toBe("CV");
    expect(postcodeArea("  wv10 9xy ")).toBe("WV");
  });

  it("is empty when there are no leading letters", () => {
    expect(postcodeArea("12345")).toBe("");
  });
});

describe("siteFromInput", () => {
  it("parses a complete input into a LandSite", () => {
    const { site, postcode, errors } = siteFromInput({
      postcode: "CV8 1AA",
      locality: "Kenilworth",
      acres: "3",
      use: "agricultural",
      settlement: "edge-of-settlement",
      planning: "none",
    });
    expect(errors).toHaveLength(0);
    expect(postcode).toBe("CV8 1AA");
    expect(site.postcodeArea).toBe("CV");
    expect(site.locality).toBe("Kenilworth");
    // 3 acres → 1.21 ha (3 × 0.404686, rounded to 2dp).
    expect(site.areaHectares).toBe(1.21);
    expect(site.currentUse).toBe("agricultural");
    expect(site.settlement).toBe("edge-of-settlement");
    expect(site.planningStatus).toBe("none");
  });

  it("flags a missing postcode and a missing/zero size", () => {
    const { errors } = siteFromInput({ postcode: "", acres: "0" });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/postcode/i);
    expect(errors.join(" ")).toMatch(/acres/i);
  });

  it("rejects a non-numeric size", () => {
    const { errors } = siteFromInput({ postcode: "B1 1AA", acres: "big" });
    expect(errors.some((e) => /acres/i.test(e))).toBe(true);
  });

  it("falls back to safe defaults for unknown enum values", () => {
    const { site } = siteFromInput({
      postcode: "B1 1AA",
      acres: "1",
      use: "nonsense",
      settlement: "metropolis",
      planning: "granted-forever",
    });
    expect(site.currentUse).toBe("agricultural");
    expect(site.settlement).toBe("edge-of-settlement");
    expect(site.planningStatus).toBe("none");
  });

  it("keeps consented units only when they are a positive number", () => {
    expect(siteFromInput({ postcode: "B1 1AA", acres: "1", units: "12" }).site.consentedUnits).toBe(12);
    expect(siteFromInput({ postcode: "B1 1AA", acres: "1", units: "" }).site.consentedUnits).toBeUndefined();
    expect(siteFromInput({ postcode: "B1 1AA", acres: "1", units: "0" }).site.consentedUnits).toBeUndefined();
    expect(siteFromInput({ postcode: "B1 1AA", acres: "1", units: "-4" }).site.consentedUnits).toBeUndefined();
  });

  it("maps ticked constraint keys to constraints with their declared severity", () => {
    const { site } = siteFromInput({
      postcode: "B1 1AA",
      acres: "1",
      constraints: ["green-belt", "conservation-area", "unknown-key"],
    });
    const codes = site.constraints.map((c) => c.code);
    expect(codes).toContain("green-belt");
    expect(codes).toContain("conservation-area");
    // An unrecognised key is dropped, not invented.
    expect(site.constraints).toHaveLength(2);
    expect(site.constraints.find((c) => c.code === "green-belt")?.severity).toBe("hard");
    expect(site.constraints.find((c) => c.code === "conservation-area")?.severity).toBe("soft");
  });

  it("every declarable constraint has a matching code and a label", () => {
    for (const [key, c] of Object.entries(DECLARABLE_CONSTRAINTS)) {
      expect(c.code).toBe(key);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("defaults locality to the postcode and marks the lead off-market", () => {
    const { site } = siteFromInput({ postcode: "LE1 2AB", acres: "2" });
    expect(site.locality).toBe("LE1 2AB");
    expect(site.ownerKnown).toBe(false);
    expect(site.openlyMarketed).toBe(false);
  });
});

/** A transport that answers the postcodes.io lookup from a fixture; robots 404 → allowed. */
function geocoder(body: string | undefined, status = 200): Fetcher {
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/robots.txt")) return new Response("", { status: 404 });
    if (url.includes("api.postcodes.io")) {
      return body === undefined ? new Response("boom", { status: 500 }) : new Response(body, { status });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return new Fetcher({ transport: fn, now: () => 0, sleep: async () => undefined });
}

describe("geocodePostcode (through the Fetcher)", () => {
  it("returns the point from a real-shaped response", async () => {
    const body = JSON.stringify({ status: 200, result: { longitude: -1.56, latitude: 52.34 } });
    const r = await geocodePostcode(geocoder(body), "CV8 1AA");
    expect(r.ok).toBe(true);
    expect(r.longitude).toBe(-1.56);
    expect(r.latitude).toBe(52.34);
  });

  it("reports not-found when the postcode has no result", async () => {
    const body = JSON.stringify({ status: 404, result: null });
    const r = await geocodePostcode(geocoder(body), "ZZ1 1ZZ");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("not-found");
  });

  it("fails cleanly on an empty postcode without calling out", async () => {
    const r = await geocodePostcode(geocoder("{}"), "   ");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("not-found");
  });

  it("surfaces a transport failure rather than inventing a point", async () => {
    const r = await geocodePostcode(geocoder(undefined), "CV8 1AA");
    expect(r.ok).toBe(false);
    expect(r.longitude).toBeUndefined();
  });

  it("refuses a host the source is not bound to", async () => {
    const r = await new Fetcher({
      transport: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
      now: () => 0,
      sleep: async () => undefined,
    }).get("postcodes-io", "https://evil.example.com/postcodes/CV81AA");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("host-not-allowed");
  });
});
