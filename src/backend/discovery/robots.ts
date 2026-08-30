/**
 * robots.txt, parsed and obeyed.
 *
 * This is the first gate on every outbound request the discovery agent makes.
 * A publisher's robots file is how a site says what automated clients may read,
 * and ignoring it is the difference between reading something published for
 * reading and taking something that was not offered. It is also, in this
 * codebase, the difference between a licensed source and a prohibited one — the
 * licence registry says whether we may use a source at all, and this says
 * whether that particular path was offered.
 *
 * The parser is deliberately strict in our disfavour:
 *
 *  - **A file we cannot read means no.** A network error, a timeout or a 500
 *    leaves us unable to say what was permitted, and "unknown" is not
 *    permission. Only an explicit 404 — the site has no robots file at all —
 *    counts as unrestricted, which is what the standard says it means.
 *  - **The longest matching rule wins**, as the standard requires, so a broad
 *    `Disallow: /` with a narrow `Allow: /about` permits `/about` and nothing
 *    else.
 *  - **Our own user-agent is matched before the wildcard.** A site that names
 *    us specifically has said something more precise than its default.
 *  - **Crawl-delay is honoured** where given, and where it is absent the
 *    fetcher's own floor applies instead. The slower of the two always wins.
 */

/**
 * How this client identifies itself.
 *
 * A real name and a URL somebody can visit to find out what we are and how to
 * stop us. An anonymous or spoofed agent string is what a client uses when it
 * expects to be unwelcome, and a publisher cannot exercise a preference against
 * a client that will not say who it is.
 */
export const USER_AGENT_TOKEN = "LodeFunderDiscovery";

export function userAgentString(contactUrl: string): string {
  return `${USER_AGENT_TOKEN}/1.0 (+${contactUrl})`;
}

export interface RobotsRules {
  /** Ordered longest-first, so the first match is the most specific. */
  readonly rules: readonly { readonly allow: boolean; readonly path: string }[];
  /** Seconds the publisher asked clients to wait between requests. */
  readonly crawlDelaySeconds?: number;
  /** False where the file could not be read and nothing may be assumed. */
  readonly readable: boolean;
  readonly reason: string;
}

/** No file at all: the standard reading is that everything is permitted. */
export function unrestricted(): RobotsRules {
  return {
    rules: [],
    readable: true,
    reason: "The site publishes no robots.txt, which the standard treats as no restriction.",
  };
}

/** Anything we could not read. Refuses everything. */
export function unreadable(reason: string): RobotsRules {
  return { rules: [{ allow: false, path: "/" }], readable: false, reason };
}

/**
 * Parse a robots.txt body for our user-agent.
 *
 * Groups are matched by user-agent. A group naming this client exactly is
 * preferred over `*`; where neither appears, nothing is restricted by the file.
 */
export function parseRobots(body: string, agent: string = USER_AGENT_TOKEN): RobotsRules {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());

  const groups = new Map<string, { allow: boolean; path: string }[]>();
  const delays = new Map<string, number>();
  let current: string[] = [];
  let expectingAgents = false;

  for (const line of lines) {
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group of rules.
      if (!expectingAgents) current = [];
      current.push(value.toLowerCase());
      expectingAgents = true;
      for (const a of current) if (!groups.has(a)) groups.set(a, []);
      continue;
    }

    expectingAgents = false;
    if (current.length === 0) continue;

    if (field === "allow" || field === "disallow") {
      for (const a of current) {
        // An empty Disallow means "nothing is disallowed" and is not a rule.
        if (field === "disallow" && value === "") continue;
        groups.get(a)?.push({ allow: field === "allow", path: value });
      }
    }
    if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        for (const a of current) delays.set(a, seconds);
      }
    }
  }

  const key = groups.has(agent.toLowerCase()) ? agent.toLowerCase() : "*";
  const chosen = groups.get(key) ?? [];
  const delay = delays.get(key);

  return {
    // Longest path first: the standard resolves a conflict by specificity, not
    // by order of appearance.
    rules: [...chosen].sort((a, b) => b.path.length - a.path.length),
    ...(delay !== undefined ? { crawlDelaySeconds: delay } : {}),
    readable: true,
    reason:
      chosen.length === 0
        ? `No rules for ${agent} or for *. Nothing is restricted by this file.`
        : `${chosen.length} rule(s) apply to ${key}.`,
  };
}

export interface RobotsDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

/** Whether this path may be fetched. */
export function robotsAllows(rules: RobotsRules, pathname: string): RobotsDecision {
  if (!rules.readable) {
    return { allowed: false, reason: rules.reason };
  }

  for (const rule of rules.rules) {
    if (!matches(rule.path, pathname)) continue;
    return {
      allowed: rule.allow,
      reason: rule.allow
        ? `Explicitly allowed by "Allow: ${rule.path}".`
        : `Disallowed by "Disallow: ${rule.path}".`,
    };
  }

  return { allowed: true, reason: "No rule matches this path." };
}

/**
 * Path matching, including the `*` and `$` extensions every major crawler
 * supports and most robots files are written against.
 */
function matches(pattern: string, pathname: string): boolean {
  if (pattern === "") return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(pathname);
}
