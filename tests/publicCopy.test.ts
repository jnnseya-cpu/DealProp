import { readFileSync } from "node:fs";
import path from "node:path";
import { glob } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  INDUCEMENT_FIGURES,
  checkValuationLanguage,
  mayPublishReturns,
} from "@shared/domain/prohibitions";
import { REFUND_REASONS, REVEAL_GUARANTEE } from "@shared/domain/reveal";
import { GRADES } from "@shared/domain/passport";
import { MATERIAL_ITEMS } from "@shared/domain/materialInformation";
import { SELLER_KINDS } from "@shared/domain/sellerDueDiligence";
import { PLANS } from "@shared/domain/pricing";
import { BUYER_TIERS } from "@shared/domain/revenue";
import { supplyPosition } from "@shared/domain/supply";
import { sellerFeeStatement } from "@shared/domain/fees";

/**
 * The prohibitions, applied to the copy rather than to the engine.
 *
 * `checkValuationLanguage()` was written, tested against invented strings and
 * then applied to nothing — the register claimed it enforced the
 * guaranteed-valuation rule and no page was ever passed through it. That is the
 * failure mode CLAUDE.md rule 30 names: a control that nothing calls is not a
 * control. This file is the call site, and the thing being checked is the
 * marketing copy itself, which is where the sentence would actually be written.
 *
 * The second half is FSMA s.21. A price, a cost and a discount describe the
 * property. A margin and a return on cash describe what an investor would make
 * from it, and communicating that is a financial promotion. `supply.ts` already
 * refuses to put one in the public supply statement; the worked example a
 * screen further down the same landing page published "Return on cash 41%" to
 * anybody who loaded it.
 */

const APP = path.join(process.cwd(), "src", "app");

/**
 * Routes behind the middleware matcher in `src/middleware.ts`, plus the
 * operator surfaces behind `requireOperator()`. Nothing here is public copy:
 * a signed-in operator reading a margin is not a financial promotion, and the
 * figures are the point of those pages.
 */
const GATED = ["deals", "invest", "capital", "account", "portfolio", "opportunities", "operator", "api"];

async function publicSources(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(`${APP}/**/*.tsx`)) {
    const relative = path.relative(APP, entry).split(path.sep).join("/");
    const top = relative.split("/")[0];
    if (top !== undefined && GATED.includes(top)) continue;
    out.push(entry);
  }
  return out;
}

/**
 * Source with comments stripped. The rules below are about what a page *says*,
 * not what it discusses — the comment above the gate in `page.tsx` quotes the
 * very figure the gate withholds, and must not be read as publishing it.
 */
function copy(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("public copy", () => {
  it("scans a real set of pages", async () => {
    const files = await publicSources();
    // A glob that silently matched nothing would pass every test below it.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith(`app${path.sep}page.tsx`))).toBe(true);
  });

  it("never describes a figure as certain", async () => {
    for (const file of await publicSources()) {
      const check = checkValuationLanguage(copy(file));
      expect(
        check.clean,
        `${path.relative(process.cwd(), file)}: ${check.findings.join(" ")}`,
      ).toBe(true);
    }
  });

  it("states its regulatory position from the catalogue, never in prose", async () => {
    // The supply statement used to assert, in typed copy, that a public return
    // figure would be a financial promotion — on a page that published one four
    // sections down. The sentence now comes from `mayPublishReturns()`, which
    // reads the same permission catalogue as the revenue model and the charge
    // gate, so the page cannot claim a position the platform does not hold.
    for (const file of await publicSources()) {
      const relative = path.relative(APP, file).split(path.sep).join("/");
      for (const claim of ["FSMA", "s.21", "financial promotion"]) {
        expect(
          copy(file).includes(claim),
          `src/app/${relative} states a regulatory position in prose ("${claim}"). ` +
            "That sentence belongs to mayPublishReturns(), which reads whether the " +
            "permission is actually recorded.",
        ).toBe(false);
      }
    }
  });

  it("never states what a seller pays in prose", async () => {
    // The footer said "we do not charge sellers" on every page while the seller
    // journey quoted a percentage of the price achieved. Both were typed. The
    // sentence now comes from `sellerFeeStatement()`, which asks whether the
    // fee could actually be raised.
    const typed = [
      /\bwe do not charge sellers\b/i,
      /\bwe are not an estate agent\b/i,
      /\bsellerFeeHeadline\(/,
    ];
    for (const file of await publicSources()) {
      const relative = path.relative(APP, file).split(path.sep).join("/");
      const source = copy(file);
      for (const pattern of typed) {
        expect(
          pattern.test(source),
          `src/app/${relative} states the seller's position itself (${pattern}). ` +
            "That sentence belongs to sellerFeeStatement(), which knows whether the " +
            "permissions behind the fee are recorded.",
        ).toBe(false);
      }
    }
  });

  it("keeps every return figure out of the supply statement", () => {
    // The structural half. A worked example labelled as one publishes its own
    // arithmetic; what may never be said is how many opportunities are
    // available at what return, and the only way to be sure of that is for the
    // shape a page reads to have nowhere to put one.
    const position = supplyPosition(
      [
        {
          createdAt: "2026-01-04T00:00:00.000Z",
          status: "in-market",
          postcodeArea: "B23",
          locality: "Erdington",
          jurisdiction: "GB-ENG",
          blocked: false,
        },
        {
          createdAt: "2026-02-11T00:00:00.000Z",
          status: "completed",
          postcodeArea: "B29",
          locality: "Selly Oak",
          jurisdiction: "GB-ENG",
          blocked: true,
        },
      ],
      { buy: 3, funding: 2 },
      new Date("2026-03-01T00:00:00.000Z"),
    );
    const published = JSON.stringify(position).toLowerCase();
    for (const figure of INDUCEMENT_FIGURES) {
      expect(published.includes(figure), `supply statement mentions "${figure}"`).toBe(false);
    }
    expect(published).not.toMatch(/%|\breturn\b|\bmargin\b|\byield\b|\bprofit\b/);
  });
});

describe("mayPublishReturns", () => {
  it("refuses without the permission", () => {
    const decision = mayPublishReturns([]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("s.21");
  });

  it("refuses when other permissions are held", () => {
    expect(mayPublishReturns(["estate-agency-aml", "credit-broking"]).allowed).toBe(false);
  });

  it("allows only the authorised person", () => {
    expect(mayPublishReturns(["financial-promotion-approver"]).allowed).toBe(true);
  });

  it("states a reason that is itself publishable copy", () => {
    // The refusal is printed on the page in place of the figures, so it goes
    // through the same check as everything else the page says.
    for (const held of [[], ["financial-promotion-approver"] as const]) {
      const decision = mayPublishReturns([...held]);
      expect(checkValuationLanguage(decision.reason).clean).toBe(true);
      expect(decision.reason.length).toBeGreaterThan(20);
    }
  });

  it("names the figures it is withholding", () => {
    expect(INDUCEMENT_FIGURES).toContain("return on cash");
    expect(INDUCEMENT_FIGURES.every((f) => f === f.toLowerCase())).toBe(true);
  });
});

/**
 * Copy that lives in the domain rather than in a page.
 *
 * The scan above reads `src/app`, and every sentence in these lists is
 * rendered verbatim on a public page while living nowhere near one. The
 * guarantee is the sharp case: it is deliberately a single source so that
 * what is published and what is applied cannot differ, which also means a
 * careless edit to it is a careless edit to the marketing.
 */
describe("published domain copy", () => {
  const published: readonly { readonly where: string; readonly text: string }[] = [
    ...REVEAL_GUARANTEE.map((text, i) => ({ where: `REVEAL_GUARANTEE[${i}]`, text })),
    ...REFUND_REASONS.flatMap((r) => [
      { where: `REFUND_REASONS ${r.trigger} label`, text: r.label },
      { where: `REFUND_REASONS ${r.trigger} explanation`, text: r.explanation },
    ]),
    ...GRADES.flatMap((g) => [
      { where: `GRADES ${g.grade} label`, text: g.label },
      { where: `GRADES ${g.grade} meaning`, text: g.meaning },
    ]),
    ...MATERIAL_ITEMS.flatMap((i) => [
      { where: `MATERIAL_ITEMS ${i.key} label`, text: i.label },
      { where: `MATERIAL_ITEMS ${i.key} why`, text: i.why },
    ]),
    ...SELLER_KINDS.flatMap((k) => [
      { where: `SELLER_KINDS ${k.kind} label`, text: k.label },
      { where: `SELLER_KINDS ${k.kind} authorityEvidence`, text: k.authorityEvidence },
    ]),
    ...PLANS.flatMap((p) => [
      { where: `PLANS ${p.id} name`, text: p.name },
      { where: `PLANS ${p.id} summary`, text: p.summary },
    ]),
    ...BUYER_TIERS.flatMap((t) => [
      { where: `BUYER_TIERS ${t.name} summary`, text: t.summary },
      ...t.features.map((f, i) => ({ where: `BUYER_TIERS ${t.name} feature ${i}`, text: f })),
    ]),
  ];

  it("has something to check", () => {
    expect(published.length).toBeGreaterThan(50);
  });

  it("never describes a figure as certain", () => {
    for (const { where, text } of published) {
      const check = checkValuationLanguage(text);
      expect(check.clean, `${where}: ${check.findings.join(" ")}`).toBe(true);
    }
  });
});

describe("sellerFeeStatement", () => {
  const FULL = ["estate-agency-aml", "redress-scheme"] as const;

  it("quotes the fee only when it could actually be raised", () => {
    const statement = sellerFeeStatement([...FULL]);
    expect(statement.chargeable).toBe(true);
    expect(statement.statement).toMatch(/on completion/);
    expect(statement.statement).toMatch(/nothing at all if the property does not sell/);
  });

  it("refuses on a partial permission set, not only an empty one", () => {
    // The failure that matters: AML supervision recorded, redress membership
    // not. Half the requirement reads like the requirement to anybody skimming.
    for (const held of [[], ["estate-agency-aml"], ["redress-scheme"]] as const) {
      const statement = sellerFeeStatement([...held]);
      expect(statement.chargeable, `held: ${held.join(", ") || "none"}`).toBe(false);
      expect(statement.statement).toMatch(/nothing for a seller to pay/);
      // And it must not quote a rate it cannot charge.
      expect(statement.statement).not.toMatch(/%/);
    }
  });

  it("says something publishable either way", () => {
    for (const held of [[], [...FULL]]) {
      const { statement } = sellerFeeStatement(held);
      expect(checkValuationLanguage(statement).clean).toBe(true);
      expect(statement.trim().endsWith(".")).toBe(true);
    }
  });
});

/**
 * The statutory footer, on every public page.
 *
 * It was on two of them. The Companies Act 2006 s.82 disclosure and the "these
 * are engine estimates, not advice" line lived on the landing page and the
 * partners page, and were absent from `/sell` — the page where somebody types
 * a bereavement into a form and has no way to find out who they are giving it
 * to. `checkIdentity()` in the preflight was passing throughout, because it
 * checks that the identity is *recorded*, not that any page prints it.
 */
describe("statutory footer", () => {
  /**
   * The offline page is the one deliberate exception. It is cached by the
   * service worker and served with no network, so its footer would be a
   * snapshot of whatever was true when it was cached — and a stale statutory
   * disclosure is worse than an obviously minimal page. It carries no
   * marketing copy and makes no claim about the company.
   */
  const WITHOUT_FOOTER: readonly string[] = ["offline/page.tsx"];

  async function publicPages(): Promise<string[]> {
    return (await publicSources()).filter((f) => path.basename(f) === "page.tsx");
  }

  it("is rendered by every public page", async () => {
    const pages = await publicPages();
    expect(pages.length).toBeGreaterThan(8);
    for (const file of pages) {
      const relative = path.relative(APP, file).split(path.sep).join("/");
      if (WITHOUT_FOOTER.includes(relative)) continue;
      expect(
        copy(file).includes("<SiteFooter"),
        `src/app/${relative} renders no SiteFooter. The Companies Act 2006 s.82 ` +
          "disclosure is required on the website, and a visitor deciding whether to " +
          "tell us about a bereavement looks for it first.",
      ).toBe(true);
    }
  });

  it("is never baked into a page that never regenerates", async () => {
    // The footer reads the company identity from the environment at render
    // time, and the Dockerfile passes only NEXT_PUBLIC_* at build. A page
    // prerendered once, with no revalidate and no dynamic segment, would serve
    // "identity has not been configured" for the life of the deployment.
    for (const file of await publicPages()) {
      const relative = path.relative(APP, file).split(path.sep).join("/");
      const source = copy(file);
      if (!source.includes("<SiteFooter")) continue;
      // A dynamic route segment is never prerendered without generateStaticParams,
      // and a page that reads searchParams is request-scoped by construction.
      const dynamicSegment = relative.includes("[") && !source.includes("generateStaticParams");
      const readsRequest = source.includes("searchParams");
      const declared =
        source.includes("export const revalidate") || source.includes("export const dynamic");
      expect(
        declared || dynamicSegment || readsRequest,
        `src/app/${relative} renders the statutory footer but declares neither ` +
          "`revalidate` nor `dynamic`, so the disclosure is frozen at build time " +
          "with no company identity in the environment to read.",
      ).toBe(true);
    }
  });
});
