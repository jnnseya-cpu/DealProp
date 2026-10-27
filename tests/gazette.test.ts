import { describe, expect, it } from "vitest";
import { Fetcher } from "@backend/discovery/fetcher";
import {
  GAZETTE_SOURCE,
  fetchNotice,
  fetchNoticeDetail,
  fetchNotices,
  noticeDataUrl,
  parseDeceasedEstate,
  parseGazetteFeed,
  parseInsolvencyNotice,
  parseNoticeDetail,
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
          content: "<div><dl><dt>Address of Deceased</dt><dd>14 Acacia Avenue, B29 6AD</dd></dl></div>",
        },
        // A malformed entry with no id is skipped, not fatal.
        { title: "no id here", published: "2026-09-02T00:00:00Z" },
      ],
    },
  };

  it("lists the notices, verbatim title, URL and inlined content", () => {
    const notices = parseGazetteFeed(feed);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toBe("WILFRED JOHN SMITH (deceased)");
    expect(notices[0]?.noticeUrl).toBe("https://www.thegazette.co.uk/notice/2345-6789");
    expect(notices[0]?.noticeCode).toBe("G205010000");
    // The content block is kept, because the address is read from it rather
    // than from a second request per notice.
    expect(notices[0]?.content).toContain("Acacia Avenue");
  });

  it("yields an empty list on a body that is not a feed, rather than throwing", () => {
    expect(parseGazetteFeed("not a feed")).toEqual([]);
    expect(parseGazetteFeed(null)).toEqual([]);
    expect(parseGazetteFeed({ nonsense: true })).toEqual([]);
  });
});

/* -------------------------------------------------------- deceased estates */

describe("a deceased-estates notice is extracted, never inferred", () => {
  // The real all-notices feed, verbatim: the deceased's name is the entry
  // title and the address is in the content <dl>. Confirmed against a live
  // notice (noticetypes=2903), which is the format this must read.
  it("reads the deceased and their address from the feed entry", () => {
    const record = parseDeceasedEstate({
      id: "https://www.thegazette.co.uk/id/notice/5237386",
      title: "Kevin Drew",
      publishedAt: "2026-10-26T15:30:10Z",
      content:
        '<div><dl><dt>Address of Deceased</dt><dd>29 Coach Drive, NOTTINGHAM, NG16 3DR</dd><dt>Date of Claim Deadline</dt><dd><time datetime="2026-12-27"></time></dd></dl></div>',
    });
    expect(record?.deceasedName).toBe("Kevin Drew");
    expect(record?.lastAddress).toContain("Coach Drive");
    expect(record?.postcode).toBe("NG16 3DR");
  });

  it("strips a trailing (deceased) marker from the title", () => {
    const record = parseDeceasedEstate({
      id: "1",
      title: "WILFRED JOHN SMITH (deceased)",
      publishedAt: "2026-09-01T00:00:00Z",
    });
    expect(record?.deceasedName).toBe("WILFRED JOHN SMITH");
  });

  it("returns undefined where no deceased is named — the essential field", () => {
    expect(parseDeceasedEstate({ id: "1", title: "", publishedAt: "x" })).toBeUndefined();
    expect(parseDeceasedEstate({ id: "", title: "A", publishedAt: "x" })).toBeUndefined();
  });

  it("never takes a postcode from elsewhere in the notice when the address has none", () => {
    // The deceased's address line carries no postcode, but the notice body
    // prints the solicitor's address — with its own postcode — in the claims-to
    // paragraph. The old whole-content fallback attached THAT postcode to the
    // property and falsely marked the lead located; it must now be undefined.
    const record = parseDeceasedEstate({
      id: "https://www.thegazette.co.uk/id/notice/1",
      title: "Mary Jones",
      publishedAt: "2026-10-01T00:00:00Z",
      content:
        "<div><dl><dt>Address of Deceased</dt><dd>12 Orchard Lane, Solihull</dd></dl>" +
        "<p>Send claims to Smith &amp; Co Solicitors, 4 Queen Street, Birmingham B1 1AA.</p></div>",
    });
    expect(record?.lastAddress).toContain("Orchard Lane");
    expect(record?.postcode).toBeUndefined();
  });
});

/* ------------------------------------------------------------ insolvency */

describe("a personal-insolvency notice is extracted, never inferred", () => {
  it("reads the debtor and address, and classifies the order from the content", () => {
    const record = parseInsolvencyNotice({
      id: "9",
      title: "Jane Doe",
      publishedAt: "2026-08-20T00:00:00Z",
      content:
        "<div><dl><dt>Notice Type</dt><dd>Bankruptcy order</dd><dt>Address of Debtor</dt><dd>9 Example Road, Leeds LS1 4DT</dd></dl></div>",
    });
    expect(record?.debtorName).toBe("Jane Doe");
    expect(record?.postcode).toBe("LS1 4DT");
    expect(record?.noticeType).toBe("bankruptcy-order");
    expect(record?.noticeDate).toBe("2026-08-20T00:00:00Z");
  });

  it("classifies IVAs and debt relief orders, and falls back to other", () => {
    expect(
      parseInsolvencyNotice({ id: "1", title: "A", publishedAt: "x", content: "Individual Voluntary Arrangement" })
        ?.noticeType,
    ).toBe("individual-voluntary-arrangement");
    expect(
      parseInsolvencyNotice({ id: "2", title: "B", publishedAt: "x", content: "Debt Relief Order" })?.noticeType,
    ).toBe("debt-relief-order");
    expect(
      parseInsolvencyNotice({ id: "3", title: "C", publishedAt: "x", content: "Some other notice" })?.noticeType,
    ).toBe("other");
  });

  it("returns undefined where no debtor is named", () => {
    expect(parseInsolvencyNotice({ id: "1", title: "", publishedAt: "x" })).toBeUndefined();
    expect(parseInsolvencyNotice({ id: "", title: "A", publishedAt: "x" })).toBeUndefined();
  });

  it("never takes a postcode from the trustee's address printed in the body", () => {
    const record = parseInsolvencyNotice({
      id: "x",
      title: "John Brown",
      publishedAt: "2026-09-01T00:00:00Z",
      content:
        "<div><dl><dt>Notice Type</dt><dd>Bankruptcy order</dd>" +
        "<dt>Address of Debtor</dt><dd>7 Mill Road, Coventry</dd></dl>" +
        "<p>The trustee is at Insolvency LLP, 2 Broad Street, Leeds LS1 4DT.</p></div>",
    });
    expect(record?.lastAddress).toContain("Mill Road");
    expect(record?.postcode).toBeUndefined();
  });
});

/* ------------------------------------------------- contact for service */

describe("a notice's contact for service is read from its JSON-LD", () => {
  it("resolves the personal representative and the claim deadline", () => {
    // The shape confirmed from a live notice: the notice node references its
    // representative and carries the claim deadline directly.
    const detail = parseNoticeDetail({
      "@graph": [
        {
          "@id": "https://www.thegazette.co.uk/id/notice/5237386",
          hasClaimDeadline: "2026-12-27",
          hasPersonalRepresentative:
            "https://www.thegazette.co.uk/id/notice/5237386#estateExecutor-1",
        },
        {
          "@id": "https://www.thegazette.co.uk/id/notice/5237386#estateExecutor-1",
          name: "Messrs Example & Co Solicitors",
          address: "1 High Street, Nottingham, NG1 1AA",
        },
      ],
    });
    expect(detail.claimDeadline).toBe("2026-12-27");
    expect(detail.contactForService).toContain("Example & Co");
    expect(detail.contactForService).toContain("High Street");
  });

  it("resolves an address referenced by id", () => {
    const detail = parseNoticeDetail({
      "@graph": [
        { "@id": "n", hasPersonalRepresentative: "exec" },
        { "@id": "exec", name: "Jane Solicitor", hasAddress: "addr" },
        { "@id": "addr", streetAddress: "2 Market Square", locality: "Leeds", postalCode: "LS1 1AA" },
      ],
    });
    expect(detail.contactForService).toContain("Jane Solicitor");
    expect(detail.contactForService).toContain("Market Square");
    expect(detail.contactForService).toContain("LS1 1AA");
  });

  it("returns nothing it cannot find rather than inventing it", () => {
    expect(
      parseNoticeDetail({ "@graph": [{ "@id": "n", hasClaimDeadline: "2026-01-01" }] }).contactForService,
    ).toBeUndefined();
    expect(parseNoticeDetail("nope")).toEqual({});
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

  it("reads a notice's data from the resource path, not the identifier URI", () => {
    // The feed's identifier form has no …/data.jsonld under it; the readable data
    // lives at the /notice/ resource. Any of these forms must resolve to it.
    expect(noticeDataUrl("https://www.thegazette.co.uk/id/notice/5237386", "data.jsonld")).toBe(
      "https://www.thegazette.co.uk/notice/5237386/data.jsonld",
    );
    expect(noticeDataUrl("https://www.thegazette.co.uk/notice/2345-6789", "data.jsonld")).toBe(
      "https://www.thegazette.co.uk/notice/2345-6789/data.jsonld",
    );
    expect(noticeDataUrl("https://www.thegazette.co.uk/notice/42/", "data.json")).toBe(
      "https://www.thegazette.co.uk/notice/42/data.json",
    );
  });

  it("fetches a notice's JSON-LD from the normalised resource URL", async () => {
    const jsonld = JSON.stringify({
      "@graph": [
        { "@id": "n", hasPersonalRepresentative: "exec" },
        { "@id": "exec", name: "Example & Co", address: "1 High Street, Nottingham, NG1 1AA" },
      ],
    });
    const { fetcher, calls } = fetcherWith({
      "https://www.thegazette.co.uk/robots.txt": { status: 404 },
      "https://www.thegazette.co.uk/notice/5237386/data.jsonld": { body: jsonld },
    });
    // Passed the identifier form, as the live feed sometimes gives it.
    const result = await fetchNoticeDetail(fetcher, "https://www.thegazette.co.uk/id/notice/5237386");
    expect(result.ok).toBe(true);
    expect(result.value?.contactForService).toContain("Example & Co");
    expect(calls.some((c) => c === "https://www.thegazette.co.uk/notice/5237386/data.jsonld")).toBe(true);
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
