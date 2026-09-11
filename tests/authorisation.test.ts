import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every server action authorises itself.
 *
 * A server action is a POST endpoint with a generated URL. The page guard does
 * not cover it — a page that never renders can still have its action invoked —
 * and the middleware is one layer that has been bypassed by framework
 * advisories more than once. So the rule is that each action makes its own
 * decision, and this is what makes the rule true rather than aspirational.
 *
 * It follows one level of delegation on purpose, because the real pattern in
 * this codebase is a local `actorFor()` or `update()` helper that calls
 * `requirePermission` once for a file of actions. A check that could not see
 * through that would have to be silenced on half the files, and a check that
 * gets silenced is not a check.
 */

const APP = path.join(process.cwd(), "src", "app");

/**
 * Actions with no account behind them, and the reason each one is allowed to
 * be. A file added here needs a sentence, which is the point: the cost of the
 * exemption is having to justify it in writing.
 */
const PUBLIC_BY_DESIGN: Readonly<Record<string, string>> = {
  "newsletter/actions.ts":
    "Double opt-in. A subscriber has no account by design, and consent is the record.",
  "sell/actions.ts":
    "A seller has no account and never will. Rate limited instead, and the result is a capability URL.",
  "operator/actions.ts": "Sign-in and sign-out themselves, which cannot require being signed in.",
};

/**
 * Anything that reaches a real decision about who is asking.
 *
 * Rate limiting is deliberately absent. It bounds how fast somebody can abuse
 * an endpoint; it does not decide whether they may use it, and treating the
 * two as the same thing is how an endpoint ends up "protected" by a limiter.
 * The seller enquiry form is rate limited *and* public by design, and those
 * are two separate statements about it.
 */
const GUARDS = [
  "requirePermission(",
  "requireOperator(",
  "requireAccount(",
  "assertOperator(",
  "currentViewer(",
  "currentAccount(",
  "viewerAccount(",
  "authoriseDecision(",
  "tokenMatches",
  "verifyOperatorCookie(",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Every `async function` in a file, mapped to its source. */
function functionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const declaration = /(?:export\s+)?async function (\w+)\s*\(/g;
  for (const match of source.matchAll(declaration)) {
    const from = match.index ?? 0;
    const rest = source.slice(match.index === undefined ? 0 : match.index + match[0].length);
    const next = /\n(?:export\s+)?async function /.exec(rest);
    const to =
      (match.index ?? 0) + match[0].length + (next === null ? rest.length : next.index);
    bodies.set(match[1] ?? "", source.slice(from, to));
  }
  return bodies;
}

interface Action {
  readonly file: string;
  readonly name: string;
  readonly guards: readonly string[];
}

function actions(): readonly Action[] {
  const found: Action[] = [];
  for (const file of walk(APP)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('"use server"')) continue;

    const bodies = functionBodies(source);
    const relative = path.relative(APP, file).split(path.sep).join("/");

    for (const match of source.matchAll(/export async function (\w+)\s*\(/g)) {
      const name = match[1] ?? "";
      const body = bodies.get(name) ?? "";
      // One level of local delegation.
      let reach = body;
      for (const [helper, helperBody] of bodies) {
        if (helper !== name && new RegExp(`\\b${helper}\\s*\\(`).test(body)) reach += helperBody;
      }
      found.push({
        file: relative,
        name,
        guards: GUARDS.filter((guard) => reach.includes(guard)),
      });
    }
  }
  return found;
}

describe("server actions", () => {
  it("finds the actions at all", () => {
    // A walker that silently matched nothing would pass every test below it.
    const all = actions();
    expect(all.length).toBeGreaterThan(40);
    expect(new Set(all.map((a) => a.file)).size).toBeGreaterThan(10);
  });

  it("every one decides for itself who is asking", () => {
    for (const action of actions()) {
      if (action.guards.length > 0) continue;
      const reason = PUBLIC_BY_DESIGN[action.file];
      expect(
        reason,
        `${action.file}::${action.name} reaches no authorisation call. A server action is a POST ` +
          "endpoint of its own: the page guard does not cover it. Either call one, or record why " +
          "it is public in PUBLIC_BY_DESIGN with a reason.",
      ).toBeDefined();
    }
  });

  it("keeps no exemption that is no longer needed", () => {
    // An exemption for a file that now guards itself is a stale exemption, and
    // stale exemptions are how a list stops meaning anything.
    const all = actions();
    for (const file of Object.keys(PUBLIC_BY_DESIGN)) {
      const forFile = all.filter((a) => a.file === file);
      expect(forFile.length, `${file} is exempt but has no server actions`).toBeGreaterThan(0);
      expect(
        forFile.some((a) => a.guards.length === 0),
        `${file} is listed as public by design but every action in it now guards itself`,
      ).toBe(true);
    }
  });
});

describe("api routes", () => {
  const API = path.join(APP, "api");

  /** The one route that is unauthenticated on purpose. */
  const OPEN: Readonly<Record<string, string>> = {
    "health/route.ts":
      "Liveness for the load balancer. Returns a status and the store kind and nothing else — no version, no configuration, no error text.",
  };

  const CHECKS = [
    "CRON_SECRET",
    "BILLING_WEBHOOK_SECRET",
    "verifyWebhook",
    "requirePermission",
    "currentAccount",
    "currentViewer",
    "tokenMatches",
    "timingSafeEqual",
    "consume(",
    "rateLimit",
  ];

  it("every route verifies something, or is recorded as open", () => {
    for (const file of walk(API)) {
      if (!file.endsWith("route.ts")) continue;
      const relative = path.relative(API, file).split(path.sep).join("/");
      const source = readFileSync(file, "utf8");
      if (CHECKS.some((check) => source.includes(check))) continue;
      expect(
        OPEN[relative],
        `src/app/api/${relative} verifies nothing and is not recorded as deliberately open.`,
      ).toBeDefined();
    }
  });

  it("the open route stays uninformative", () => {
    // Comments stripped: this file's own doc comment explains why it does not
    // return a stack trace, and a scan over the prose flagged the word.
    const health = readFileSync(path.join(API, "health", "route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    // A health endpoint that reports a hostname or a stack trace is a
    // reconnaissance endpoint with a friendly name.
    for (const leak of ["process.env", "error.message", "String(error)", "stack"]) {
      expect(health.includes(leak), `health route exposes ${leak}`).toBe(false);
    }
  });
});

/**
 * Fixtures never appear as live figures.
 *
 * The distinction this codebase makes, and the one worth keeping: a labelled
 * worked example is honest and is the only way to demonstrate an engine to
 * somebody on the day the pipeline is empty. A *count* taken from a fixture is
 * not — "50 verified buyers" read off a seed constant is the first thing a
 * visitor would discover was untrue.
 */
describe("fixtures on public pages", () => {
  const SEED_IMPORTERS = ["page.tsx"];

  it("is imported by the worked example and nowhere else", () => {
    for (const file of walk(APP)) {
      const source = readFileSync(file, "utf8");
      if (!/SEED_(DEALS|BUY_BOXES|FUNDING_BOXES)/.test(source)) continue;
      const relative = path.relative(APP, file).split(path.sep).join("/");
      expect(
        SEED_IMPORTERS.includes(relative),
        `${relative} reads seed fixtures. Only the landing page's labelled worked example may.`,
      ).toBe(true);
    }
  });

  it("keeps the worked example labelled as one", () => {
    const landing = readFileSync(path.join(APP, "page.tsx"), "utf8");
    // Twice: the section eyebrow, and the card the seller routes sit in.
    expect(landing).toContain("worked example");
    expect(landing).toContain("Worked example");
    // And it must still say the property is an illustration rather than stock.
    expect(landing).toContain("not a live listing");
  });

  it("takes every count from the store rather than from a fixture", () => {
    const landing = readFileSync(path.join(APP, "page.tsx"), "utf8");
    // The supply figures are the ones a visitor reads as "how big is this".
    // They come from supplyPosition(), which counts the store — a fixture here
    // was the original bug and is the reason this test exists.
    expect(landing).toContain("supplyPosition(");
    expect(landing).toContain("listDeals()");
    for (const source of ["supply.open", "supply.fundingMandates", "supply.buyMandates"]) {
      expect(landing, `${source} should be read from the computed position`).toContain(source);
    }
  });
});
