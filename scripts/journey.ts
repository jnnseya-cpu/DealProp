import { chromium, type Page } from "playwright";

/**
 * The seller journey, driven end to end in a real browser.
 *
 * The most important flow on the platform and the one with the least margin
 * for error: somebody types a bereavement or a repossession into a form and
 * gets back what their options are worth. `npm run smoke` proves every page
 * loads; this proves the one journey that matters actually completes.
 *
 * It exists because an ad-hoc version of it found something no test had: the
 * intake wrote the seller's situation into `inventory.confirmation.evidence`,
 * a field the store did not encrypt, so the one term the rest of the record
 * goes to trouble to seal sat in plaintext two objects away from its own
 * ciphertext. Nothing short of submitting the form and reading the file would
 * have caught that, which is the argument for keeping this rather than
 * trusting the unit tests.
 *
 * Run against a throwaway store. It creates a real deal.
 *
 *   LODE_DATA_FILE=/tmp/journey.json npm run build && npm start &
 *   npm run journey -- http://localhost:3000 /tmp/journey.json
 */

const PHONE = { width: 393, height: 852 };

async function continueOn(page: Page, label: string): Promise<void> {
  await page.locator("button", { hasText: "Continue" }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  process.stdout.write(`  past ${label}\n`);
}

async function main(): Promise<void> {
  const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
  const storeFile = process.argv[3];

  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
  // A phone, because that is what a seller in the middle of a probate uses.
  const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });

  await page.goto(`${base}/sell`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Clicked as a person would, not set in the DOM. React's onChange is what
  // decides whether Continue enables, and assigning `.checked` does not fire it.
  await page.getByText("Probate", { exact: false }).first().click();
  await continueOn(page, "situation");

  await page
    .getByText("Speed", { exact: false })
    .first()
    .click()
    .catch(async () => {
      await page.locator("input[type=checkbox]").first().click({ force: true });
    });
  await continueOn(page, "priorities");

  await page.fill('[name="postcodeArea"]', "B23");
  await page.fill('[name="locality"]', "Erdington");
  await page.fill('[name="bedrooms"]', "3").catch(() => undefined);
  await page.locator('input[name="condition"]').first().click({ force: true }).catch(() => undefined);
  await continueOn(page, "property");

  await page.fill('[name="sellerValuation"]', "212000");
  await continueOn(page, "value");

  // The screening step. These answers are what Seller Protection reads.
  for (const radio of await page.locator("input[type=radio]:visible").all()) {
    await radio.click({ force: true }).catch(() => undefined);
  }

  await page.locator("button[type=submit]").click({ timeout: 15_000 });
  await page.waitForURL(/\/sell\/[a-z0-9-]{6,}/i, { timeout: 40_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const url = page.url();
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  await browser.close();

  process.stdout.write(`\nResult page: ${url}\n`);

  // The capability URL must be unguessable. A seller's own page carries their
  // situation and nobody signs in to reach it.
  const token = url.split("/sell/")[1] ?? "";
  if (token.length < 24) problems.push(`capability token is only ${token.length} characters`);

  // Either a costed set of routes, or a protection pause. Both are correct
  // outcomes; a page showing neither means the engine produced nothing.
  const paused = text.includes("a person will review it");
  const routed = /£[\d,]+/.test(text);
  if (!paused && !routed) problems.push("the result page shows neither routes nor a protection pause");
  process.stdout.write(paused ? "Seller Protection paused it and withheld the figures.\n" : "Routes returned.\n");

  if (storeFile !== undefined) {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(storeFile, "utf8").toLowerCase();
    // The locality is deliberately not encrypted: a commercial fact the engine
    // filters on, and not a person. Everything below it is.
    const leaked = [
      "probate",
      "repossession",
      "divorce",
      "hasindependentlegaladvice",
      "ageband",
      "under-65",
    ].filter((term) => raw.includes(term));
    if (leaked.length > 0) problems.push(`plaintext in the store: ${leaked.join(", ")}`);
    else process.stdout.write("Nothing personal in plaintext in the store.\n");
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stdout.write(`  FAIL ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write("\nSeller journey complete.\n");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
