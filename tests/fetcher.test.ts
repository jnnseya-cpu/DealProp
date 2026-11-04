import { describe, expect, it } from "vitest";
import { Fetcher, isBlockedHost } from "@backend/discovery/fetcher";

/**
 * The outbound crawl path's host defences: the private-network (SSRF) block and
 * redirect re-validation. The gates are otherwise exercised through the
 * discovery/gazette/listing tests; these pin the two that were hardened.
 */

const quiet = { now: () => 0, sleep: async () => undefined };

describe("isBlockedHost", () => {
  it("blocks private, loopback, link-local and internal hosts", () => {
    for (const h of [
      "127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd00::1", "localhost",
      "db.internal", "printer.local", "[::1]",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows ordinary public hosts", () => {
    for (const h of [
      "www.thegazette.co.uk", "api.company-information.service.gov.uk",
      "landregistry.data.gov.uk", "8.8.8.8", "203.0.113.4",
    ]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});

describe("Fetcher host defences", () => {
  it("refuses a candidate domain that is a private address, without any request", () => {
    const calls: string[] = [];
    const transport = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    const fetcher = new Fetcher({ transport, ...quiet });
    return fetcher
      .get("funder-own-website", "https://127.0.0.1/mandate", { candidateDomain: "127.0.0.1" })
      .then((r) => {
        expect(r.ok).toBe(false);
        expect(r.outcome).toBe("host-not-allowed");
        expect(calls).toHaveLength(0); // blocked before any traffic
      });
  });

  it("refuses a redirect that leaves the allowlisted host, and never fetches it", async () => {
    const calls: string[] = [];
    const transport = (async (input: RequestInfo | URL) => {
      const u = String(input);
      calls.push(u);
      if (u.endsWith("/robots.txt")) return new Response("", { status: 200 });
      if (u === "https://www.thegazette.co.uk/notice/1") {
        return new Response("", { status: 302, headers: { location: "https://evil.example.com/x" } });
      }
      return new Response("SHOULD NOT BE FETCHED", { status: 200 });
    }) as unknown as typeof fetch;
    const fetcher = new Fetcher({ transport, ...quiet });

    const r = await fetcher.get("the-gazette", "https://www.thegazette.co.uk/notice/1");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("host-not-allowed");
    expect(calls).not.toContain("https://evil.example.com/x");
  });

  it("refuses when the injected resolver points the host at a private address", async () => {
    const transport = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/robots.txt")) return new Response("", { status: 200 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const fetcher = new Fetcher({ transport, resolveHost: async () => ["10.0.0.5"], ...quiet });

    const r = await fetcher.get("the-gazette", "https://www.thegazette.co.uk/notice/1");
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("host-not-allowed");
  });
});
