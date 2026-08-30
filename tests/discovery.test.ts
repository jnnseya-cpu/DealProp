import { describe, expect, it } from "vitest";
import { parseRobots, robotsAllows, unreadable, unrestricted, userAgentString } from "@backend/discovery/robots";
import { Fetcher, MAX_REQUESTS_PER_RUN } from "@backend/discovery/fetcher";
import {
  extractContacts,
  parseCompanyProfile,
  parseFirmDetails,
  recipientTypeFromName,
} from "@backend/discovery/extract";
import { buildCandidate, lookupCompany, lookupFirm, readOwnWebsite } from "@backend/discovery/connectors";
import { outreachEligibility } from "@shared/domain/outreach";

/**
 * The tests that matter here are the refusals. A failure in the gates is this
 * platform taking data it was not offered, or writing to somebody who never
 * published an address.
 */

const PROVENANCE = { sourceKey: "funder-own-website", sourceUrl: "https://example.co.uk/", observedAt: "2026-08-25T00:00:00.000Z" };

/** A transport that answers from a fixture map and records what was asked for. */
function transport(routes: Record<string, { status?: number; body?: string; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    return new Response(route.body ?? "", { status: route.status ?? 200, headers: route.headers });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

function fetcherWith(routes: Parameters<typeof transport>[0]) {
  const t = transport(routes);
  return {
    calls: t.calls,
    fetcher: new Fetcher({ transport: t.fn, now: () => 0, sleep: async () => undefined }),
  };
}

/* ---------------------------------------------------------------- robots */

describe("robots.txt is obeyed", () => {
  it("identifies this client by name with somewhere to read about it", () => {
    // A client that will not say who it is cannot be refused by preference.
    expect(userAgentString("https://lode.example")).toContain("LodeFunderDiscovery");
    expect(userAgentString("https://lode.example")).toContain("https://lode.example");
  });

  it("refuses everything when the file could not be read", () => {
    // Unknown is not permission.
    expect(robotsAllows(unreadable("timed out"), "/anything").allowed).toBe(false);
  });

  it("permits everything only where the site publishes no file at all", () => {
    expect(robotsAllows(unrestricted(), "/anything").allowed).toBe(true);
  });

  it("honours a blanket disallow", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /");
    expect(robotsAllows(rules, "/contact").allowed).toBe(false);
  });

  it("lets the longest matching rule win, not the first", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /\nAllow: /about");
    expect(robotsAllows(rules, "/about").allowed).toBe(true);
    expect(robotsAllows(rules, "/private").allowed).toBe(false);
  });

  it("prefers a group naming this client over the wildcard", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow:\n\nUser-agent: LodeFunderDiscovery\nDisallow: /lending",
    );
    expect(robotsAllows(rules, "/lending").allowed).toBe(false);
  });

  it("treats an empty Disallow as no restriction", () => {
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:"), "/x").allowed).toBe(true);
  });

  it("understands wildcards and end-anchors", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    expect(robotsAllows(rules, "/terms.pdf").allowed).toBe(false);
    expect(robotsAllows(rules, "/terms.pdf.html").allowed).toBe(true);
  });

  it("reads a crawl-delay so the publisher's pace is used", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: 10").crawlDelaySeconds).toBe(10);
  });

  it("ignores comments", () => {
    const rules = parseRobots("# nothing here\nUser-agent: *\nDisallow: /x # trailing");
    expect(robotsAllows(rules, "/x").allowed).toBe(false);
  });
});

/* --------------------------------------------------------------- fetcher */

describe("nothing is fetched that was not offered", () => {
  it("refuses a source with no recorded licence, without making a request", () => {
    const { fetcher, calls } = fetcherWith({});
    return fetcher.get("portal-listings", "https://www.rightmove.co.uk/x").then((result) => {
      expect(result.outcome).toBe("no-licence");
      expect(calls).toEqual([]);
    });
  });

  it("refuses a host the source does not publish on", async () => {
    const { fetcher, calls } = fetcherWith({});
    const result = await fetcher.get("companies-house", "https://evil.example/company/1");
    expect(result.outcome).toBe("host-not-allowed");
    expect(calls).toEqual([]);
  });

  it("refuses plain HTTP", async () => {
    const { fetcher } = fetcherWith({});
    expect((await fetcher.get("companies-house", "http://api.company-information.service.gov.uk/x")).outcome)
      .toBe("insecure-url");
  });

  it("refuses a URL carrying credentials", async () => {
    // Reaching content behind a login is exactly what must not happen.
    const { fetcher, calls } = fetcherWith({});
    const result = await fetcher.get(
      "companies-house",
      "https://user:pass@api.company-information.service.gov.uk/company/1",
    );
    expect(result.outcome).toBe("insecure-url");
    expect(calls).toEqual([]);
  });

  it("refuses to read a funder site without a verified domain to bind to", async () => {
    const { fetcher } = fetcherWith({});
    expect((await fetcher.get("funder-own-website", "https://anything.example/")).outcome)
      .toBe("host-not-allowed");
  });

  it("will not be walked onto another domain by a link", async () => {
    const { fetcher } = fetcherWith({});
    const result = await fetcher.get("funder-own-website", "https://elsewhere.example/page", {
      candidateDomain: "lender.co.uk",
    });
    expect(result.outcome).toBe("host-not-allowed");
  });

  it("allows a subdomain of the verified domain", async () => {
    const { fetcher } = fetcherWith({
      "https://www.lender.co.uk/robots.txt": { status: 404 },
      "https://www.lender.co.uk/": { body: "<html>ok</html>" },
    });
    const result = await fetcher.get("funder-own-website", "https://www.lender.co.uk/", {
      candidateDomain: "lender.co.uk",
    });
    expect(result.ok).toBe(true);
  });

  it("reads robots.txt before the page, and obeys it", async () => {
    const { fetcher, calls } = fetcherWith({
      "https://lender.co.uk/robots.txt": { body: "User-agent: *\nDisallow: /lending" },
      "https://lender.co.uk/lending": { body: "<html>secret</html>" },
    });
    const result = await fetcher.get("funder-own-website", "https://lender.co.uk/lending", {
      candidateDomain: "lender.co.uk",
    });
    expect(result.outcome).toBe("robots-disallowed");
    expect(calls).toEqual(["https://lender.co.uk/robots.txt"]);
  });

  it("refuses where robots.txt itself could not be read", async () => {
    const { fetcher } = fetcherWith({
      "https://lender.co.uk/robots.txt": { status: 500 },
      "https://lender.co.uk/": { body: "<html>ok</html>" },
    });
    expect(
      (await fetcher.get("funder-own-website", "https://lender.co.uk/", { candidateDomain: "lender.co.uk" }))
        .outcome,
    ).toBe("robots-disallowed");
  });

  it("reads robots.txt once per host", async () => {
    const { fetcher, calls } = fetcherWith({
      "https://lender.co.uk/robots.txt": { status: 404 },
      "https://lender.co.uk/": { body: "a" },
      "https://lender.co.uk/contact": { body: "b" },
    });
    await fetcher.get("funder-own-website", "https://lender.co.uk/", { candidateDomain: "lender.co.uk" });
    await fetcher.get("funder-own-website", "https://lender.co.uk/contact", { candidateDomain: "lender.co.uk" });
    expect(calls.filter((c) => c.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("treats 401, 403 and 429 as answers rather than obstacles", async () => {
    for (const status of [401, 403, 429]) {
      const { fetcher, calls } = fetcherWith({
        "https://lender.co.uk/robots.txt": { status: 404 },
        "https://lender.co.uk/": { status },
      });
      const result = await fetcher.get("funder-own-website", "https://lender.co.uk/", {
        candidateDomain: "lender.co.uk",
      });
      expect(result.outcome, `${status}`).toBe("refused-by-site");
      // One attempt only: no retry and no alternative route.
      expect(calls.filter((c) => c === "https://lender.co.uk/"), `${status}`).toHaveLength(1);
    }
  });

  it("caps how many requests one run may make", async () => {
    const routes: Record<string, { status?: number; body?: string }> = {
      "https://lender.co.uk/robots.txt": { status: 404 },
    };
    for (let i = 0; i < MAX_REQUESTS_PER_RUN + 2; i += 1) routes[`https://lender.co.uk/p${i}`] = { body: "x" };
    const { fetcher } = fetcherWith(routes);

    let exhausted = false;
    for (let i = 0; i < MAX_REQUESTS_PER_RUN + 2; i += 1) {
      const result = await fetcher.get("funder-own-website", `https://lender.co.uk/p${i}`, {
        candidateDomain: "lender.co.uk",
      });
      if (result.outcome === "budget-exhausted") exhausted = true;
    }
    expect(exhausted).toBe(true);
    expect(fetcher.requestsMade).toBeLessThanOrEqual(MAX_REQUESTS_PER_RUN);
  });

  it("sends a user-agent that says who we are", async () => {
    let seen: string | undefined;
    const fetcher = new Fetcher({
      now: () => 0,
      sleep: async () => undefined,
      transport: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        const headers = new Headers(init?.headers);
        if (!url.endsWith("robots.txt")) seen = headers.get("user-agent") ?? undefined;
        return new Response(url.endsWith("robots.txt") ? "" : "<html></html>", {
          status: url.endsWith("robots.txt") ? 404 : 200,
        });
      }) as unknown as typeof fetch,
    });
    await fetcher.get("funder-own-website", "https://lender.co.uk/", { candidateDomain: "lender.co.uk" });
    expect(seen).toContain("LodeFunderDiscovery");
  });
});

/* ------------------------------------------------------------ extraction */

describe("addresses are extracted, never invented", () => {
  const page = `
    <html><body>
      <p>We lend from £250,000 to £5,000,000 on residential bridging across England and Wales at up to 75% LTV.</p>
      <a href="mailto:enquiries@lender.co.uk">Email us</a>
      <a href="/contact-us">Contact</a>
      <p>Call 0121 496 0000</p>
      <p>Sarah's direct line: sarah.jones@lender.co.uk</p>
      <p>Our auditors: audit@someoneelse.com</p>
    </body></html>`;

  it("takes a published role mailbox", () => {
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    expect(found.emails[0]?.value).toBe("enquiries@lender.co.uk");
    expect(found.emails[0]?.provenance.inferred).toBe(false);
  });

  it("refuses a named individual's mailbox even when it is published", () => {
    // Outreach goes to a business channel, not to a person who has not been
    // told why we have their address.
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    expect(found.emails.map((e) => e.value)).not.toContain("sarah.jones@lender.co.uk");
    expect(found.rejected.map((r) => r.value)).toContain("sarah.jones@lender.co.uk");
  });

  it("refuses an address on somebody else's domain", () => {
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    expect(found.emails.map((e) => e.value)).not.toContain("audit@someoneelse.com");
  });

  it("records why anything was rejected, rather than discarding it silently", () => {
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    expect(found.rejected.every((r) => r.why.length > 20)).toBe(true);
  });

  it("takes the mandate sentence verbatim rather than summarising it", () => {
    // A summary is a new statement about somebody else's business.
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    expect(found.mandateText?.value).toContain("£250,000 to £5,000,000");
  });

  it("finds a published phone number and enquiry form", () => {
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    expect(found.phones[0]?.value).toContain("0121");
    expect(found.enquiryForms[0]?.value).toBe("https://lender.co.uk/contact-us");
  });

  it("marks every extracted fact as not inferred", () => {
    const found = extractContacts(page, "lender.co.uk", PROVENANCE);
    for (const fact of [...found.emails, ...found.phones, ...found.enquiryForms]) {
      expect(fact.provenance.inferred).toBe(false);
    }
  });

  it("finds nothing on a page that publishes nothing", () => {
    const found = extractContacts("<html><body>About us.</body></html>", "lender.co.uk", PROVENANCE);
    expect(found.emails).toEqual([]);
  });
});

describe("official records", () => {
  it("reads a Companies House profile", () => {
    const record = parseCompanyProfile({
      company_number: "01234567",
      company_name: "Example Bridging Limited",
      company_status: "active",
      date_of_creation: "2015-04-01",
    });
    expect(record?.inactive).toBe(false);
  });

  it("treats anything but active as inactive", () => {
    for (const status of ["dissolved", "liquidation", "administration", "closed"]) {
      expect(parseCompanyProfile({ company_number: "1", company_name: "X", company_status: status })?.inactive, status)
        .toBe(true);
    }
  });

  it("reads an FCA firm record and accepts only authorisation", () => {
    // "No longer authorised" is not authorisation, and treating them as the
    // same is how a lapsed or cloned firm passes verification.
    expect(parseFirmDetails({ Data: [{ FRN: "123456", "Organisation Name": "X", Status: "Authorised" }] })?.authorised)
      .toBe(true);
    expect(parseFirmDetails({ Data: [{ FRN: "123456", "Organisation Name": "X", Status: "No longer authorised" }] })?.authorised)
      .toBe(false);
  });

  it("returns nothing for a response that is not a record", () => {
    expect(parseCompanyProfile({ error: "not found" })).toBeUndefined();
    expect(parseFirmDetails({})).toBeUndefined();
  });

  it("reads legal form from a name, and guesses nothing", () => {
    expect(recipientTypeFromName("Example Bridging Limited")).toBe("limited-company");
    expect(recipientTypeFromName("Example Partners LLP")).toBe("llp");
    // Not "probably a company": unknown is treated as an individual downstream.
    expect(recipientTypeFromName("Example Capital")).toBe("unknown");
  });
});

/* ------------------------------------------------------------ connectors */

describe("connectors fail closed", () => {
  it("reads nothing from Companies House without a key", async () => {
    const { fetcher, calls } = fetcherWith({});
    const result = await lookupCompany(fetcher, "01234567", undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("COMPANIES_HOUSE_API_KEY");
    expect(calls).toEqual([]);
  });

  it("reads nothing from the FCA Register without credentials", async () => {
    const { fetcher, calls } = fetcherWith({});
    const result = await lookupFirm(fetcher, "123456", {});
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses a malformed company number before making a request", async () => {
    const { fetcher, calls } = fetcherWith({});
    expect((await lookupCompany(fetcher, "'; DROP TABLE--", "key")).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reads a funder's own page under robots", async () => {
    const { fetcher } = fetcherWith({
      "https://lender.co.uk/robots.txt": { status: 404 },
      "https://lender.co.uk/": { body: '<a href="mailto:info@lender.co.uk">x</a>' },
    });
    const result = await readOwnWebsite(fetcher, "lender.co.uk");
    expect(result.value?.emails[0]?.value).toBe("info@lender.co.uk");
  });
});

describe("building a candidate", () => {
  const routes = {
    "https://lender.co.uk/robots.txt": { status: 404 },
    "https://lender.co.uk/": {
      body: '<p>We lend from £250,000 to £5,000,000 on bridging at up to 75% LTV.</p><a href="mailto:enquiries@lender.co.uk">x</a>',
    },
  };

  it("lands on PARTIALLY_VERIFIED where the company could not be confirmed", async () => {
    const { fetcher } = fetcherWith(routes);
    const { candidate } = await buildCandidate(fetcher, {
      organisationName: "Example Bridging Limited",
      domain: "lender.co.uk",
    });
    expect(candidate.status).toBe("PARTIALLY_VERIFIED");
    // And a partial candidate carries no verification date, so it cannot age
    // into looking current.
    expect(candidate.verifiedAt).toBeUndefined();
  });

  it("rejects and blocks a warning-list match", async () => {
    const { fetcher } = fetcherWith(routes);
    const { candidate } = await buildCandidate(fetcher, {
      organisationName: "Example Bridging Limited",
      domain: "lender.co.uk",
      warningList: ["example bridging limited"],
    });
    expect(candidate.status).toBe("REJECTED");
    expect(candidate.doNotContact).toBe(true);
  });

  it("produces a candidate that the outreach gate then refuses", async () => {
    // The two halves have to agree: a candidate discovery could not verify is a
    // candidate outreach will not write to.
    const { fetcher } = fetcherWith(routes);
    const { candidate } = await buildCandidate(fetcher, {
      organisationName: "Example Bridging Limited",
      domain: "lender.co.uk",
    });
    const decision = outreachEligibility(candidate, "mandate-enquiry", {
      consentRecorded: false,
      softOptInApplies: false,
      complianceApproved: false,
      promotionApproved: false,
      alreadyContactedForDeal: false,
      dealDisclosureConsent: false,
      now: new Date("2026-08-25T12:00:00.000Z"),
    });
    expect(decision.maySend).toBe(false);
  });

  it("records what it did and did not take", async () => {
    const { fetcher } = fetcherWith(routes);
    const { notes } = await buildCandidate(fetcher, {
      organisationName: "Example Bridging Limited",
      domain: "lender.co.uk",
    });
    expect(notes.join(" ")).toContain("Companies House");
    expect(notes.join(" ")).toContain("Own website");
  });
});
