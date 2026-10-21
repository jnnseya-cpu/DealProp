import { describe, expect, it } from "vitest";
import { Fetcher } from "@backend/discovery/fetcher";
import {
  GAZETTE_SOURCE,
  fetchNotice,
  fetchNotices,
  parseDeceasedEstate,
  parseGazetteFeed,
  parseInsolvencyNotice,
  postcodeIn,
} from "@backend/discovery/gazette";
import { sourcePermits } from "@shared/domain/sources";

/**
 * The Gazette adapter. The tests that matter are the same two as everywhere
 * in discovery: nothing is taken from a host the licence does not cover, and
 * nothing is produced that the notice did not state.
 */

/** A transport that answers from a fixture map, mirroring discovery.test.ts. */
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

/* ----------------------------------------------------------------- licence */

describe("the Gazette is licensed, and only for internal analysis", () => {
  it("is readable for internal analysis under the OGL", () => {
    expect(sourcePermits(GAZETTE_SOURCE, "internal-analysis")).toBe(true);
  });
});

/* -------------------------------------------------------------- postcode */

describe("a postcode is extracted only where it literally appears", () => {
  it("pulls a UK postcode out of a stated address", () => {
    expect(postcodeIn("14 Acacia Avenue, Birmingham B29 6AD")).toBe("B29 6AD");
    expect(postcodeIn("Flat 2, 5 High Street, London SW1A1AA")).toBe("SW1A 1AA");
  });

  it("returns undefined rather than inventing one", () => {
    expect(postcodeIn("somewhere in Birmingham")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ feed */

describe("parsing the all-notices feed", () => {
  const feed = {
    feed: {
      entry: [
        {
          id: "2345-6789",
          title: "WILFRED JOHN SMITH (deceased)",
          published: "2026-09-01T00:00:00Z",
          link: [{ "@rel": "alternate", "@href": "https://www.thegazette.co.uk/notice/2345-6789" }],
          "f:notice-code": "G205010000",
        },
        // A malformed entry with no id is skipped, not fatal.
        { title: "no id here", published: "2026-09-02T00:00:00Z" },
      ],
    },
  };

  it("lists the notices, verbatim title, with the notice URL", () => {
    const notices = parseGazetteFeed(feed);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toBe("WILFRED JOHN SMITH (deceased)");
    expect(notices[0]?.noticeUrl).toBe("https://www.thegazette.co.uk/notice/2345-6789");
    expect(notices[0]?.noticeCode).toBe("G205010000");
  });

  it("yields an empty list on a body that is not a feed, rather than throwing", () => {
    expect(parseGazetteFeed("not a feed")).toEqual([]);
    expect(parseGazetteFeed(null)).toEqual([]);
    expect(parseGazetteFeed({ nonsense: true })).toEqual([]);
  });
});

/* -------------------------------------------------------- deceased estates */

describe("a deceased-estates notice is extracted, never inferred", () => {
  it("reads the deceased, their address, the postcode and the contact for service", () => {
    const record = parseDeceasedEstate({
      id: "2345-6789",
      deceased: {
        DeceasedName: "Wilfred John Smith",
        DeceasedAddress: "14 Acacia Avenue, Birmingham B29 6AD",
        DeceasedDateOfDeath: "2026-06-12",
      },
      ClaimsTo: "Messrs Example & Co, Solicitors, Birmingham",
    });
    expect(record?.deceasedName).toBe("Wilfred John Smith");
    expect(record?.lastAddress).toContain("Acacia Avenue");
    expect(record?.postcode).toBe("B29 6AD");
    expect(record?.dateOfDeath).toBe("2026-06-12");
    expect(record?.contactForService).toContain("Example & Co");
  });

  it("composes a name from forenames and surname where the whole is not given", () => {
    const record = parseDeceasedEstate({
      id: "1",
      DeceasedForenames: "Wilfred John",
      DeceasedSurname: "Smith",
    });
    expect(record?.deceasedName).toBe("Wilfred John Smith");
  });

  it("returns undefined where no deceased is named — the essential field", () => {
    expect(parseDeceasedEstate({ id: "1", deceased: { DeceasedAddress: "somewhere" } })).toBeUndefined();
    expect(parseDeceasedEstate({ deceased: { DeceasedName: "X" } })).toBeUndefined(); // no id
    expect(parseDeceasedEstate(null)).toBeUndefined();
  });
});

/* ------------------------------------------------------------ insolvency */

describe("a personal-insolvency notice is extracted, never inferred", () => {
  it("reads the debtor, address and classifies the order from the stated type", () => {
    const record = parseInsolvencyNotice({
      id: "9",
      noticeType: "Bankruptcy order",
      debtor: {
        DebtorName: "Jane Doe",
        DebtorAddress: "9 Example Road, Leeds LS1 4DT",
      },
      noticeDate: "2026-08-20",
    });
    expect(record?.debtorName).toBe("Jane Doe");
    expect(record?.postcode).toBe("LS1 4DT");
    expect(record?.noticeType).toBe("bankruptcy-order");
    expect(record?.noticeDate).toBe("2026-08-20");
  });

  it("classifies IVAs and debt relief orders, and falls back to other", () => {
    expect(parseInsolvencyNotice({ id: "1", title: "Individual Voluntary Arrangement", debtor: { name: "A" } })?.noticeType)
      .toBe("individual-voluntary-arrangement");
    expect(parseInsolvencyNotice({ id: "2", title: "Debt Relief Order", debtor: { name: "B" } })?.noticeType)
      .toBe("debt-relief-order");
    expect(parseInsolvencyNotice({ id: "3", title: "Some other notice", debtor: { name: "C" } })?.noticeType)
      .toBe("other");
  });

  it("returns undefined where no debtor is named", () => {
    expect(parseInsolvencyNotice({ id: "1", debtor: { DebtorAddress: "x" } })).toBeUndefined();
    expect(parseInsolvencyNotice(null)).toBeUndefined();
  });
});

/* --------------------------------------------------------------- the gate */

describe("the connector is bound to the licensed host", () => {
  it("reads the feed from the Gazette's own host", async () => {
    const feedJson = JSON.stringify({
      feed: { entry: [{ id: "1", title: "A (deceased)", published: "2026-09-01T00:00:00Z" }] },
    });
    const { fetcher } = fetcherWith({
      "https://www.thegazette.co.uk/robots.txt": { status: 404 },
      "https://www.thegazette.co.uk/all-notices/notice/data.json?noticetypes=G205010000": { body: feedJson },
    });
    const result = await fetchNotices(fetcher, { noticeCode: "G205010000" });
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);
    expect(result.provenance?.sourceKey).toBe(GAZETTE_SOURCE);
    expect(result.provenance?.inferred).toBe(false);
  });

  it("refuses to be walked onto another host for the same source", async () => {
    const { fetcher } = fetcherWith({});
    // A fabricated notice URL on a host the licence does not cover.
    const result = await fetchNotice(fetcher, "https://evil.example.com/notice/1");
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("not a published host");
  });

  it("obeys the Gazette's robots.txt like any other site", async () => {
    const { fetcher, calls } = fetcherWith({
      "https://www.thegazette.co.uk/robots.txt": { body: "User-agent: *\nDisallow: /all-notices" },
      "https://www.thegazette.co.uk/all-notices/notice/data.json?noticetypes=X": { body: "{}" },
    });
    const result = await fetchNotices(fetcher, { noticeCode: "X" });
    expect(result.ok).toBe(false);
    // robots was consulted and the feed itself was never fetched.
    expect(calls.some((c) => c.endsWith("robots.txt"))).toBe(true);
    expect(calls.some((c) => c.includes("data.json"))).toBe(false);
  });
});
