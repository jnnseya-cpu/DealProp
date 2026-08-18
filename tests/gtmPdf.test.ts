import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocument, toHtml } from "../scripts/generate-gtm-pdf";

const SOURCE = readFileSync(path.join(process.cwd(), "docs", "GO-TO-MARKET.md"), "utf8");

describe("markdown conversion", () => {
  it("renders a table with a header row and right-aligned figures", () => {
    const html = toHtml("| Item | Cost |\n|---|---|\n| Redress scheme | £249 |");
    expect(html).toContain("<th>Item</th>");
    expect(html).toContain('<th class="num">Cost</th>');
    expect(html).toContain('<td class="num">£249</td>');
  });

  it("leaves prose columns left-aligned", () => {
    const html = toHtml("| Item | Owner |\n|---|---|\n| Legal | Founder |");
    expect(html).toContain("<td>Founder</td>");
  });

  it("joins continuation lines into one list item", () => {
    const html = toHtml("1. **Freehold houses only.** The flat goes\n   negative after tax.");
    expect(html).toContain(
      "<li><strong>Freehold houses only.</strong> The flat goes negative after tax.</li>",
    );
  });

  it("keeps emphasis inside a code span literal", () => {
    // `**` inside backticks is a function signature, not bold.
    expect(toHtml("Call `a**b` now")).toContain("<code>a**b</code>");
  });

  it("does not substitute code back into ordinary prose", () => {
    // The placeholder must not collide with a bare number in the text — an
    // earlier version turned "8 hrs @ £275" into a code span.
    const html = toHtml("Solicitor, 8 hrs @ £275, and `dealRevenue()` runs after.");
    expect(html).toContain("Solicitor, 8 hrs @ £275");
    expect(html).toContain("<code>dealRevenue()</code>");
  });

  it("escapes markup in the source rather than emitting it", () => {
    expect(toHtml("A <script>alert(1)</script> line")).toContain("&lt;script&gt;");
  });

  it("renders links, quotes and headings", () => {
    expect(toHtml("[site](https://example.com)")).toContain('<a href="https://example.com">site</a>');
    expect(toHtml("> B6, B8")).toBe("<blockquote><p>B6, B8</p></blockquote>");
    expect(toHtml("### 3.1 Why Birmingham")).toBe("<h3>3.1 Why Birmingham</h3>");
  });
});

describe("the go-to-market document", () => {
  const html = renderDocument(SOURCE, "18 August 2026");

  it("puts the locked launch city and budget on the cover", () => {
    // These are the two decisions the document exists to fix. If either drifts
    // out of the cover the reader has to hunt for them.
    expect(html).toContain("Birmingham");
    expect(html).toContain("&pound;16,996");
  });

  it("does not print the title twice", () => {
    expect(html).not.toContain("<h1>Go to market — Lode</h1>");
  });

  it("converts every source table", () => {
    const sourceTables = SOURCE.split("\n").filter((l) => /^\|[\s:|-]+\|$/.test(l.trim())).length;
    expect(html.split("<table>").length - 1).toBe(sourceTables);
  });

  it("leaves no unconverted markdown emphasis in the output", () => {
    expect(html).not.toMatch(/\*\*/);
  });
});
