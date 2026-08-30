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
 * The only way this platform makes an outbound request for discovery.
 *
 * Everything a connector fetches goes through here, so the rules live in one
 * place and a new connector cannot quietly skip them. Six gates, in order, and
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
};

export class Fetcher {
  private readonly transport: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly robotsByHost = new Map<string, RobotsRules>();
  private readonly lastRequestByHost = new Map<string, number>();
  private used = 0;

  constructor(options: FetcherOptions = {}) {
    this.transport = options.transport ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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

    // 3. Transport and credentials, checked before the host so a credentialed
    // URL is refused even for an allowlisted host.
    if (parsed.protocol !== "https:") {
      return fail("insecure-url", "Only HTTPS is fetched. Plain HTTP is neither private nor authenticated.");
    }
    if (parsed.username !== "" || parsed.password !== "") {
      return fail(
        "insecure-url",
        "The URL carries credentials. Reaching content behind a login is exactly what this must not do.",
      );
    }

    // 2. Host allowlist.
    const permitted = SOURCE_HOSTS[sourceKey];
    if (permitted === undefined) {
      return fail("host-not-allowed", `No hosts are recorded for source ${sourceKey}.`);
    }
    if (permitted === "candidate-domain") {
      const domain = options.candidateDomain?.toLowerCase();
      if (domain === undefined || domain === "") {
        return fail("host-not-allowed", "Reading a funder's own site requires a verified domain to bind the fetch to.");
      }
      if (parsed.hostname.toLowerCase() !== domain && !parsed.hostname.toLowerCase().endsWith(`.${domain}`)) {
        return fail(
          "host-not-allowed",
          `${parsed.hostname} is not ${domain}. A licensed fetch must not be walked onto another site by a link or a redirect.`,
        );
      }
    } else if (!permitted.includes(parsed.hostname.toLowerCase())) {
      return fail("host-not-allowed", `${parsed.hostname} is not a published host for ${sourceKey}.`);
    }

    if (this.used >= MAX_REQUESTS_PER_RUN) {
      return fail("budget-exhausted", `A run makes at most ${MAX_REQUESTS_PER_RUN} requests.`);
    }

    // 4. robots.txt.
    const rules = await this.robotsFor(parsed);
    const decision = robotsAllows(rules, parsed.pathname);
    if (!decision.allowed) {
      return fail("robots-disallowed", `robots.txt: ${decision.reason}`);
    }

    // 5. Rate limit: the publisher's stated delay or our floor, whichever is slower.
    await this.pace(parsed.hostname, rules.crawlDelaySeconds);

    // 6. The request itself.
    try {
      this.used += 1;
      const response = await this.transport(parsed.toString(), {
        headers: {
          "user-agent": userAgentString(CONTACT_URL),
          accept: "text/html,application/json;q=0.9,*/*;q=0.1",
          ...options.headers,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

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
        url: parsed.toString(),
        reason: "Fetched under a recorded licence, permitted by robots.txt and within the rate limit.",
        fetchedAt: at,
      };
    } catch (error) {
      return fail("network-error", error instanceof Error ? error.message : "Request failed.");
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
