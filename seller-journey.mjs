import { chromium } from "playwright";
const BASE = "http://localhost:3114";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/sell`, { waitUntil: "networkidle" });

// Fill whatever the form actually asks for, rather than what I assume it asks for.
const fields = await page.evaluate(() =>
  [...document.querySelectorAll("input,select,textarea")].map((el) => ({
    name: el.getAttribute("name"), type: el.getAttribute("type") || el.tagName.toLowerCase(),
    required: el.hasAttribute("required"),
    options: el.tagName === "SELECT" ? [...el.querySelectorAll("option")].map((o) => o.value) : undefined,
  })));
console.log("FORM FIELDS:");
for (const f of fields) console.log(`  ${f.required ? "*" : " "} ${f.name} (${f.type})${f.options ? " [" + f.options.slice(0,4).join("|") + "]" : ""}`);

for (const f of fields) {
  if (!f.name) continue;
  const sel = `[name="${f.name}"]`;
  try {
    if (f.type === "select") { const v = (f.options || []).filter(Boolean)[0]; if (v) await page.selectOption(sel, v); }
    else if (f.type === "checkbox") await page.check(sel).catch(() => {});
    else if (f.type === "number") await page.fill(sel, "180000");
    else if (f.type === "textarea") await page.fill(sel, "Testing the journey end to end.");
    else await page.fill(sel, f.name.toLowerCase().includes("mail") ? "test@example.com" : "180000");
  } catch { /* a field the form does not want filled */ }
}

const before = page.url();
await page.click('button[type="submit"], button:has-text("See")').catch(() => {});
await page.waitForTimeout(2500);
console.log(`\nSUBMITTED  ${before}  ->  ${page.url()}`);

const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 700));
console.log("\nRESULT PAGE:\n" + body);
console.log("\nconsole errors:", errors.length ? errors.slice(0,3) : "none");
await browser.close();
