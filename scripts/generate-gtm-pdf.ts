/**
 * Renders docs/GO-TO-MARKET.md to a print-ready PDF.
 *
 * The markdown file stays the single source of truth — the PDF is generated
 * from it, never maintained alongside it, so the downloadable document and the
 * repository cannot drift apart the way a hand-exported deck always does.
 *
 * Rasterises with the Chromium that Playwright already provides, so this adds
 * no PDF or markdown dependency. The converter below handles exactly the
 * markdown this document uses (headings, tables, lists, quotes, rules, inline
 * emphasis, links) rather than pulling in a general parser for one file.
 *
 * The app itself is dark; a document that will be printed and emailed must not
 * be, so this stylesheet is deliberately light and does not share the app's
 * tokens beyond the accent.
 *
 * Usage: npm run docs:pdf
 */

import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE = path.join(process.cwd(), "docs", "GO-TO-MARKET.md");
const OUTPUT = path.join(process.cwd(), "docs", "GO-TO-MARKET.pdf");

const ACCENT = "#9c6f21";
const INK = "#16161a";
const MUTED = "#5c5c68";
const RULE = "#d9d9e0";

/* ------------------------------------------------------------------ inline */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Inline formatting.
 *
 * Code spans are extracted first and reinstated last so their contents cannot
 * be reinterpreted as emphasis — `**` inside a code span is literal.
 */
function inline(raw: string): string {
  const codes: string[] = [];
  let text = raw.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  text = escapeHtml(text);
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) => `<a href="${href}">${label}</a>`,
  );
  // Bold before italic: once `**` pairs are consumed, any remaining single
  // asterisk pair is unambiguously an emphasis.
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => {
    const code = codes[Number(index)];
    return `<code>${escapeHtml(code ?? "")}</code>`;
  });
}

/* ------------------------------------------------------------------- blocks */

function isTableDivider(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim()) && line.includes("-");
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Columns that hold figures are right-aligned so they compare down the page. */
function numericColumns(rows: string[][], columns: number): boolean[] {
  const figure = /^[*_\s]*[£+−-]?\d/;
  return Array.from({ length: columns }, (_, i) => {
    const values = rows.map((r) => r[i] ?? "").filter((v) => v.length > 0);
    return values.length > 0 && values.every((v) => figure.test(v));
  });
}

function renderTable(header: string[], body: string[][]): string {
  const right = numericColumns(body, header.length);
  const head = header
    .map((c, i) => `<th${right[i] === true ? ' class="num"' : ""}>${inline(c)}</th>`)
    .join("");
  const rows = body
    .map(
      (row) =>
        `<tr>${header
          .map(
            (_c, i) =>
              `<td${right[i] === true ? ' class="num"' : ""}>${inline(row[i] ?? "")}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Markdown → HTML for the subset this document uses.
 *
 * Line-oriented rather than character-oriented: every block type here is
 * identifiable from the start of a line, and continuation lines are joined by
 * indentation. That is enough for this file and stops well short of a parser.
 */
export function toHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      const level = (heading[1] ?? "#").length;
      out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      i += 1;
      continue;
    }

    // Table: a header row followed by a divider row.
    if (trimmed.startsWith("|") && isTableDivider(lines[i + 1] ?? "")) {
      const header = cells(trimmed);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        body.push(cells(lines[i] ?? ""));
        i += 1;
      }
      out.push(renderTable(header, body));
      continue;
    }

    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      let buffer: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        const content = (lines[i] ?? "").trim().replace(/^>\s?/, "");
        if (content.trim().length === 0) {
          if (buffer.length > 0) parts.push(buffer.join(" "));
          buffer = [];
        } else {
          buffer.push(content);
        }
        i += 1;
      }
      if (buffer.length > 0) parts.push(buffer.join(" "));
      out.push(
        `<blockquote>${parts.map((p) => `<p>${inline(p)}</p>`).join("")}</blockquote>`,
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const currentTrimmed = current.trim();
        const match = ordered
          ? /^\d+\.\s+(.*)$/.exec(currentTrimmed)
          : /^[-*]\s+(.*)$/.exec(currentTrimmed);
        if (match === null) break;
        const parts = [match[1] ?? ""];
        i += 1;
        // Continuation lines are indented under their item.
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i] ?? "") &&
          !/^\s*([-*]|\d+\.)\s/.test(lines[i] ?? "")
        ) {
          parts.push((lines[i] ?? "").trim());
          i += 1;
        }
        items.push(`<li>${inline(parts.join(" "))}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = (lines[i] ?? "").trim();
      if (
        current.length === 0 ||
        current.startsWith("#") ||
        current.startsWith(">") ||
        current.startsWith("|") ||
        /^---+$/.test(current) ||
        /^([-*]|\d+\.)\s/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      i += 1;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }

  return out.join("\n");
}

/* -------------------------------------------------------------------- page */

const STYLES = `
  @page { size: A4; margin: 20mm 18mm 22mm; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: ${INK};
    background: #ffffff;
    font-family: "Iowan Old Style", Palatino, Georgia, serif;
    font-size: 10.2pt;
    line-height: 1.55;
  }

  h1, h2, h3, h4 { font-weight: 600; line-height: 1.2; }

  /* Section numbers are the document's spine; give them a rule and a page. */
  h2 {
    font-size: 17pt;
    margin: 0 0 14pt;
    padding-bottom: 6pt;
    border-bottom: 1.5pt solid ${ACCENT};
    break-before: page;
    break-after: avoid;
  }
  h2:first-of-type { break-before: auto; }

  h3 {
    font-size: 12.5pt;
    margin: 16pt 0 6pt;
    color: ${ACCENT};
    break-after: avoid;
  }

  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; break-after: avoid; }

  p { margin: 0 0 8pt; orphans: 3; widows: 3; }

  strong { font-weight: 700; }

  a { color: ${ACCENT}; text-decoration: none; border-bottom: 0.5pt solid ${RULE}; }

  code {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 8.6pt;
    background: #f4f4f7;
    padding: 0.5pt 2.5pt;
    border-radius: 2pt;
  }

  /* Horizontal rules separate sections in the source; the h2 rule and page
     break already do that work in print, so they would only add noise. */
  hr { display: none; }

  ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin-bottom: 4pt; }

  blockquote {
    margin: 10pt 0;
    padding: 8pt 12pt;
    background: #faf7f0;
    border-left: 2.5pt solid ${ACCENT};
    break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 12pt;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 8.6pt;
    break-inside: avoid;
  }
  thead { display: table-header-group; }
  th {
    text-align: left;
    font-weight: 600;
    padding: 5pt 6pt;
    border-bottom: 1pt solid ${INK};
    background: #f7f7fa;
  }
  td { padding: 4.5pt 6pt; border-bottom: 0.5pt solid ${RULE}; vertical-align: top; }
  tr { break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* ------------------------------------------------------------- cover */

  .cover {
    height: 245mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    break-after: page;
  }
  .cover-mark { display: flex; align-items: center; gap: 8pt; }
  .cover-mark span {
    font-size: 11pt;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  .cover h1 {
    font-size: 46pt;
    letter-spacing: -0.015em;
    margin: 0 0 10pt;
  }
  .cover .lede { font-size: 13pt; color: ${MUTED}; margin: 0 0 20pt; max-width: 120mm; }
  .cover .rule { height: 2pt; background: ${ACCENT}; width: 60mm; margin-bottom: 20pt; }
  .locks {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10pt;
    border-top: 0.75pt solid ${RULE};
    padding-top: 12pt;
  }
  .lock-label {
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 7.5pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${MUTED};
    margin-bottom: 3pt;
  }
  .lock-value { font-size: 15pt; font-weight: 600; }
  .lock-note { font-size: 8.5pt; color: ${MUTED}; }
  .cover-foot {
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 8pt;
    color: ${MUTED};
    border-top: 0.75pt solid ${RULE};
    padding-top: 8pt;
  }
`;

const MARK = `<svg width="30" height="30" viewBox="0 0 26 26" fill="none">
  <path d="M13 2 3 8v10l10 6 10-6V8L13 2Z" stroke="${ACCENT}" stroke-width="1.3"/>
  <path d="M8 11.5 13 8.5l5 3v5.5l-5 3-5-3v-5.5Z" fill="${ACCENT}" fill-opacity="0.22"/>
  <path d="M13 8.5v9M8 11.5l10 5.5M18 11.5 8 17" stroke="${ACCENT}" stroke-width="0.9" stroke-opacity="0.75"/>
</svg>`;

function cover(issued: string): string {
  return `<section class="cover">
    <div>
      <div class="cover-mark">${MARK}<span>Lode &mdash; Property Deal OS</span></div>
    </div>
    <div>
      <div class="rule"></div>
      <h1>Go&#8209;to&#8209;market</h1>
      <p class="lede">Ninety days from an unproven marketplace to one completed
      property transaction, with the buy side recruited before a single seller
      is marketed to.</p>
      <div class="locks">
        <div>
          <div class="lock-label">Launch city</div>
          <div class="lock-value">Birmingham</div>
          <div class="lock-note">Locked until three completions</div>
        </div>
        <div>
          <div class="lock-label">90&#8209;day budget</div>
          <div class="lock-value">&pound;16,996</div>
          <div class="lock-note">Itemised, incl. 15% contingency</div>
        </div>
        <div>
          <div class="lock-label">First completion</div>
          <div class="lock-value">Day 76</div>
          <div class="lock-note">First revenue day 34</div>
        </div>
      </div>
    </div>
    <div class="cover-foot">
      Issued ${issued} &middot; Internal operating plan &middot; Figures are
      screening estimates and current UK list prices, not advice. Statutory fees
      marked &dagger; must be verified before commitment.
    </div>
  </section>`;
}

const FOOTER = `
  <div style="width:100%;padding:0 18mm;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
    font-size:7pt;color:${MUTED};display:flex;justify-content:space-between;">
    <span>Lode &mdash; Go-to-market</span>
    <span class="pageNumber"></span>
  </div>`;

/* --------------------------------------------------------------------- run */

/** The complete printable document: cover page followed by the plan. */
export function renderDocument(markdown: string, issued: string): string {
  // The title and the standfirst are rendered on the cover, so drop them from
  // the body rather than printing them twice.
  const body = markdown.replace(/^#\s+.*$/m, "").replace(/^\*\*Ship date target:.*$/m, "");

  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8" />
    <title>GO-TO-MARKET — Lode</title><style>${STYLES}</style></head>
    <body>${cover(issued)}${toHtml(body)}</body></html>`;
}

async function main(): Promise<void> {
  const markdown = await readFile(SOURCE, "utf8");

  // Stamped on the cover so a printed copy can be placed against the plan's
  // day numbers.
  const issued = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const html = renderDocument(markdown, issued);

  // The pinned Chromium this environment provides; matches the PWA asset
  // generator so both scripts run without a browser download.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOTER,
      margin: { top: "18mm", bottom: "16mm", left: "18mm", right: "18mm" },
    });
    await writeFile(OUTPUT, pdf);
    process.stdout.write(`GO-TO-MARKET.pdf written (${Math.round(pdf.length / 1024)} kB)\n`);
  } finally {
    await browser.close();
  }
}

// Only when run as a script: the converter is imported by the tests, and
// importing must not launch a browser.
if (process.argv[1]?.endsWith("generate-gtm-pdf.ts") === true) {
  main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
