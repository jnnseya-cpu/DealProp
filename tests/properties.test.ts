import { describe, expect, it } from "vitest";
import {
  addressKey,
  EPC_SOURCE,
  findCandidates,
  medianPricePerSqm,
  MINIMUM_MONTHS,
  findFlips,
  FLIP_MIN_UPLIFT_BPS,
  negativeEquity,
  parsePricePaid,
  PPD_SOURCE,
  STALE_MONTHS,
  STRONG_MONTHS,
  type EpcRecord,
} from "@backend/discovery/properties";
import { Fetcher } from "@backend/discovery/fetcher";
import { assertSourceUsable, SourceNotPermitted } from "@shared/domain/sources";
import { fromMajor } from "@shared/money";

const NOW = new Date("2026-10-21T00:00:00.000Z");

/** A row in the published sixteen-column order, no header. */
function row(input: {
  price: number;
  date: string;
  postcode: string;
  paon: string;
  street: string;
  saon?: string;
  category?: "A" | "B";
}): string {
  return [
    "{ID}",
    String(input.price),
    `${input.date} 00:00`,
    input.postcode,
    "T",
    "N",
    "F",
    input.paon,
    input.saon ?? "",
    input.street,
    "LOCALITY",
    "TOWN",
    "DISTRICT",
    "COUNTY",
    input.category ?? "A",
    "A",
  ]
    .map((field) => `"${field}"`)
    .join(",");
}

const epc = (overrides: Partial<EpcRecord> = {}): EpcRecord => ({
  postcode: "B23 5TT",
  paon: "14",
  saon: "",
  street: "Holly Lane",
  lodgedAt: "2025-01-10",
  rating: "E",
  floorAreaSqm: 88,
  ...overrides,
});

describe("what may be read at all", () => {
  it("refuses portal listings at the licence gate, before any request", async () => {
    // The whole point of the registry. The portals' terms prohibit automated
    // collection, so there is no licence recorded and the fetcher stops at the
    // first check rather than at display — the exposure is created by taking
    // the data, not by showing it.
    const fetcher = new Fetcher({
      transport: (async () => {
        throw new Error("the transport must never be reached");
      }) as never,
    });
    const result = await fetcher.get("portal-listings", "https://www.rightmove.co.uk/anything");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe("no-licence");
      expect(result.reason).toContain("prohibit scraping");
    }
    expect(fetcher.requestsMade).toBe(0);
  });

  it("refuses LinkedIn and invented addresses the same way", async () => {
    const fetcher = new Fetcher({ transport: (async () => new Response("")) as never });
    for (const key of ["linkedin-profiles", "inferred-contacts"]) {
      const result = await fetcher.get(key, "https://example.com/x");
      expect(result.ok, key).toBe(false);
    }
    expect(fetcher.requestsMade).toBe(0);
  });

  it("binds each licensed source to its own hosts", async () => {
    // A licence for Price Paid cannot be used to justify fetching something
    // else, which is what a source-wide allowlist would permit.
    const fetcher = new Fetcher({
      transport: (async () =>
        new Response("", { status: 200, headers: { "content-type": "text/csv" } })) as never,
    });
    const allowed = await fetcher.get(PPD_SOURCE, "https://landregistry.data.gov.uk/x.csv");
    expect(allowed.ok).toBe(true);
    const borrowed = await fetcher.get(PPD_SOURCE, "https://evil.example.com/x.csv");
    expect(borrowed.ok).toBe(false);
    if (!borrowed.ok) expect(borrowed.outcome).toBe("host-not-allowed");
  });

  it("checks the licence at ingestion, not at display", () => {
    // Parsing is ingestion. A caller holding a CSV from somewhere it should
    // not have come from must not be able to turn it into records.
    expect(() => assertSourceUsable("portal-listings", "internal-analysis")).toThrow(
      SourceNotPermitted,
    );
    expect(() => assertSourceUsable(PPD_SOURCE, "internal-analysis")).not.toThrow();
    expect(() => assertSourceUsable(EPC_SOURCE, "internal-analysis")).not.toThrow();
  });
});

describe("parsing Price Paid Data", () => {
  it("reads the published format", () => {
    const { records, skipped } = parsePricePaid(
      row({ price: 212_000, date: "2019-06-14", postcode: "b23 5tt", paon: "14", street: "Holly Lane" }),
    );
    expect(skipped).toBe(0);
    expect(records).toHaveLength(1);
    const first = records[0];
    // Published in whole pounds; converted once, at the edge, because money is
    // integer pence everywhere else and a later comparison would be wrong.
    expect(first?.price).toBe(fromMajor(212_000));
    expect(first?.soldAt).toBe("2019-06-14");
    expect(first?.postcode).toBe("B23 5TT");
    expect(first?.category).toBe("A");
  });

  it("survives a bad row without losing the file", () => {
    const csv = [
      row({ price: 100_000, date: "2020-01-01", postcode: "B1 1AA", paon: "1", street: "A Road" }),
      '"malformed","row"',
      row({ price: 200_000, date: "2021-01-01", postcode: "B2 2BB", paon: "2", street: "B Road" }),
    ].join("\n");
    const { records, skipped } = parsePricePaid(csv);
    // One malformed line in somebody else's two-million-row export must not
    // cost the whole run.
    expect(records).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it("rejects a row with no usable price or date rather than guessing", () => {
    const { records, skipped } = parsePricePaid(
      [
        row({ price: 0, date: "2020-01-01", postcode: "B1 1AA", paon: "1", street: "A Road" }),
        row({ price: 100_000, date: "not-a-date", postcode: "B1 1AA", paon: "1", street: "A Road" }),
      ].join("\n"),
    );
    expect(records).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it("handles a quoted field containing a comma", () => {
    const line = row({ price: 150_000, date: "2022-03-03", postcode: "B3 3CC", paon: "FLAT 1, THE OLD MILL", street: "Mill Street" });
    const { records } = parsePricePaid(line);
    // A naive comma split would shift every column after this one.
    expect(records[0]?.paon).toBe("FLAT 1, THE OLD MILL");
    expect(records[0]?.street).toBe("Mill Street");
  });
});

describe("the address join", () => {
  it("matches two spellings of the same address", () => {
    expect(addressKey({ postcode: "b23  5tt", paon: "14", street: "Holly Lane." })).toBe(
      addressKey({ postcode: "B23 5TT", paon: "14", street: "HOLLY LANE" }),
    );
  });

  it("keeps a flat distinct from the building it is in", () => {
    const flat = addressKey({ postcode: "B21 8NN", paon: "57", saon: "Flat 2", street: "Soho Road" });
    const building = addressKey({ postcode: "B21 8NN", paon: "57", street: "Soho Road" });
    // Treating these as one address would decide a flat had sold because a
    // different flat in the same building did.
    expect(flat).not.toBe(building);
  });
});

describe("finding candidates", () => {
  it("finds a property prepared for sale that did not sell", () => {
    const sales = parsePricePaid(
      row({ price: 212_000, date: "2019-06-14", postcode: "B23 5TT", paon: "14", street: "Holly Lane" }),
    ).records;

    const out = findCandidates([epc()], sales, NOW);
    expect(out.candidates).toHaveLength(1);
    const candidate = out.candidates[0];
    expect(candidate?.strength).toBe("strong");
    expect(candidate?.monthsSincePrepared).toBeGreaterThanOrEqual(STRONG_MONTHS);
    // The last sale is carried through, because what it last changed hands for
    // is the first thing anybody asks.
    expect(candidate?.lastSoldPrice).toBe(fromMajor(212_000));
    expect(candidate?.reason).toContain("still theirs");
  });

  it("drops an address that sold after the certificate", () => {
    const sales = parsePricePaid(
      row({ price: 230_000, date: "2025-06-01", postcode: "B23 5TT", paon: "14", street: "Holly Lane" }),
    ).records;
    const out = findCandidates([epc()], sales, NOW);
    expect(out.candidates).toHaveLength(0);
    expect(out.soldSince).toBe(1);
  });

  it("counts a non-arm's-length sale as a sale", () => {
    // A repossession or a transfer between related parties still means the
    // property changed hands. Treating category B as no-sale would put a
    // property somebody no longer owns on the list.
    const sales = parsePricePaid(
      row({
        price: 150_000,
        date: "2025-06-01",
        postcode: "B23 5TT",
        paon: "14",
        street: "Holly Lane",
        category: "B",
      }),
    ).records;
    expect(findCandidates([epc()], sales, NOW).candidates).toHaveLength(0);
  });

  it("holds back a certificate too recent to mean anything", () => {
    // Registration lags completion by months, so recent silence is not
    // evidence of no sale. Reporting it as a candidate would be reporting the
    // lag as an opportunity.
    const recent = epc({ lodgedAt: "2026-09-01" });
    const out = findCandidates([recent], [], NOW);
    expect(out.candidates).toHaveLength(0);
    expect(out.tooRecent).toBe(1);
  });

  it("separates a strong signal from one worth a look", () => {
    const strong = findCandidates([epc({ lodgedAt: "2025-01-10" })], [], NOW).candidates[0];
    const weaker = findCandidates([epc({ lodgedAt: "2026-02-01" })], [], NOW).candidates[0];
    expect(strong?.strength).toBe("strong");
    expect(weaker?.strength).toBe("worth-a-look");
    expect(weaker?.reason).toContain("worth checking rather than acting on");
  });

  it("works the longest-prepared first", () => {
    const out = findCandidates(
      [
        epc({ postcode: "B1 1AA", paon: "1", street: "A Road", lodgedAt: "2026-01-01" }),
        epc({ postcode: "B2 2BB", paon: "2", street: "B Road", lodgedAt: "2024-01-01" }),
      ],
      [],
      NOW,
    );
    expect(out.candidates.map((c) => c.street)).toEqual(["B Road", "A Road"]);
  });

  it("excludes a certificate too old to be an actionable signal", () => {
    // A certificate from years ago with no sale since is a long-term owner or an
    // unmatched sale, not a recent would-be seller. Presenting it as "strong"
    // is false confidence, so it is dropped and counted as too old.
    const ancient = epc({ lodgedAt: "2019-01-01" }); // ~93 months before NOW
    const out = findCandidates([ancient], [], NOW);
    expect(out.candidates).toHaveLength(0);
    expect(out.tooOld).toBe(1);
  });

  it("still counts an old certificate that DID sell as sold, not too old", () => {
    const sales = parsePricePaid(
      row({ price: 200_000, date: "2020-01-01", postcode: "B23 5TT", paon: "14", street: "Holly Lane" }),
    ).records;
    const out = findCandidates([epc({ lodgedAt: "2019-01-01" })], sales, NOW);
    expect(out.tooOld).toBe(0);
    expect(out.soldSince).toBe(1);
  });

  it("states a window rather than leaving it to a caller", () => {
    expect(MINIMUM_MONTHS).toBe(6);
    expect(STRONG_MONTHS).toBeGreaterThan(MINIMUM_MONTHS);
    expect(STALE_MONTHS).toBeGreaterThan(STRONG_MONTHS);
  });
});

describe("the local rate", () => {
  it("excludes non-arm's-length sales from the median", () => {
    const sales = parsePricePaid(
      [
        row({ price: 200_000, date: "2024-01-01", postcode: "B1 1AA", paon: "1", street: "A Road" }),
        row({ price: 220_000, date: "2024-02-01", postcode: "B1 1AA", paon: "2", street: "A Road" }),
        // A repossession at half price. Left in, it drags the median down and
        // makes every deal in the street look better than it is.
        row({
          price: 20_000,
          date: "2024-03-01",
          postcode: "B1 1AA",
          paon: "3",
          street: "A Road",
          category: "B",
        }),
      ].join("\n"),
    ).records;

    const areas = new Map([
      [addressKey({ postcode: "B1 1AA", paon: "1", street: "A Road" }), 100],
      [addressKey({ postcode: "B1 1AA", paon: "2", street: "A Road" }), 100],
      [addressKey({ postcode: "B1 1AA", paon: "3", street: "A Road" }), 100],
    ]);

    // £2,000 and £2,200 per sqm; median £2,100. The £200 repossession is out.
    expect(medianPricePerSqm(sales, areas)).toBe(fromMajor(2_100));
  });

  it("returns nothing rather than a figure from no data", () => {
    expect(medianPricePerSqm([], new Map())).toBeUndefined();
    const sales = parsePricePaid(
      row({ price: 200_000, date: "2024-01-01", postcode: "B1 1AA", paon: "1", street: "A Road" }),
    ).records;
    // A sale with no floor area cannot produce a rate, and a zero would be
    // worse than an absence.
    expect(medianPricePerSqm(sales, new Map())).toBeUndefined();
  });
});

describe("bought and flipped", () => {
  function sale(input: { price: number; date: string; paon: string; postcode?: string; category?: "A" | "B" }): string {
    return [
      "{ID}", String(input.price), `${input.date} 00:00`, input.postcode ?? "B1 1AA",
      "T", "N", "F", input.paon, "", "A ROAD", "L", "T", "D", "C", input.category ?? "A", "A",
    ].map((f) => `"${f}"`).join(",");
  }

  it("finds a pair of sales with a real uplift inside the window", () => {
    const sales = parsePricePaid(
      [
        sale({ price: 150_000, date: "2022-03-01", paon: "14" }),
        sale({ price: 207_000, date: "2023-05-01", paon: "14" }),
      ].join("\n"),
    ).records;
    const flips = findFlips(sales);
    expect(flips).toHaveLength(1);
    expect(flips[0]?.upliftBps).toBeGreaterThanOrEqual(FLIP_MIN_UPLIFT_BPS);
    expect(flips[0]?.boughtFor).toBe(fromMajor(150_000));
    expect(flips[0]?.soldFor).toBe(fromMajor(207_000));
  });

  it("ignores ordinary appreciation below the uplift floor", () => {
    const sales = parsePricePaid(
      [
        sale({ price: 200_000, date: "2022-03-01", paon: "14" }),
        sale({ price: 210_000, date: "2023-03-01", paon: "14" }),
      ].join("\n"),
    ).records;
    // 5% is a market move, not a refurbishment.
    expect(findFlips(sales)).toHaveLength(0);
  });

  it("ignores two sales too far apart to be a flip", () => {
    const sales = parsePricePaid(
      [
        sale({ price: 150_000, date: "2018-03-01", paon: "14" }),
        sale({ price: 250_000, date: "2024-03-01", paon: "14" }),
      ].join("\n"),
    ).records;
    expect(findFlips(sales)).toHaveLength(0);
  });

  it("excludes a non-arm's-length purchase from the pair", () => {
    // A repossession bought cheap and sold on is a different signal, and
    // counting it would overstate the achievable uplift.
    const sales = parsePricePaid(
      [
        sale({ price: 100_000, date: "2022-03-01", paon: "14", category: "B" }),
        sale({ price: 200_000, date: "2023-03-01", paon: "14" }),
      ].join("\n"),
    ).records;
    expect(findFlips(sales)).toHaveLength(0);
  });
});

describe("negative equity", () => {
  it("flags a property worth less than it last cost", () => {
    const flag = negativeEquity(fromMajor(200_000), fromMajor(170_000));
    expect(flag).toBeDefined();
    expect(flag?.shortfallBps).toBe(1_500);
  });

  it("returns nothing where there is equity or a figure is missing", () => {
    expect(negativeEquity(fromMajor(200_000), fromMajor(240_000))).toBeUndefined();
    expect(negativeEquity(undefined, fromMajor(170_000))).toBeUndefined();
    // An absent estimate is not evidence of equity.
    expect(negativeEquity(fromMajor(200_000), undefined)).toBeUndefined();
  });
});
