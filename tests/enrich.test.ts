import { describe, expect, it } from "vitest";
import { enrichAddress } from "@backend/discovery/enrich";
import { parsePricePaidSparql } from "@backend/sources/pricePaid";
import type { EpcCertificate } from "@backend/sources/epc";
import type { PricePaidRecord } from "@backend/discovery/properties";
import { attribute } from "@shared/domain/sources";
import { fromMajor } from "@shared/money";

const cert: EpcCertificate = {
  lmkKey: "x",
  address: "14 Acacia Avenue, Birmingham",
  addressLine1: "14 Acacia Avenue",
  postcode: "B29 6AD",
  lodgedAt: "2021-05-01",
  propertyType: "House",
  floorAreaSqm: 85,
  source: attribute("epc-register", "2021-05-01"),
};

const sale: PricePaidRecord = {
  price: fromMajor(200_000),
  soldAt: "2019-01-01",
  postcode: "B29 6AD",
  propertyType: "T",
  newBuild: false,
  tenure: "F",
  paon: "14",
  saon: "",
  street: "Acacia Avenue",
  category: "A",
};

describe("enriching an address from the open registers", () => {
  it("fills type and floor area from EPC, tenure and last sale from Price Paid", async () => {
    const e = await enrichAddress("14 Acacia Avenue, Birmingham, B29 6AD", "B29 6AD", {
      epc: async () => [cert],
      sales: async () => [sale],
    });
    expect(e.propertyType).toBe("house");
    expect(e.floorAreaSqm).toBe(85);
    expect(e.tenure).toBe("freehold");
    expect(e.lastSoldAt).toBe("2019-01-01");
    expect(Number(e.lastSoldPrice)).toBe(Number(fromMajor(200_000)));
  });

  it("degrades to notes, not a crash, when a source throws or misses", async () => {
    const e = await enrichAddress("99 Nowhere Road, B29 6AD", "B29 6AD", {
      epc: async () => {
        throw new Error("EPC_API_KEY not configured");
      },
      sales: async () => [sale], // different address → no match
    });
    expect(e.propertyType).toBeUndefined();
    expect(e.tenure).toBeUndefined();
    expect(e.notes.join(" ")).toContain("EPC");
    expect(e.notes.join(" ")).toContain("none matched");
  });
});

describe("the Price Paid SPARQL results parse to records", () => {
  it("reads price, date, tenure, type and category from bindings", () => {
    const json = {
      results: {
        bindings: [
          {
            paon: { value: "14" },
            street: { value: "ACACIA AVENUE" },
            pricePaid: { value: "200000" },
            transactionDate: { value: "2019-01-01" },
            category: { value: "http://landregistry.data.gov.uk/def/ppi/standardPricePaidTransaction" },
            estateType: { value: "http://landregistry.data.gov.uk/def/common/freehold" },
            propertyType: { value: "http://landregistry.data.gov.uk/def/ppi/terraced" },
          },
        ],
      },
    };
    const rows = parsePricePaidSparql(json);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.price)).toBe(Number(fromMajor(200_000)));
    expect(rows[0]?.soldAt).toBe("2019-01-01");
    expect(rows[0]?.tenure).toBe("F");
    expect(rows[0]?.propertyType).toBe("T");
    expect(rows[0]?.category).toBe("A");
  });

  it("returns an empty list on a body that is not SPARQL results", () => {
    expect(parsePricePaidSparql("nope")).toEqual([]);
    expect(parsePricePaidSparql({})).toEqual([]);
  });
});
