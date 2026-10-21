import { describe, expect, it } from "vitest";
import {
  classifyImportUrl,
  isListingNode,
  isPortalHost,
  mapListingJsonLd,
  roleToInventory,
} from "@shared/domain/listingImport";
import { sourcePermits } from "@shared/domain/sources";
import { Fetcher } from "@backend/discovery/fetcher";
import {
  extractJsonLd,
  importListing,
  LISTING_IMPORT_SOURCE,
  pickListingNode,
} from "@backend/discovery/listingImport";

function fetcherWith(routes: Record<string, { status?: number; body?: string }>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    return new Response(route.body ?? "", { status: route.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher: new Fetcher({ transport: fn, now: () => 0, sleep: async () => undefined }) };
}

const NODE = {
  "@type": "SingleFamilyResidence",
  name: "Three-bedroom semi, Northfield",
  address: {
    "@type": "PostalAddress",
    streetAddress: "14 Acacia Avenue",
    addressLocality: "Birmingham",
    postalCode: "b29 6ad",
  },
  numberOfBedrooms: 3,
  floorSize: { value: 88, unitCode: "MTK" },
  offers: { "@type": "Offer", price: "185000", priceCurrency: "GBP" },
};

/* -------------------------------------------------------- classification */

describe("classifying a link before anything is fetched", () => {
  it("accepts a publisher's own https page", () => {
    const c = classifyImportUrl("https://www.northfield-auctions.co.uk/lot/1234");
    expect(c.kind).toBe("importable");
    expect(c.host).toBe("www.northfield-auctions.co.uk");
  });

  it("refuses a portal, with a reason, and does not call it importable", () => {
    for (const url of [
      "https://www.rightmove.co.uk/properties/123456",
      "https://www.zoopla.co.uk/for-sale/details/987",
      "https://www.onthemarket.com/details/55",
    ]) {
      expect(classifyImportUrl(url).kind, url).toBe("portal-refused");
    }
    expect(isPortalHost("www.rightmove.co.uk")).toBe(true);
  });

  it("refuses an insecure link, a login link, an IP and an internal host", () => {
    expect(classifyImportUrl("http://example-site.co.uk/x").kind).toBe("unsupported");
    expect(classifyImportUrl("https://user:pass@site.co.uk/x").kind).toBe("unsupported");
    expect(classifyImportUrl("https://169.254.169.254/latest/meta-data").kind).toBe("unsupported");
    expect(classifyImportUrl("https://localhost/admin").kind).toBe("unsupported");
    expect(classifyImportUrl("https://intranet/x").kind).toBe("unsupported");
    expect(classifyImportUrl("not a url").kind).toBe("unsupported");
  });
});

/* -------------------------------------------------------- mapping facts */

describe("mapping structured data to facts, never inference", () => {
  it("reads the address, postcode, price, beds and floor area", () => {
    const facts = mapListingJsonLd(NODE);
    expect(facts.title).toContain("Northfield");
    expect(facts.address).toBe("14 Acacia Avenue, Birmingham");
    expect(facts.postcode).toBe("B29 6AD");
    expect(facts.priceGbp).toBe(185000);
    expect(facts.bedrooms).toBe(3);
    expect(facts.floorAreaSqm).toBe(88);
  });

  it("recognises a listing node and ignores a non-listing one", () => {
    expect(isListingNode(NODE)).toBe(true);
    expect(isListingNode({ "@type": "Organization", name: "An agent" })).toBe(false);
  });

  it("maps a seller to owner-verified and an agent or auctioneer to agent-authorised", () => {
    expect(roleToInventory("seller")).toEqual({ category: "owner-verified", confirmedBy: "owner" });
    expect(roleToInventory("instructed-agent")).toEqual({ category: "agent-authorised", confirmedBy: "instructed-agent" });
    expect(roleToInventory("auctioneer").category).toBe("agent-authorised");
  });
});

/* -------------------------------------------------------- extraction */

describe("extracting JSON-LD from a page", () => {
  it("finds a node inside a @graph and a standalone block", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({ "@graph": [NODE] })}</script>
      </head><body>…</body></html>`;
    const nodes = extractJsonLd(html);
    expect(pickListingNode(nodes)).toBeDefined();
  });

  it("survives a malformed block without failing the page", () => {
    const html = `<script type="application/ld+json">{ not json }</script>
      <script type="application/ld+json">${JSON.stringify(NODE)}</script>`;
    expect(pickListingNode(extractJsonLd(html))).toBeDefined();
  });
});

/* -------------------------------------------------------- the import gate */

describe("the licence says what may be done with an imported listing", () => {
  it("permits display — the submitter is publishing it — and internal analysis", () => {
    expect(sourcePermits(LISTING_IMPORT_SOURCE, "display")).toBe(true);
    expect(sourcePermits(LISTING_IMPORT_SOURCE, "internal-analysis")).toBe(true);
  });
});

describe("importing through the Fetcher", () => {
  it("reads facts from a publisher's own page", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify(NODE)}</script>`;
    const { fetcher } = fetcherWith({
      "https://www.northfield-auctions.co.uk/robots.txt": { status: 404 },
      "https://www.northfield-auctions.co.uk/lot/1234": { body: html },
    });
    const result = await importListing("https://www.northfield-auctions.co.uk/lot/1234", { fetcher });
    expect(result.ok).toBe(true);
    expect(result.value?.postcode).toBe("B29 6AD");
    expect(result.value?.priceGbp).toBe(185000);
    expect(result.provenance?.inferred).toBe(false);
  });

  it("refuses a portal without making any request", async () => {
    const { fetcher, calls } = fetcherWith({});
    const result = await importListing("https://www.rightmove.co.uk/properties/1", { fetcher });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(result.reason.toLowerCase()).toContain("portal");
  });

  it("tells the submitter plainly when a page has no structured data", async () => {
    const { fetcher } = fetcherWith({
      "https://www.anagent.co.uk/robots.txt": { status: 404 },
      "https://www.anagent.co.uk/p/1": { body: "<html><body>Just marketing prose and photos.</body></html>" },
    });
    const result = await importListing("https://www.anagent.co.uk/p/1", { fetcher });
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("by hand");
  });
});
