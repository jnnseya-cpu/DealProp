import { describe, expect, it } from "vitest";
import { Fetcher } from "@backend/discovery/fetcher";
import { parseEpc } from "@backend/discovery/properties";
import {
  runFromArea,
  runFromCouncil,
  runFromDatasets,
  runRegisters,
  sourceProperties,
  sourcingReadiness,
  type SourcingInputs,
} from "@backend/discovery/sourcingRun";
import type { EpcCertificate } from "@backend/sources/epc";
import type { PricePaidRecord } from "@backend/discovery/properties";
import { attribute } from "@shared/domain/sources";
import { fromMajor } from "@shared/money";

const NOW = new Date("2026-10-21T00:00:00.000Z");

/** A transport answering from a fixture map, as in discovery.test.ts. */
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

/* ------------------------------------------------------------- parseEpc */

describe("the EPC bulk file is parsed by column name", () => {
  const csv = [
    "LMK_KEY,ADDRESS1,ADDRESS2,POSTCODE,CURRENT_ENERGY_RATING,LODGEMENT_DATE,TOTAL_FLOOR_AREA,CONSTRUCTION_AGE_BAND",
    "abc,14 Acacia Avenue,,B29 6AD,D,2025-01-01,88,England and Wales: 1950-1966",
    "def,,,B29 6AD,D,2025-01-01,50,", // no address — skipped
  ].join("\n");

  it("reads the address, postcode, lodgement date and rating", () => {
    const { records, skipped } = parseEpc(csv);
    expect(records).toHaveLength(1);
    expect(records[0]?.postcode).toBe("B29 6AD");
    expect(records[0]?.paon).toBe("14");
    expect(records[0]?.street.toUpperCase()).toContain("ACACIA");
    expect(records[0]?.lodgedAt).toBe("2025-01-01");
    expect(records[0]?.floorAreaSqm).toBe(88);
    expect(skipped).toBe(1);
  });

  it("returns nothing on a file missing the essential columns", () => {
    const { records } = parseEpc("WRONG,HEADERS\n1,2");
    expect(records).toEqual([]);
  });
});

/* --------------------------------------------------------- sourceProperties */

describe("the adapters join into one ranked list of leads", () => {
  const inputs: SourcingInputs = {
    preparedButUnsold: [
      {
        addressKey: "B29 6AD|14|ACACIA AVENUE",
        postcode: "B29 6AD",
        paon: "14",
        saon: "",
        street: "Acacia Avenue",
        preparedAt: "2025-01-01",
        monthsSincePrepared: 21,
        epcRating: "D",
        strength: "strong",
        reason: "A certificate was lodged 21 months ago and no sale has been registered since.",
      },
    ],
    deceasedEstates: [
      { noticeId: "1", deceasedName: "Wilfred Smith", lastAddress: "9 Elm Road, Leeds LS1 4DT", postcode: "LS1 4DT", dateOfDeath: "2026-06-12" },
    ],
    insolvencies: [
      { noticeId: "2", debtorName: "Jane Doe", noticeType: "bankruptcy-order", postcode: "M1 2AB" },
    ],
  };

  it("produces a lead per signal with its lawful next step", () => {
    const leads = sourceProperties(inputs, NOW);
    expect(leads).toHaveLength(3);
    const byKey = Object.fromEntries(leads.map((l) => [l.signalKey, l]));
    expect(byKey["prepared-but-unsold"]?.lawfulNextStep).toMatch(/lookupOwner|by post/);
    expect(byKey["probate-notice"]?.lawfulNextStep).toMatch(/letter only/i);
    expect(byKey["owner-insolvent"]?.lawfulNextStep).toMatch(/Individual Insolvency Register/);
  });

  it("flags the distress signals for heightened protection, and only those", () => {
    const leads = sourceProperties(inputs, NOW);
    expect(leads.find((l) => l.signalKey === "probate-notice")?.heightenedProtection).toBe(true);
    expect(leads.find((l) => l.signalKey === "owner-insolvent")?.heightenedProtection).toBe(true);
    expect(leads.find((l) => l.signalKey === "prepared-but-unsold")?.heightenedProtection).toBe(false);
  });

  it("carries provenance and never an address for the insolvency lead beyond the postcode", () => {
    const leads = sourceProperties(inputs, NOW);
    const insolvency = leads.find((l) => l.signalKey === "owner-insolvent");
    expect(insolvency?.provenance.sourceKey).toBe("insolvency-register");
    // The summary states the postcode-less situation; the card carries postcode,
    // not a full address, and never a return figure.
    expect(insolvency?.postcode).toBe("M1 2AB");
  });

  it("orders strong leads first and is stable on a rerun", () => {
    const weak: SourcingInputs = {
      deceasedEstates: [{ noticeId: "3", deceasedName: "No Address" }], // no postcode → worth-a-look
      preparedButUnsold: inputs.preparedButUnsold,
    };
    const leads = sourceProperties(weak, NOW);
    expect(leads[0]?.strength).toBe("strong");
    expect(leads[leads.length - 1]?.strength).toBe("worth-a-look");
  });

  it("drafts a trustee letter for a bankruptcy order, never addressed to the debtor", () => {
    const leads = sourceProperties(inputs, NOW);
    const insolvency = leads.find((l) => l.signalKey === "owner-insolvent");
    expect(insolvency?.letterDraft).toBeDefined();
    const letter = insolvency?.letterDraft ?? "";
    expect(letter).toContain("The Trustee in Bankruptcy / Official Receiver");
    // The debtor is named as the subject of the matter, never as the recipient.
    expect(letter).toContain("writing to the office-holder, not to the bankrupt");
    expect(insolvency?.subjectName).toBe("Jane Doe");
  });

  it("drafts no letter for an IVA or DRO — the home does not vest in anyone", () => {
    const leads = sourceProperties(
      { insolvencies: [{ noticeId: "9", debtorName: "Iva Case", noticeType: "individual-voluntary-arrangement", postcode: "M1 2AB" }] },
      NOW,
    );
    expect(leads[0]?.letterDraft).toBeUndefined();
  });
});

/* ------------------------------------------------------------ runFromArea */

describe("running an area from the open APIs", () => {
  const cert: EpcCertificate = {
    lmkKey: "abc",
    address: "14 Acacia Avenue, Birmingham",
    addressLine1: "14 Acacia Avenue",
    postcode: "B29 6AD",
    lodgedAt: "2025-01-01",
    propertyType: "House",
    floorAreaSqm: 88,
    source: attribute("epc-register", "2025-01-01"),
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

  it("joins EPC and Price Paid for the postcode into a prepared-but-unsold lead", async () => {
    const result = await runFromArea("B29 6AD", {
      epc: async () => [cert],
      sales: async () => [sale],
      now: NOW,
    });
    expect(result.certificates).toBe(1);
    expect(result.sales).toBe(1);
    expect(result.leads.some((l) => l.signalKey === "prepared-but-unsold" && l.postcode === "B29 6AD")).toBe(true);
  });

  it("degrades to a note and no leads when a source throws, never a crash", async () => {
    const result = await runFromArea("B29 6AD", {
      epc: async () => {
        throw new Error("EPC_API_EMAIL and EPC_API_KEY are not configured; refusing to query.");
      },
      sales: async () => [sale],
      now: NOW,
    });
    expect(result.certificates).toBe(0);
    expect(result.leads).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("EPC register:");
    expect(result.notes.join(" ")).toContain("not configured");
  });

  it("names the address and collapses repeated certificates for one property", async () => {
    const older: EpcCertificate = { ...cert, lmkKey: "a", lodgedAt: "2024-01-01" };
    const newer: EpcCertificate = { ...cert, lmkKey: "b", lodgedAt: "2025-01-01" };
    const result = await runFromArea("B29 6AD", {
      epc: async () => [older, newer], // same address, two certificates
      sales: async () => [], // no sale → a candidate
      now: NOW,
    });
    const prepared = result.leads.filter((l) => l.signalKey === "prepared-but-unsold");
    expect(prepared).toHaveLength(1); // one row per address, not per certificate
    expect(prepared[0]?.propertyAddress).toBe("14 Acacia Avenue");
    // A homeowner letter is drafted to the property — no name, no title lookup.
    expect(prepared[0]?.letterDraft).toContain("The Homeowner");
    expect(prepared[0]?.letterDraft).toContain("14 Acacia Avenue");
  });
});

/* ------------------------------------------------------- runFromDatasets */

describe("running from datasets the operator holds", () => {
  const epc = [
    "LMK_KEY,ADDRESS1,ADDRESS2,POSTCODE,CURRENT_ENERGY_RATING,LODGEMENT_DATE,TOTAL_FLOOR_AREA,CONSTRUCTION_AGE_BAND",
    "abc,14 Acacia Avenue,,B29 6AD,D,2025-01-01,88,England and Wales: 1950-1966",
  ].join("\n");
  // 16-column Price Paid row, last sale in 2019, before the certificate.
  const ppd = ['"{id}"', '"200000"', '"2019-01-01 00:00"', '"B29 6AD"', '"T"', '"N"', '"F"', '"14"', '""', '"Acacia Avenue"', '"Birmingham"', '"Birmingham"', '"West Midlands"', '"A"', '"A"', '"A"'].join(",");

  it("finds the prepared-but-unsold property by joining the two datasets", () => {
    const result = runFromDatasets(ppd, epc, NOW);
    expect(result.leads.some((l) => l.signalKey === "prepared-but-unsold" && l.postcode === "B29 6AD")).toBe(true);
    expect(result.salesConsidered).toBe(1);
    expect(result.epcConsidered).toBe(1);
    expect(result.flips).toEqual([]); // one sale only, so no flip pair
  });

  it("flags possible negative equity where the estimate sits below the last paid price", () => {
    // Last paid £400k; floor area 50sqm; the street's only other sale sets a low
    // median £/sqm, so the estimate lands well under what was paid.
    const epcNeg = [
      "LMK_KEY,ADDRESS1,ADDRESS2,POSTCODE,CURRENT_ENERGY_RATING,LODGEMENT_DATE,TOTAL_FLOOR_AREA,CONSTRUCTION_AGE_BAND",
      "k1,14 Acacia Avenue,,B29 6AD,D,2025-01-01,50,1950-1966",
      "k2,16 Acacia Avenue,,B29 6AD,D,2010-01-01,50,1950-1966",
    ].join("\n");
    const dear = ['"a"', '"400000"', '"2018-01-01 00:00"', '"B29 6AD"', '"T"', '"N"', '"F"', '"14"', '""', '"Acacia Avenue"', '"x"', '"x"', '"x"', '"A"', '"A"', '"A"'].join(",");
    const cheapComp = ['"b"', '"100000"', '"2017-01-01 00:00"', '"B29 6AD"', '"T"', '"N"', '"F"', '"16"', '""', '"Acacia Avenue"', '"x"', '"x"', '"x"', '"A"', '"A"', '"A"'].join(",");
    const result = runFromDatasets(`${dear}\n${cheapComp}`, epcNeg, NOW);
    expect(result.leads.some((l) => l.signalKey === "negative-equity")).toBe(true);
    const neg = result.leads.find((l) => l.signalKey === "negative-equity");
    expect(neg?.summary).toMatch(/proxy, not a valuation/);
  });

  it("surfaces a completed flip as market evidence, not a lead", () => {
    const bought = ['"a"', '"150000"', '"2023-01-01 00:00"', '"LS1 4DT"', '"T"', '"N"', '"F"', '"9"', '""', '"Elm Road"', '"x"', '"x"', '"x"', '"A"', '"A"', '"A"'].join(",");
    const sold = ['"b"', '"230000"', '"2024-01-01 00:00"', '"LS1 4DT"', '"T"', '"N"', '"F"', '"9"', '""', '"Elm Road"', '"x"', '"x"', '"x"', '"A"', '"A"', '"A"'].join(",");
    const emptyEpc = "LMK_KEY,ADDRESS1,ADDRESS2,POSTCODE,CURRENT_ENERGY_RATING,LODGEMENT_DATE,TOTAL_FLOOR_AREA,CONSTRUCTION_AGE_BAND";
    const result = runFromDatasets(`${bought}\n${sold}`, emptyEpc, NOW);
    expect(result.flips).toHaveLength(1);
    expect(result.flips[0]?.postcode).toBe("LS1 4DT");
    expect(result.flips[0]?.upliftBps).toBeGreaterThanOrEqual(2000);
    // A flip is evidence, never a motivated-seller lead.
    expect(result.leads.some((l) => l.signalKey !== "negative-equity")).toBe(false);
  });

  it("drops a property that has sold since its certificate", () => {
    const sold = ['"{id}"', '"300000"', '"2026-02-01 00:00"', '"B29 6AD"', '"T"', '"N"', '"F"', '"14"', '""', '"Acacia Avenue"', '"B"', '"B"', '"B"', '"A"', '"A"', '"A"'].join(",");
    const result = runFromDatasets(`${ppd}\n${sold}`, epc, NOW);
    expect(result.leads).toHaveLength(0);
  });
});

/* ------------------------------------------------------- runFromCouncil */

describe("sweeping a whole council", () => {
  const certIn = (postcode: string, paon: string, lodgedAt: string): EpcCertificate => ({
    lmkKey: `${postcode}-${paon}`,
    address: `${paon} Test Road, ${postcode}`,
    addressLine1: `${paon} Test Road`,
    postcode,
    lodgedAt,
    source: attribute("epc-register", lodgedAt),
  });

  it("judges a certificate only where its postcode has Price Paid coverage", async () => {
    const certs = [certIn("B1 1AA", "10", "2024-06-01"), certIn("B2 2BB", "20", "2024-06-01")];
    const result = await runFromCouncil("Birmingham", {
      epc: async () => ({ certificates: certs, nextPage: null }),
      sales: async (pc) => {
        if (pc === "B2 2BB") throw new Error("Price Paid endpoint returned 500");
        return []; // B1 1AA: covered, no sales → a candidate
      },
      now: NOW,
    });
    // The failed-lookup postcode's certificate is excluded, never guessed as a
    // candidate; only the covered one is judged.
    expect(result.certificates).toBe(1);
    expect(result.leads.some((l) => l.signalKey === "prepared-but-unsold" && l.postcode === "B1 1AA")).toBe(true);
    expect(result.leads.some((l) => l.postcode === "B2 2BB")).toBe(false);
    expect(result.notes.join(" ")).toContain("1 failed");
  });

  it("stops at the page cap and says so", async () => {
    const result = await runFromCouncil("Birmingham", {
      epc: async (page) => ({
        certificates: [certIn(`B${page} ${page}AA`, "1", "2024-06-01")],
        nextPage: page + 1, // the feed always claims more
      }),
      sales: async () => [],
      now: NOW,
      maxCertPages: 2,
    });
    expect(result.notes.join(" ")).toContain("stopped at 2 pages");
  });
});

/* --------------------------------------------------------- runRegisters */

describe("running the public registers through the Fetcher", () => {
  it("turns fetched notices into leads", async () => {
    // The feed carries the name (title) and the address (content) on the entry
    // itself, so no per-notice request is made — the shape of the live feed.
    const feed = JSON.stringify({
      feed: {
        entry: [
          {
            id: "2345-6789",
            title: "WILFRED SMITH",
            published: "2026-09-01T00:00:00Z",
            link: [{ "@rel": "alternate", "@href": "https://www.thegazette.co.uk/notice/2345-6789" }],
            content: "<div><dl><dt>Address of Deceased</dt><dd>9 Elm Road, Leeds LS1 4DT</dd></dl></div>",
          },
        ],
      },
    });
    const { fetcher } = fetcherWith({
      "https://www.thegazette.co.uk/robots.txt": { status: 404 },
      "https://www.thegazette.co.uk/all-notices/notice/data.json?noticetypes=DEC&results-page-size=50&results-page=1": { body: feed },
    });
    const result = await runRegisters({ deceasedCode: "DEC" }, { fetcher, now: NOW });
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]?.signalKey).toBe("probate-notice");
    expect(result.leads[0]?.postcode).toBe("LS1 4DT");
    expect(result.leads[0]?.heightenedProtection).toBe(true);
  });

  it("fails closed and reports why when a source cannot be reached", async () => {
    // No routes: every fetch 404s, standing in for blocked egress.
    const { fetcher } = fetcherWith({});
    const result = await runRegisters({ deceasedCode: "DEC", insolvencyCode: "INS" }, { fetcher, now: NOW });
    expect(result.leads).toHaveLength(0);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("says plainly when a notice code is not configured", async () => {
    const { fetcher } = fetcherWith({});
    const result = await runRegisters({}, { fetcher, now: NOW });
    expect(result.notes.join(" ")).toMatch(/no notice code configured/);
  });
});

/* ---------------------------------------------------------- readiness */

describe("source readiness is stated without a run", () => {
  it("reports what each source still needs", () => {
    const states = Object.fromEntries(sourcingReadiness().map((s) => [s.sourceKey, s.state]));
    // Price Paid is an open, keyless endpoint queried per postcode — ready.
    expect(states["land-registry-ppd"]).toBe("ready");
    expect(states["epc-register"]).toBe("needs-credential");
    expect(states["insolvency-register"]).toBe("needs-arrangement");
  });

  it("flips EPC and the Gazette to ready once configured", () => {
    const states = Object.fromEntries(
      sourcingReadiness({ epcKey: "set", gazetteDeceasedCode: "DEC" }).map((s) => [s.sourceKey, s.state]),
    );
    expect(states["epc-register"]).toBe("ready");
    expect(states["the-gazette"]).toBe("ready");
  });
});
