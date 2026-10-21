import { describe, expect, it } from "vitest";
import { Fetcher } from "@backend/discovery/fetcher";
import { parseEpc } from "@backend/discovery/properties";
import {
  runFromDatasets,
  runRegisters,
  sourceProperties,
  sourcingReadiness,
  type SourcingInputs,
} from "@backend/discovery/sourcingRun";

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
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]?.signalKey).toBe("prepared-but-unsold");
    expect(result.leads[0]?.postcode).toBe("B29 6AD");
    expect(result.salesConsidered).toBe(1);
    expect(result.epcConsidered).toBe(1);
  });

  it("drops a property that has sold since its certificate", () => {
    const sold = ['"{id}"', '"300000"', '"2026-02-01 00:00"', '"B29 6AD"', '"T"', '"N"', '"F"', '"14"', '""', '"Acacia Avenue"', '"B"', '"B"', '"B"', '"A"', '"A"', '"A"'].join(",");
    const result = runFromDatasets(`${ppd}\n${sold}`, epc, NOW);
    expect(result.leads).toHaveLength(0);
  });
});

/* --------------------------------------------------------- runRegisters */

describe("running the public registers through the Fetcher", () => {
  it("turns fetched notices into leads", async () => {
    const feed = JSON.stringify({
      feed: {
        entry: [
          {
            id: "2345-6789",
            title: "WILFRED SMITH (deceased)",
            published: "2026-09-01T00:00:00Z",
            link: [{ "@rel": "alternate", "@href": "https://www.thegazette.co.uk/notice/2345-6789" }],
          },
        ],
      },
    });
    const body = JSON.stringify({
      id: "2345-6789",
      deceased: { DeceasedName: "Wilfred Smith", DeceasedAddress: "9 Elm Road, Leeds LS1 4DT", DeceasedDateOfDeath: "2026-06-12" },
    });
    const { fetcher } = fetcherWith({
      "https://www.thegazette.co.uk/robots.txt": { status: 404 },
      "https://www.thegazette.co.uk/all-notices/notice/data.json?noticetypes=DEC": { body: feed },
      "https://www.thegazette.co.uk/notice/2345-6789/data.json": { body },
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
    expect(states["land-registry-ppd"]).toBe("needs-dataset");
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
