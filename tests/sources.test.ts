import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@/lib/money";
import {
  assertSourceUsable,
  attribute,
  attributionLines,
  DATA_SOURCES,
  getSource,
  SourceNotPermitted,
  sourcePermits,
} from "@/domain/sources";
import {
  belowStandard,
  pricePerSqm,
  registryPressure,
  type RegistrySignal,
} from "@/domain/registrySignal";
import {
  latestSale,
  medianPrice,
  parsePricePaidCsv,
  parsePricePaidJson,
} from "@/lib/sources/landRegistry";
import { currentCertificate, parseCertificates } from "@/lib/sources/epc";

const NOW = new Date("2026-08-22T00:00:00.000Z");

describe("licence gate", () => {
  it("refuses portal listings, which is the whole point", () => {
    // GoldMine was never wired up because this input cannot lawfully be taken.
    // The refusal is now enforced rather than remembered.
    expect(() => assertSourceUsable("portal-listings", "internal-analysis")).toThrow(
      SourceNotPermitted,
    );
    expect(() => assertSourceUsable("portal-listings", "internal-analysis")).toThrow(
      /prohibit scraping/,
    );
  });

  it("permits the open sources it has licences for", () => {
    expect(assertSourceUsable("land-registry-ppd", "redistribute").name).toBe("Price Paid Data");
    expect(sourcePermits("epc-register", "display")).toBe(true);
  });

  it("refuses a use the licence does not cover", () => {
    // EPC may be shown to users but not redistributed onward.
    expect(sourcePermits("epc-register", "redistribute")).toBe(false);
    expect(() => assertSourceUsable("epc-register", "redistribute")).toThrow(/permits only/);
  });

  it("refuses to let a seller's own account of their situation leave the building", () => {
    // A seller describing a divorce to get help selling has not agreed to that
    // reaching an investor pack.
    expect(sourcePermits("seller-intake", "internal-analysis")).toBe(true);
    expect(sourcePermits("seller-intake", "display")).toBe(false);
    expect(sourcePermits("seller-intake", "redistribute")).toBe(false);
  });

  it("refuses an unknown source rather than assuming it is fine", () => {
    expect(() => assertSourceUsable("some-scraper", "internal-analysis")).toThrow(/no such source/);
  });

  it("gives every unlicensed source a stated reason", () => {
    // A source that is simply missing looks like an oversight. One that is
    // present and refused is a decision somebody made and can be reviewed.
    for (const s of DATA_SOURCES.filter((x) => x.licence === undefined)) {
      expect(s.unlicensedReason, `${s.key} has no reason`).toBeTruthy();
    }
  });

  it("carries licence attribution through to the data", () => {
    const a = attribute("land-registry-ppd", "2026-07-01");
    expect(a.attribution).toContain("HM Land Registry");
    expect(attributionLines([a, a, attribute("epc-register", "2026-01-01")])).toHaveLength(2);
  });

  it("omits attribution where the licence requires none", () => {
    expect(attribute("seller-intake", "2026-08-01").attribution).toBeUndefined();
    expect(getSource("seller-intake")?.licence?.permits).toEqual(["internal-analysis"]);
  });
});

describe("Price Paid Data", () => {
  const row = (
    id: string,
    price: string,
    date: string,
    paon: string,
    category: string,
    status: string,
  ): string =>
    [id, price, date, "B23 6TT", "T", "N", "F", paon, "", "HIGH ST", "ERDINGTON", "BIRMINGHAM", "BIRMINGHAM", "WEST MIDLANDS", category, status]
      .map((c) => `"${c}"`)
      .join(",");

  const CSV = [
    row("{A1}", "212000", "2019-06-14 00:00", "41", "A", "A"),
    row("{A2}", "198000", "2021-03-02 00:00", "43", "A", "A"),
    row("{A3}", "95000", "2022-01-11 00:00", "45", "B", "A"),
    row("{A4}", "400000", "2020-01-11 00:00", "47", "A", "D"),
  ].join("\n");

  it("parses the published CSV shape", () => {
    const records = parsePricePaidCsv(CSV);
    expect(records).toHaveLength(3); // the "D" record-status row is a deletion
    expect(toMajor(records[0]?.price ?? fromMajor(0))).toBe(212_000);
    expect(records[0]?.date).toBe("2019-06-14");
    expect(records[0]?.address).toBe("41 HIGH ST");
  });

  it("flags category B sales as not arm's length", () => {
    // Repossessions and portfolio transfers dragged into a median make every
    // deal in the street look better than it is.
    const records = parsePricePaidCsv(CSV);
    expect(records.find((r) => r.transactionId === "{A3}")?.armsLength).toBe(false);
    expect(records.find((r) => r.transactionId === "{A1}")?.armsLength).toBe(true);
  });

  it("excludes non-arm's-length sales from the median", () => {
    const median = medianPrice(parsePricePaidCsv(CSV));
    // Only {A1} 212,000 and {A2} 198,000 qualify → 205,000.
    expect(toMajor(median ?? fromMajor(0))).toBe(205_000);
  });

  it("skips unparseable rows instead of defaulting them to zero", () => {
    const bad = '"{X}","not-a-price","2020-01-01 00:00","B1 1AA","T","N","F","1","","A ST","B","B","WM","A","A"';
    expect(parsePricePaidCsv(bad)).toHaveLength(0);
  });

  it("returns no median rather than zero when nothing qualifies", () => {
    expect(medianPrice([])).toBeUndefined();
  });

  it("finds the most recent sale", () => {
    expect(latestSale(parsePricePaidCsv(CSV))?.date).toBe("2022-01-11");
  });

  it("parses the Linked Data API shape", () => {
    const records = parsePricePaidJson({
      result: {
        items: [
          {
            transactionId: "abc",
            pricePaid: 245000,
            transactionDate: "2024-05-02",
            propertyAddress: { postcode: "B21 9AA", paon: "12", street: "SOHO RD", town: "BIRMINGHAM" },
            propertyType: { prefLabel: ["terraced"] },
            estateType: { prefLabel: ["Freehold"] },
            transactionCategory: { prefLabel: ["Standard Price Paid entry"] },
          },
        ],
      },
    });
    expect(records).toHaveLength(1);
    expect(toMajor(records[0]?.price ?? fromMajor(0))).toBe(245_000);
    expect(records[0]?.armsLength).toBe(true);
    expect(records[0]?.source.sourceKey).toBe("land-registry-ppd");
  });

  it("tolerates an empty or malformed API response", () => {
    expect(parsePricePaidJson({})).toHaveLength(0);
    expect(parsePricePaidJson({ result: { items: [{ pricePaid: 0 }] } })).toHaveLength(0);
  });
});

describe("EPC register", () => {
  const BODY = {
    rows: [
      {
        "lmk-key": "K1",
        address: "41 High St",
        postcode: "b23 6tt",
        "current-energy-rating": "f",
        "potential-energy-rating": "C",
        "lodgement-date": "2025-02-11",
        "total-floor-area": "88.5",
        "property-type": "House",
        "construction-age-band": "1900-1929",
      },
      {
        "lmk-key": "K2",
        address: "41 High St",
        postcode: "B23 6TT",
        "current-energy-rating": "E",
        "inspection-date": "2018-07-02",
        "total-floor-area": "88",
      },
    ],
  };

  it("parses ratings, dates and floor area", () => {
    const certs = parseCertificates(BODY);
    expect(certs).toHaveLength(2);
    expect(certs[0]?.rating).toBe("F");
    expect(certs[0]?.floorAreaSqm).toBe(89);
    expect(certs[0]?.postcode).toBe("B23 6TT");
  });

  it("falls back to the inspection date when lodgement is absent", () => {
    expect(parseCertificates(BODY)[1]?.lodgedAt).toBe("2018-07-02");
  });

  it("rejects absurd floor areas rather than producing a nonsense £/sqm", () => {
    const certs = parseCertificates({
      rows: [
        { "lmk-key": "S", "lodgement-date": "2025-01-01", "total-floor-area": "4" },
        { "lmk-key": "B", "lodgement-date": "2025-01-01", "total-floor-area": "9000" },
      ],
    });
    expect(certs[0]?.floorAreaSqm).toBeUndefined();
    expect(certs[1]?.floorAreaSqm).toBeUndefined();
  });

  it("ignores a rating it does not recognise", () => {
    const certs = parseCertificates({
      rows: [{ "lmk-key": "Z", "lodgement-date": "2025-01-01", "current-energy-rating": "Z" }],
    });
    expect(certs[0]?.rating).toBeUndefined();
  });

  it("treats the most recently lodged certificate as current", () => {
    expect(currentCertificate(parseCertificates(BODY))?.lmkKey).toBe("K1");
  });
});

describe("registry pressure", () => {
  function signal(overrides: Partial<RegistrySignal> = {}): RegistrySignal {
    return {
      propertyId: "p1",
      jurisdiction: "GB-ENG",
      sources: [attribute("land-registry-ppd", "2026-07-01")],
      ...overrides,
    };
  }

  it("scores nothing, and says so, when the record holds nothing", () => {
    const result = registryPressure(signal(), NOW);
    expect(result.score).toBe(0);
    expect(result.summary).toContain("statement about the records held");
    expect(result.confidenceBps).toBe(0);
  });

  it("treats a long-term empty property as the strongest signal", () => {
    const result = registryPressure(signal({ longTermEmpty: true }), NOW);
    expect(result.factors[0]?.key).toBe("long-term-empty");
    expect(result.score).toBe(30);
  });

  it("fires below the letting standard where the jurisdiction has one", () => {
    // MEES: F and G cannot lawfully continue to be let in England and Wales.
    const result = registryPressure(signal({ epcRating: "F" }), NOW);
    expect(result.factors.map((f) => f.key)).toContain("below-letting-standard");
  });

  it("does not fire below the letting standard in Northern Ireland", () => {
    // MEES is an England and Wales instrument. Inheriting it would flag
    // compliant Northern Irish landlords as forced sellers.
    const result = registryPressure(signal({ jurisdiction: "GB-NIR", epcRating: "F" }), NOW);
    expect(result.factors.map((f) => f.key)).not.toContain("below-letting-standard");
  });

  it("does not fire below the letting standard in Scotland", () => {
    const result = registryPressure(signal({ jurisdiction: "GB-SCT", epcRating: "F" }), NOW);
    expect(result.factors.map((f) => f.key)).not.toContain("below-letting-standard");
  });

  it("does not fire for a rating that meets the standard", () => {
    expect(
      registryPressure(signal({ epcRating: "E" }), NOW).factors.map((f) => f.key),
    ).not.toContain("below-letting-standard");
  });

  it("spots a sale that was prepared and did not happen", () => {
    const result = registryPressure(signal({ epcLodgedAt: "2024-01-15" }), NOW);
    expect(result.factors.map((f) => f.key)).toContain("stale-epc-no-sale");
  });

  it("does not fire when a sale followed the certificate", () => {
    // The EPC did its job. This is an ordinary completed transaction.
    const result = registryPressure(
      signal({ epcLodgedAt: "2024-01-15", lastSaleDate: "2024-06-01" }),
      NOW,
    );
    expect(result.factors.map((f) => f.key)).not.toContain("stale-epc-no-sale");
  });

  it("counts long tenure as capacity to accept a discount", () => {
    const result = registryPressure(signal({ lastSaleDate: "2005-04-01" }), NOW);
    expect(result.factors.map((f) => f.key)).toContain("long-tenure");
  });

  it("caps the score at 100 however many factors fire", () => {
    const result = registryPressure(
      signal({
        longTermEmpty: true,
        ownerDissolvedOrInsolvent: true,
        epcRating: "G",
        epcLodgedAt: "2023-01-01",
        lastSaleDate: "2001-01-01",
        ownerKind: "overseas-company",
      }),
      NOW,
    );
    expect(result.score).toBe(100);
  });

  it("reports confidence separately from score", () => {
    // A high score on two fields is not the same as a high score on six, and
    // showing them identically is how a screening tool starts lying.
    const thin = registryPressure(signal({ longTermEmpty: true }), NOW);
    const thick = registryPressure(
      signal({
        longTermEmpty: true,
        epcRating: "D",
        epcLodgedAt: "2025-01-01",
        lastSaleDate: "2020-01-01",
        lastSalePrice: fromMajor(180_000),
        ownerKind: "individual",
        floorAreaSqm: 88,
        ownerDissolvedOrInsolvent: false,
      }),
      NOW,
    );
    expect(thick.confidenceBps).toBeGreaterThan(thin.confidenceBps);
    expect(thick.confidenceBps).toBe(10_000);
  });

  it("names what is missing rather than silently scoring around it", () => {
    const result = registryPressure(signal(), NOW);
    expect(result.missing.join(" ")).toContain("EPC rating");
    expect(result.missing.join(" ")).toContain("Floor area");
  });
});

describe("price per square metre", () => {
  it("divides through the branded type", () => {
    // £212,000 over 88sqm is £2,409.09 per square metre, held in pence.
    expect(toMajor(pricePerSqm(fromMajor(212_000), 88) ?? fromMajor(0))).toBe(2409.09);
  });

  it("refuses a zero or negative area instead of dividing by it", () => {
    expect(pricePerSqm(fromMajor(212_000), 0)).toBeUndefined();
    expect(pricePerSqm(fromMajor(212_000), -5)).toBeUndefined();
  });
});

describe("rating comparison", () => {
  it("orders ratings the way the alphabet does not", () => {
    expect(belowStandard("F", "E")).toBe(true);
    expect(belowStandard("E", "E")).toBe(false);
    expect(belowStandard("C", "E")).toBe(false);
  });
});
