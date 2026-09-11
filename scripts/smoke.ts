import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { operatorCookieValue } from "../src/backend/auth/operator";

/**
 * Load every page in a real browser and refuse to be satisfied by a 200.
 *
 * A status code says the server produced bytes. It does not say the page
 * hydrated, that its scripts were allowed to run, that a request it makes did
 * not fail, or that React threw during render — and every one of those
 * produces a blank or half-dead page that returns 200 all day.
 *
 * This exists because the Content-Security-Policy is the kind of change whose
 * failure mode is invisible to curl. A policy that blocks the framework's own
 * bootstrap serves a perfect-looking HTML document that does nothing when
 * clicked. The only way to know is to open it.
 *
 * Usage: npm run smoke -- [baseUrl]
 * The server must already be running. It is not started here on purpose: the
 * thing worth testing is the production build, and starting it is a decision
 * about which build.
 */

const PUBLIC = [
  "/",
  "/blog",
  "/glossary",
  "/appraise",
  "/sell",
  "/partners",
  "/newsletter",
  "/llms.txt",
  "/robots.txt",
  "/sitemap.xml",
];

/** Behind the gate. Visited with an operator cookie, which is the point. */
const GATED = [
  "/deals",
  "/invest",
  "/capital",
  "/opportunities",
  "/portfolio",
  "/account/passport",
  "/account/billing",
  "/operator/blog",
  "/operator/conduct",
  "/operator/billing",
  "/operator/payouts",
  "/operator/accounts",
  "/operator/audit",
  "/operator/discovery",
  "/operator/outreach",
];

interface Result {
  readonly path: string;
  readonly status: number;
  readonly interactive: number;
  readonly problems: readonly string[];
}

async function visit(browser: Browser, base: string, cookie: string | undefined, path: string): Promise<Result> {
  const context = await browser.newContext();
  if (cookie !== undefined) {
    await context.addCookies([{ name: "lode_operator", value: cookie, url: base }]);
  }
  const page = await context.newPage();
  const problems: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    // An aborted request is usually a navigation superseding a prefetch, which
    // is normal and not a fault.
    if (!failure.includes("ERR_ABORTED")) {
      problems.push(`requestfailed: ${request.url().slice(0, 90)} ${failure}`);
    }
  });

  let status = 0;
  let interactive = -1;
  try {
    const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
    status = response?.status() ?? 0;
    // A moment for hydration to throw if it is going to.
    await page.waitForTimeout(400);
    interactive = await page.evaluate(() => document.querySelectorAll("a,button,input,select").length);
  } catch (error) {
    problems.push(`navigation: ${String(error).slice(0, 140)}`);
  }

  await context.close();
  return { path, status, interactive, problems };
}

async function main(): Promise<void> {
  const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
  const secret = process.env.OPERATOR_SECRET;
  const cookie = secret === undefined || secret === "" ? undefined : await operatorCookieValue(secret);

  if (cookie === undefined) {
    process.stdout.write(
      "OPERATOR_SECRET is not set, so the gated pages are skipped. Those are the pages\ncarrying personal data and the ones with the stricter policy — set it to test them.\n\n",
    );
  }

  // The pre-installed browser, rather than one downloaded on the fly. An
  // executablePath that does not exist fails with a message about running
  // `playwright install`, which is the wrong advice in a sandbox that blocks it.
  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(
    executablePath === undefined ? {} : { executablePath },
  );

  const paths = cookie === undefined ? PUBLIC : [...PUBLIC, ...GATED];
  const results: Result[] = [];
  for (const path of paths) results.push(await visit(browser, base, cookie, path));
  await browser.close();

  let failed = 0;
  for (const result of results) {
    const ok = result.status === 200 && result.problems.length === 0;
    if (!ok) failed += 1;
    process.stdout.write(
      `${ok ? "OK  " : "FAIL"} ${String(result.status).padEnd(3)} ${String(result.interactive).padStart(4)} controls  ${result.path}\n`,
    );
    for (const problem of result.problems.slice(0, 5)) {
      process.stdout.write(`       ${problem.slice(0, 170)}\n`);
    }
  }

  process.stdout.write(
    failed === 0
      ? `\n${results.length} pages: every one 200, hydrated, no console errors, no policy violations, no failed requests.\n`
      : `\n${failed} of ${results.length} pages have problems.\n`,
  );
  if (failed > 0) process.exit(1);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
