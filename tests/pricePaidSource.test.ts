import { describe, expect, it, vi } from "vitest";
import { fromMajor } from "@shared/money";
import { fetchSales } from "@backend/sources/pricePaid";
import type { PricePaidSale } from "@backend/sources/pricePaidBulk";

/**
 * `fetchSales` prefers the bulk store and only falls back to the live
 * linked-data endpoint where nothing has been loaded for the postcode. This is
 * the whole point of the bulk loader: a loaded area is served densely and
 * offline; an unloaded one behaves exactly as it did before.
 */

function sale(over: Partial<PricePaidSale> = {}): PricePaidSale {
  return {
    transactionId: "{TX-1}",
    price: fromMajor(240_000),
    soldAt: "2024-05-01",
    postcode: "B23 5AB",
    propertyType: "T",
    newBuild: false,
    tenure: "F",
    paon: "14",
    saon: "",
    street: "ACACIA ROAD",
    category: "A",
    ...over,
  };
}

/** A SPARQL results body with one transaction, as the live endpoint returns. */
function sparqlResponse() {
  const body = {
    results: {
      bindings: [
        {
          paon: { value: "9" },
          street: { value: "LIVE STREET" },
          pricePaid: { value: "199000" },
          transactionDate: { value: "2024-02-02" },
          category: { value: "http://landregistry.data.gov.uk/def/ppi/standardPricePaidTransaction" },
          propertyType: { value: "http://landregistry.data.gov.uk/def/common/terraced" },
          estateType: { value: "http://landregistry.data.gov.uk/def/common/freehold" },
        },
      ],
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("fetchSales store-first behaviour", () => {
  it("returns the dense bulk set and never touches the network when the area is loaded", async () => {
    const fetchImpl = vi.fn(async () => sparqlResponse()) as unknown as typeof fetch;
    const result = await fetchSales("B23 5AB", {
      fetchImpl,
      fromStore: async () => [sale({ street: "STORE STREET" })],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.street).toBe("STORE STREET");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the live endpoint when the store has nothing for the postcode", async () => {
    const fetchImpl = vi.fn(async () => sparqlResponse()) as unknown as typeof fetch;
    const result = await fetchSales("B23 5AB", { fetchImpl, fromStore: async () => [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0]!.street).toBe("LIVE STREET");
    expect(result[0]!.price).toBe(fromMajor(199_000));
    // The live endpoint stamps the queried postcode onto each record.
    expect(result[0]!.postcode).toBe("B23 5AB");
  });

  it("returns nothing, and does not read the store, for a malformed postcode", async () => {
    const fetchImpl = vi.fn(async () => sparqlResponse()) as unknown as typeof fetch;
    const fromStore = vi.fn(async () => [sale()]);
    const result = await fetchSales("not a postcode", { fetchImpl, fromStore });
    expect(result).toEqual([]);
    expect(fromStore).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
