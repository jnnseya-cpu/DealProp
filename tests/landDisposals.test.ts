import { describe, expect, it } from "vitest";
import {
  classifyDisposal,
  mapDisposalRelease,
  type OcdsRelease,
} from "@shared/domain/land/disposals";
import { buildDisposalsUrl, releasesFrom, fetchDisposals } from "@backend/land/disposalsSource";
import { landDisposals } from "@backend/land/disposalsService";
import { Fetcher } from "@backend/discovery/fetcher";
import { sourcePermits } from "@shared/domain/sources";

/**
 * Contracts Finder disposals — the "for sale now" feed. What matters: it is OGL,
 * and the classifier tells a genuine land disposal apart from the far larger
 * volume of services procurement, defaulting to exclusion.
 */

describe("contracts-finder is OGL-licensed for display", () => {
  it("permits internal analysis and display", () => {
    expect(sourcePermits("contracts-finder", "internal-analysis")).toBe(true);
    expect(sourcePermits("contracts-finder", "display")).toBe(true);
  });
});

const saleCpv: OcdsRelease = {
  id: "n1",
  date: "2026-10-02",
  tender: {
    title: "Freehold disposal of former depot",
    description: "Offers invited for the freehold.",
    value: { amount: 750000, currency: "GBP" },
    tenderPeriod: { endDate: "2026-12-15T12:00:00Z" },
    classification: { scheme: "CPV", id: "70122200", description: "Land sale services" },
    items: [{ deliveryAddresses: [{ region: "West Midlands", postalCode: "CV6 5EH" }] }],
  },
  buyer: { name: "Coventry City Council" },
};

const keywordOnly: OcdsRelease = {
  id: "n2",
  date: "2026-10-20",
  tender: {
    title: "Development opportunity at Bilston Road",
    description: "A redevelopment opportunity on council-owned land.",
    classification: { scheme: "CPV", id: "70110000", description: "Development of real estate" },
  },
  buyer: { name: "City of Wolverhampton Council" },
};

const servicesProcurement: OcdsRelease = {
  id: "n3",
  tender: {
    title: "Grounds maintenance and estate management services",
    description: "A framework for grounds maintenance.",
    classification: { scheme: "CPV", id: "70330000", description: "Property management services" },
  },
  buyer: { name: "Birmingham City Council" },
};

describe("classifyDisposal", () => {
  it("accepts a sale-of-land CPV on its own", () => {
    const m = classifyDisposal(saleCpv);
    expect(m.isDisposal).toBe(true);
    expect(m.matchedOn.join(" ")).toMatch(/70122200/);
  });

  it("accepts a disposal keyword on its own", () => {
    const m = classifyDisposal(keywordOnly);
    expect(m.isDisposal).toBe(true);
    expect(m.matchedOn.join(" ")).toMatch(/opportunity|development/i);
  });

  it("rejects a services procurement, even with a real-estate CPV", () => {
    // 70330000 is a 70-series CPV, but there is no disposal keyword and no sale
    // CPV, so it must not be surfaced as a development site.
    expect(classifyDisposal(servicesProcurement).isDisposal).toBe(false);
  });
});

describe("mapDisposalRelease", () => {
  it("maps a disposal with a sterling value and a notice link", () => {
    const d = mapDisposalRelease(saleCpv);
    expect(d).toBeDefined();
    expect(d?.authority).toBe("Coventry City Council");
    expect(d?.valueGbp).toBe(750000);
    expect(d?.postcode).toBe("CV6 5EH");
    expect(d?.deadline).toBe("2026-12-15T12:00:00Z");
    expect(d?.url).toContain("contractsfinder.service.gov.uk/Notice/");
  });

  it("drops a non-disposal", () => {
    expect(mapDisposalRelease(servicesProcurement)).toBeUndefined();
  });

  it("leaves value unset when the amount is not sterling", () => {
    const d = mapDisposalRelease({ ...saleCpv, tender: { ...saleCpv.tender, value: { amount: 500000, currency: "EUR" } } });
    expect(d?.valueGbp).toBeUndefined();
  });
});

describe("buildDisposalsUrl", () => {
  it("queries the Contracts Finder OCDS search with the real params (no keyword search)", () => {
    const url = buildDisposalsUrl({ publishedFrom: "2026-11-01T00:00:00", limit: 50 });
    expect(url).toContain("contractsfinder.service.gov.uk/Published/Notices/OCDS/Search");
    expect(url).toContain("limit=50");
    expect(url).toContain("stages=tender%2Cplanning");
    expect(url).toContain("publishedFrom=2026-11-01");
    // The current API has no keyword search; we never send one.
    expect(url).not.toContain("keyword");
  });

  it("clamps the limit to the API's 1..100 and passes a cursor", () => {
    expect(buildDisposalsUrl({ limit: 500 })).toContain("limit=100");
    expect(buildDisposalsUrl({ cursor: "abc" })).toContain("cursor=abc");
  });
});

describe("releasesFrom", () => {
  it("pulls releases out of a results envelope", () => {
    const body = JSON.stringify({ results: [{ releases: [saleCpv] }, { releases: [keywordOnly] }] });
    expect(releasesFrom(body)).toHaveLength(2);
  });
  it("handles a top-level releases array", () => {
    expect(releasesFrom(JSON.stringify({ releases: [saleCpv] }))).toHaveLength(1);
  });
  it("returns nothing for unreadable bodies", () => {
    expect(releasesFrom("not json")).toHaveLength(0);
  });
});

function fetcherReturning(body: string | undefined): Fetcher {
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = input.toString();
    if (url.includes("/robots.txt")) return new Response("", { status: 404 });
    if (url.includes("/Search")) {
      return body === undefined ? new Response("boom", { status: 500 }) : new Response(body, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return new Fetcher({ transport: fn, now: () => 0, sleep: async () => undefined });
}

describe("fetchDisposals (through the Fetcher)", () => {
  it("fetches, classifies and keeps only disposals", async () => {
    const body = JSON.stringify({ results: [{ releases: [saleCpv] }, { releases: [servicesProcurement] }] });
    const r = await fetchDisposals(fetcherReturning(body), { publishedFrom: "2026-11-01" });
    expect(r.ok).toBe(true);
    expect(r.disposals).toHaveLength(1);
    expect(r.disposals[0]?.id).toBe("n1");
  });

  it("returns none (not a false empty) when the fetch fails", async () => {
    const r = await fetchDisposals(fetcherReturning(undefined), {});
    expect(r.ok).toBe(false);
    expect(r.disposals).toHaveLength(0);
  });

  it("refuses a host the source is not bound to", async () => {
    const r = await new Fetcher({
      transport: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
      now: () => 0,
      sleep: async () => undefined,
    }).get("contracts-finder", "https://evil.example.com/Search");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("host-not-allowed");
  });
});

describe("landDisposals", () => {
  it("is empty by default (feed gated at the source)", () => {
    delete process.env.DISPOSALS_FIXTURES;
    const v = landDisposals();
    expect(v.disposals).toHaveLength(0);
    expect(v.feedConnected).toBe(false);
  });

  it("serves the pilot set with the services procurement filtered out, ranked by deadline", () => {
    process.env.DISPOSALS_FIXTURES = "1";
    try {
      const v = landDisposals();
      expect(v.pilot).toBe(true);
      // Three fixtures, one is a services procurement → two disposals.
      expect(v.disposals).toHaveLength(2);
      // Soonest deadline first.
      expect(v.disposals[0]?.deadline?.localeCompare(v.disposals[1]?.deadline ?? "")).toBeLessThanOrEqual(0);
    } finally {
      delete process.env.DISPOSALS_FIXTURES;
    }
  });
});
