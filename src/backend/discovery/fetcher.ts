import { assertSourceUsable } from "@shared/domain/sources";
import {
  parseRobots,
  robotsAllows,
  unreadable,
  unrestricted,
  userAgentString,
  type RobotsRules,
} from "@backend/discovery/robots";

/**
 * The outbound path for unauthenticated discovery crawling.
 *
 * Everything a connector CRAWLS — public pages read without a key — goes
 * through here, so the rules live in one place and a new connector cannot
 * quietly skip them. There is one other outbound path, and only one: an
 * authenticated call to a licensed API we hold a key for (the EPC register,
 * `backend/sources/epc.ts`). That is deliberately not routed through here,
 * because robots.txt governs crawlers of public pages, not an API client with
 * a licence and a credential — it enforces its own appropriate controls (the
 * licence gate, the credential, a timeout, and no credential-carrying
 * redirect). Any NEW unauthenticated fetch must go through this class.
 *
 * Six gates, in order, and
 * the order matters — the cheapest refusals come first so a prohibited source
 * never generates traffic at all:
 *
 *  1. **A recorded licence.** `assertSourceUsable()` throws at the point of
 *     taking rather than at the point of display, because the exposure is
 *     created by taking the data. A source with no licence recorded fetches
 *     nothing, ever.
 *  2. **An allowlisted host.** Licences are recorded per source; a source is
 *     bound to the hosts it actually publishes on, so a redirect cannot walk a
 *     licensed fetch onto an unlicensed site.
 *  3. **HTTPS, and no credentials in the URL.** A `user:pass@` URL is somebody
 *     trying to get past a login, which is exactly what must not happen.
 *  4. **robots.txt.** Fetched once per host, cached, and obeyed. Unreadable
 *     means no.
 *  5. **Rate limiting.** The publisher's crawl-delay or our floor, whichever is
 *     slower, per host.
 *  6. **A refusal is final.** 401, 403 and 429 are answers, not obstacles. No
 *     retry, no alternate path, no second attempt with different headers.
 *
 * NOTE ON VERIFICATION: outbound access is blocked in this build environment,
 * so no live request has been made from here. The gates are unit-tested against
 * an injected fetch; the connectors are fixture-tested. Run one live call per
 * source before relying on any of it.
 */

/** How this client identifies itself, and where to read about it. */
const CONTACT_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.invalid";

/**
 * The slowest we go regardless of what a publisher permits.
 *
 * One request every two seconds per host. Discovery is not time-critical —
 * nothing here is worth being a burden to somebody else's server for.
 */
const MIN_INTERVAL_MS = 2_000;

/** A run's total budget, so a loop cannot become a flood. */
export const MAX_REQUESTS_PER_RUN = 60;

/** Beyond this a page is not a mandate page and is not worth reading. */
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 15_000;

/** The most redirect hops followed before giving up. Each hop is re-validated. */
const MAX_REDIRECTS = 5;

/**
 * Whether a hostname names a private, loopback, link-local or otherwise
 * internal target that must never be fetched (SSRF defence, §12 "block
 * private-network targets").
 *
 * This is a literal check on the hostname — it blocks an IP literal in a
 * private range, the IPv6 loopback/ULA/link-local forms, and the internal name
 * suffixes — so it needs no DNS and runs identically in tests and production.
 * It catches the blatant vectors: a candidate domain that is itself
 * `127.0.0.1`, the cloud metadata address `169.254.169.254`, `localhost`, or a
 * `10.`/`192.168.` literal. It does NOT resolve a public hostname to see
 * whether DNS points it at a private address (the rebinding case) — that needs
 * a resolver this pure function deliberately does not reach for; a caller that
 * wants it passes one through `FetcherOptions.resolveHost`.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "" || h === "localhost") return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4 !== null) {
    const octets = v4.slice(1, 5).map(Number);
    if (octets.some((n) => n > 255)) return true; // malformed → refuse
    const [a, b] = octets as [number, number, number, number];
    if (a === 0 || a === 127 || a === 10) return true; // this-host, loopback, private
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }

  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true; // loopback, unspecified
    if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local, ULA
    const mapped = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h); // ::ffff:a.b.c.d
    if (mapped !== null) return isBlockedHost(mapped[1] as string);
    return false;
  }

  return false;
}

export type FetchOutcome =
  | "ok"
  | "no-licence"
  | "host-not-allowed"
  | "insecure-url"
  | "robots-disallowed"
  | "refused-by-site"
  | "budget-exhausted"
  | "too-large"
  | "network-error";

export interface FetchResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome;
  readonly status?: number;
  readonly body?: string;
  readonly url: string;
  /** Always populated. Recorded against the candidate as provenance. */
  readonly reason: string;
  readonly fetchedAt: string;
}

export interface FetcherOptions {
  /** Injected so the gates can be tested without a network. */
  readonly transport?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Optional DNS resolver. When provided, every target host is resolved and
   * the fetch is refused if any address is private/loopback/link-local — the
   * DNS-rebinding case the literal {@link isBlockedHost} check cannot see. Left
   * unset in tests (which inject a transport and never touch DNS); a production
   * caller that wants rebinding protection passes a `node:dns` lookup here.
   */
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
}

/**
 * Hosts each source is permitted to reach.
 *
 * Bound to the source rather than left open, so a licence for Companies House
 * cannot be used to justify fetching something else. `funder-own-website` is
 * necessarily open-hosted — the whole point is reading a specific funder's own
 * site — and is constrained by robots and by the candidate's verified domain
 * instead.
 */
const SOURCE_HOSTS: Record<string, readonly string[] | "candidate-domain"> = {
  "companies-house": ["api.company-information.service.gov.uk"],
  "fca-register": ["register.fca.org.uk"],
  "funder-own-website": "candidate-domain",
  // The two open-data sources that between them find properties nobody has
  // listed. Both are licensed in the registry and neither had a host, so both
  // were refused at this gate — a licence with nowhere to fetch from is not a
  // usable source, which is worth the two lines it takes to fix.
  "land-registry-ppd": ["landregistry.data.gov.uk", "use-land-property.service.gov.uk"],
  "epc-register": ["epc.opendatacommunities.org"],
  // The Gazette publishes its official-record API on www.thegazette.co.uk; the
  // api. host is its documented alias. Both are bound here so a notice link
  // that resolves to either is read, and nothing else is. No live call has
  // been made from this environment, so confirm the serving host against one
  // real request before relying on it.
  "the-gazette": ["www.thegazette.co.uk", "api.thegazette.co.uk"],
  // A rights-holder's own listing page, bound to the domain they submitted —
  // the same posture as a funder's own site. Portals are refused before the
  // fetch by classifyImportUrl, so they never reach this gate.
  "listing-import": "candidate-domain",
};

export class Fetcher {
  private readonly transport: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly resolveHost: ((hostname: string) => Promise<readonly string[]>) | undefined;
  private readonly robotsByHost = new Map<string, RobotsRules>();
  private readonly lastRequestByHost = new Map<string, number>();
  private used = 0;

  constructor(options: FetcherOptions = {}) {
    this.transport = options.transport ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.resolveHost = options.resolveHost;
  }

  /** Requests made so far in this run. */
  get requestsMade(): number {
    return this.used;
  }

  async get(
    sourceKey: string,
    url: string,
    options: { readonly candidateDomain?: string; readonly headers?: Record<string, string> } = {},
  ): Promise<FetchResult> {
    const at = new Date().toISOString();
    const fail = (outcome: FetchOutcome, reason: string, status?: number): FetchResult => ({
      ok: false,
      outcome,
      ...(status !== undefined ? { status } : {}),
      url,
      reason,
      fetchedAt: at,
    });

    // 1. Licence. Throws where nothing is recorded; a throw here is correct —
    // it is a programming error to ask for an unlicensed source.
    try {
      assertSourceUsable(sourceKey, "internal-analysis");
    } catch (error) {
      return fail("no-licence", error instanceof Error ? error.message : "No licence recorded.");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail("insecure-url", "Not a valid URL.");
    }

    // Gates 2–3, as a closure so every redirect hop is re-validated: the
    // private-host block, HTTPS, no-credentials and the host allowlist. A
    // redirect is a fresh target, and a licensed fetch must not be walked onto
    // another site, a login, or a private address by a 30x.
    const validate = (u: URL): FetchResult | undefined => {
      if (u.protocol !== "https:") {
        return fail("insecure-url", "Only HTTPS is fetched. Plain HTTP is neither private nor authenticated.");
      }
      if (u.username !== "" || u.password !== "") {
        return fail(
          "insecure-url",
          "The URL carries credentials. Reaching content behind a login is exactly what this must not do.",
        );
      }
      if (isBlockedHost(u.hostname)) {
        return fail(
          "host-not-allowed",
          `${u.hostname} is a private, loopback or link-local address and is never fetched.`,
        );
      }
      const permitted = SOURCE_HOSTS[sourceKey];
      if (permitted === undefined) {
        return fail("host-not-allowed", `No hosts are recorded for source ${sourceKey}.`);
      }
      if (permitted === "candidate-domain") {
        const domain = options.candidateDomain?.toLowerCase();
        if (domain === undefined || domain === "") {
          return fail("host-not-allowed", "Reading a funder's own site requires a verified domain to bind the fetch to.");
        }
        if (u.hostname.toLowerCase() !== domain && !u.hostname.toLowerCase().endsWith(`.${domain}`)) {
          return fail(
            "host-not-allowed",
            `${u.hostname} is not ${domain}. A licensed fetch must not be walked onto another site by a link or a redirect.`,
          );
        }
      } else if (!permitted.includes(u.hostname.toLowerCase())) {
        return fail("host-not-allowed", `${u.hostname} is not a published host for ${sourceKey}.`);
      }
      return undefined;
    };

    // Optional DNS-rebinding check: resolve the host and refuse if it points at
    // a private address. Only runs where a resolver was injected.
    const resolveBlocked = async (u: URL): Promise<FetchResult | undefined> => {
      if (this.resolveHost === undefined) return undefined;
      let addresses: readonly string[];
      try {
        addresses = await this.resolveHost(u.hostname);
      } catch {
        return fail("network-error", `${u.hostname} could not be resolved, so it cannot be shown to be safe.`);
      }
      if (addresses.some((ip) => isBlockedHost(ip))) {
        return fail("host-not-allowed", `${u.hostname} resolves to a private or loopback address and is never fetched.`);
      }
      return undefined;
    };

    const invalid = validate(parsed);
    if (invalid !== undefined) return invalid;

    if (this.used >= MAX_REQUESTS_PER_RUN) {
      return fail("budget-exhausted", `A run makes at most ${MAX_REQUESTS_PER_RUN} requests.`);
    }

    // The request, following redirects by hand so each hop is re-validated
    // rather than trusted. `redirect: "manual"` returns the 30x to us.
    let current = parsed;
    for (let hop = 0; ; hop += 1) {
      // 4. robots.txt, for this hop's host and path.
      const rules = await this.robotsFor(current);
      const decision = robotsAllows(rules, current.pathname);
      if (!decision.allowed) {
        return fail("robots-disallowed", `robots.txt: ${decision.reason}`);
      }

      // 5. Rate limit: the publisher's stated delay or our floor, whichever is slower.
      await this.pace(current.hostname, rules.crawlDelaySeconds);

      const dnsBlocked = await resolveBlocked(current);
      if (dnsBlocked !== undefined) return dnsBlocked;

      // 6. The request itself.
      try {
        this.used += 1;
        const response = await this.transport(current.toString(), {
          headers: {
            "user-agent": userAgentString(CONTACT_URL),
            accept: "text/html,application/json;q=0.9,*/*;q=0.1",
            ...options.headers,
          },
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        // A redirect: re-validate the destination against every gate before following.
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location === null || location === "") {
            return fail("network-error", `A ${response.status} redirect carried no destination.`, response.status);
          }
          if (hop >= MAX_REDIRECTS) {
            return fail("network-error", `More than ${MAX_REDIRECTS} redirects; refusing to follow further.`);
          }
          let nextUrl: URL;
          try {
            nextUrl = new URL(location, current);
          } catch {
            return fail("insecure-url", "The redirect pointed at an invalid URL.");
          }
          const redirectInvalid = validate(nextUrl);
          if (redirectInvalid !== undefined) return redirectInvalid;
          current = nextUrl;
          continue;
        }

        if (response.status === 401 || response.status === 403 || response.status === 429) {
          // An answer, not an obstacle. Nothing here retries or tries another way.
          return fail(
            "refused-by-site",
            `The site answered ${response.status}. That is a refusal and it is respected — no retry, no alternative route.`,
            response.status,
          );
        }
        if (!response.ok) {
          return fail("network-error", `The site answered ${response.status}.`, response.status);
        }

        const length = Number(response.headers.get("content-length") ?? "0");
        if (length > MAX_BYTES) {
          return fail("too-large", `${length} bytes is larger than a mandate page and is not read.`);
        }

        const body = await response.text();
        if (body.length > MAX_BYTES) {
          return fail("too-large", "The body exceeded the size a mandate page should be.");
        }

        return {
          ok: true,
          outcome: "ok",
          status: response.status,
          body,
          url: current.toString(),
          reason: "Fetched under a recorded licence, permitted by robots.txt and within the rate limit.",
          fetchedAt: at,
        };
      } catch (error) {
        return fail("network-error", error instanceof Error ? error.message : "Request failed.");
      }
    }
  }

  /** robots.txt once per host, then cached for the run. */
  private async robotsFor(url: URL): Promise<RobotsRules> {
    const host = url.hostname.toLowerCase();
    const cached = this.robotsByHost.get(host);
    if (cached !== undefined) return cached;

    let rules: RobotsRules;
    try {
      const response = await this.transport(`https://${host}/robots.txt`, {
        headers: { "user-agent": userAgentString(CONTACT_URL) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) {
        rules = unrestricted();
      } else if (response.ok) {
        rules = parseRobots(await response.text());
      } else {
        rules = unreadable(
          `robots.txt answered ${response.status}, so what the site permits is unknown. Unknown is not permission.`,
        );
      }
    } catch {
      rules = unreadable("robots.txt could not be read, so what the site permits is unknown.");
    }

    this.robotsByHost.set(host, rules);
    return rules;
  }

  private async pace(host: string, crawlDelaySeconds: number | undefined): Promise<void> {
    const interval = Math.max(MIN_INTERVAL_MS, (crawlDelaySeconds ?? 0) * 1000);
    const last = this.lastRequestByHost.get(host);
    const now = this.now();
    if (last !== undefined) {
      const wait = last + interval - now;
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestByHost.set(host, this.now());
  }
}
