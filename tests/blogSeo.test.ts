import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "@backend/blog/corpus";
import { auditAgainstFloor, seoReport, SCORE_FLOOR } from "@shared/domain/seo";
import {
  externalCitations,
  internalLinks,
  llmsTxt,
  postMarkdown,
  articleJsonLd,
  definedTermSetJsonLd,
  jsonLdScript,
  GLOSSARY,
  termsMentioned,
  type BlogPost,
} from "@shared/domain/blog";
import { CITATIONS, legislationUrl, resolveCitation } from "@shared/domain/citations";
import { plainText } from "@shared/domain/blog";
import { publicProtectionSummary } from "@shared/domain/protection";

const BASE = "https://example.com";

/**
 * The blog, audited as a whole rather than as a feature.
 *
 * The corpus scored 78 at its best and 16 at its worst while a dashboard
 * cheerfully displayed both, because a number on a screen is not a control.
 * This is the control: every published post clears the floor, and a post that
 * does not is a failing build rather than a row somebody might notice.
 */
describe("the published corpus", () => {
  it("clears the score floor on every post", async () => {
    const audit = auditAgainstFloor(await loadCorpus());
    expect(audit.clears, audit.summary).toBe(true);
    expect(audit.reports.length).toBeGreaterThan(5);
  });

  it("names what is wrong when a post fails, rather than only that it did", async () => {
    // A floor nothing can clear, to prove the reporting works. A gate whose
    // failure message is a number tells whoever broke it nothing.
    const audit = auditAgainstFloor(await loadCorpus(), 101);
    expect(audit.clears).toBe(false);
    expect(audit.failing.length).toBe(audit.reports.length);
    expect(audit.summary).toContain("below the floor");
    for (const report of audit.failing) expect(audit.summary).toContain(report.slug);
  });

  it("answers its own title on every post, in the length something will quote", async () => {
    for (const post of await loadCorpus()) {
      const words = post.answer.trim().split(/\s+/).length;
      expect(words, `${post.slug}: ${words} words`).toBeGreaterThanOrEqual(25);
      expect(words, `${post.slug}: ${words} words`).toBeLessThanOrEqual(75);
      expect(post.answer.trim().endsWith("."), post.slug).toBe(true);
    }
  });

  it("cites primary sources on every post", async () => {
    for (const post of await loadCorpus()) {
      const sources = externalCitations(post);
      expect(sources.length, post.slug).toBeGreaterThanOrEqual(2);
      // Resolution is the check that matters: a key with no citation behind it
      // throws, so a post cannot cite something that does not exist.
      for (const source of sources) expect(source.url).toMatch(/^https:\/\//);
    }
  });

  it("carries enough computed links to be worth crawling", async () => {
    const corpus = await loadCorpus();
    for (const post of corpus) {
      const links = internalLinks(post, corpus);
      expect(links.length, post.slug).toBeGreaterThanOrEqual(10);
      // Every one derived, so a renamed slug cannot leave a dead link.
      for (const link of links) expect(link.href.startsWith("/"), link.href).toBe(true);
    }
  });

  it("leaves no post orphaned", async () => {
    const corpus = await loadCorpus();
    for (const post of corpus) {
      expect(termsMentioned(post).length, post.slug).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("citations", () => {
  it("derives every legislation URL rather than storing one", () => {
    for (const entry of CITATIONS) {
      const resolved = resolveCitation(entry.key);
      expect(resolved.url).toMatch(/^https:\/\//);
      if (entry.legislation !== undefined) {
        expect(resolved.direct).toBe(true);
        expect(resolved.url).toBe(legislationUrl(entry.legislation));
      } else {
        // A guidance reference points at the publisher's root, which is a
        // domain. A path here would be a typed deep link, which is the one
        // thing this registry exists to refuse.
        expect(resolved.direct).toBe(false);
        expect(new URL(resolved.url).pathname).toBe("/");
      }
    }
  });

  it("addresses legislation the way legislation.gov.uk does", () => {
    expect(
      legislationUrl({ kind: "ukpga", year: 2000, number: 8, title: "FSMA", section: "21" }),
    ).toBe("https://www.legislation.gov.uk/ukpga/2000/8/section/21");
    // An instrument has regulations, not sections.
    expect(
      legislationUrl({ kind: "uksi", year: 2003, number: 2426, title: "PECR", section: "22" }),
    ).toBe("https://www.legislation.gov.uk/uksi/2003/2426/regulation/22");
    // A devolved Act is an Act.
    expect(
      legislationUrl({ kind: "asp", year: 2013, number: 11, title: "LBTT", section: "1" }),
    ).toBe("https://www.legislation.gov.uk/asp/2013/11/section/1");
  });

  it("gives every citation a unique key and a sentence saying what it establishes", () => {
    const keys = CITATIONS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of CITATIONS) {
      expect(entry.establishes.length, entry.key).toBeGreaterThan(30);
      expect(entry.establishes.trim().endsWith("."), entry.key).toBe(true);
    }
  });
});

describe("what a machine reads", () => {
  it("mirrors every post as markdown with absolute links", async () => {
    const corpus = await loadCorpus();
    for (const post of corpus) {
      const md = postMarkdown(post, corpus, BASE);
      expect(md.startsWith(`# ${post.title}`), post.slug).toBe(true);
      expect(md).toContain(post.answer);
      // Absolute, because a consumer that pulled this out of its context has
      // nothing to resolve a relative href against.
      expect(md).not.toMatch(/\]\(\/(?!\/)/);
      for (const term of termsMentioned(post)) {
        expect(md).toContain(`${BASE}/glossary/${term.slug}`);
      }
    }
  });

  it("indexes the whole site in llms.txt, from the corpus", async () => {
    const corpus = await loadCorpus();
    const text = llmsTxt(corpus, BASE, "Lode", "A property deal engine.");
    for (const post of corpus) expect(text).toContain(`${BASE}/blog/${post.slug}/index.md`);
    for (const term of GLOSSARY) expect(text).toContain(`${BASE}/glossary/${term.slug}`);
  });

  it("points every article at the same term entities the glossary publishes", async () => {
    const corpus = await loadCorpus();
    const set = definedTermSetJsonLd(BASE, "Glossary");
    const published = new Set(
      (set.hasDefinedTerm as { "@id": string }[]).map((term) => term["@id"]),
    );

    for (const post of corpus) {
      const article = articleJsonLd(post, BASE, "Lode", corpus);
      const mentions = (article.mentions ?? []) as { "@id": string }[];
      expect(mentions.length, post.slug).toBeGreaterThan(0);
      // The join. An Article that mentions a term by a different id is an
      // Article a consumer cannot connect to the definition, which is the
      // whole reason for publishing definitions.
      for (const mention of mentions) expect(published.has(mention["@id"]), mention["@id"]).toBe(true);
      expect(article.abstract).toBe(post.answer);
    }
  });

  it("keeps the score floor a constant rather than a number in a test", () => {
    expect(SCORE_FLOOR).toBeGreaterThanOrEqual(90);
  });

  it("scores a post the same way whichever entry point asks", async () => {
    const corpus = await loadCorpus();
    const first = corpus[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const audit = auditAgainstFloor(corpus);
    const direct = seoReport(first, corpus);
    const fromAudit = audit.reports.find((r) => r.slug === first.slug);
    expect(fromAudit?.score).toBe(direct.score);
  });
});

/**
 * §20: never publish a seller's personal circumstances.
 *
 * The agent published every Seller Protection flag verbatim, on a public page,
 * under a locality heading — including "possible capacity concern reported",
 * which is health data. Nothing failed. The prohibitions register named
 * `opportunityCard()` and `checkNeutralEnquiry()` as the controls and the blog
 * was not on the list, so the one surface that was leaking was the one nobody
 * had checked.
 */
describe("what a deal post may say about a seller", () => {
  /**
   * Phrases from the seller-subject flags, as a reader would meet them.
   *
   * Taken from the labels and details in `protection.ts` rather than invented,
   * so a new flag with a new phrasing is caught by the subject test below
   * rather than by whether somebody remembered to add it here.
   */
  const CIRCUMSTANCES = [
    "capacity concern",
    "elderly seller",
    "aged 80",
    "third-party pressure",
    "financial abuse",
    "coercion",
    "financial distress",
    "sole decision maker",
    "vulnerability",
    "vulnerable",
  ];

  it("publishes none of it, anywhere in the post", async () => {
    for (const post of await loadCorpus()) {
      const text =
        `${post.title} ${post.description} ${post.answer} ${plainText(post)}`.toLowerCase();
      for (const phrase of CIRCUMSTANCES) {
        expect(text.includes(phrase), `${post.slug} publishes "${phrase}"`).toBe(false);
      }
    }
  });

  it("says a block happened, and counts what it will not say", () => {
    const outcome = publicProtectionSummary({
      flags: [
        {
          key: "extreme-discount",
          severity: "block",
          subject: "transaction",
          label: "Discount exceeds review threshold",
          detail: "d",
          remedy: "r",
        },
        {
          key: "capacity-concern",
          severity: "block",
          subject: "seller",
          label: "Possible capacity concern reported",
          detail: "d",
          remedy: "r",
        },
      ],
      blocked: true,
      requiresHumanReview: true,
      requiredDisclosures: [],
    });

    expect(outcome.publishable).toHaveLength(1);
    expect(outcome.publishable[0]?.subject).toBe("transaction");
    expect(outcome.withheld).toBe(1);
    // A count, not a silence. "Nothing to see here" about a safeguard that did
    // fire is a different and worse statement than "one thing, withheld".
    expect(outcome.summary).toContain("1 further safeguard");
    expect(outcome.summary.toLowerCase()).not.toContain("capacity");
  });

  it("gives every flag a subject, so a new one cannot default to publishable", () => {
    // The type makes this a compile error rather than a runtime one; this
    // pins the classification itself, which the type cannot.
    for (const flag of CIRCUMSTANCES) void flag;
    const seller = ["situation-vulnerability", "capacity-concern", "age-and-discount", "third-party-pressure", "multiple-owners", "distress-and-discount"];
    const source = readFileSync(
      path.join(process.cwd(), "src/shared/domain/protection.ts"),
      "utf8",
    );
    for (const key of seller) {
      const at = source.indexOf(`key: "${key}"`);
      expect(at, key).toBeGreaterThan(-1);
      expect(source.slice(at, at + 200), key).toContain('subject: "seller"');
    }
  });
});

/**
 * The `</script>` breakout, closed at the serialiser rather than at the page.
 *
 * `JSON.stringify` escapes quotes and backslashes and does not escape `<`. An
 * HTML parser inside a script element stops at the first `</script` it meets
 * whatever the JSON context, so one string containing that sequence closes the
 * element and everything after it is parsed as markup. The path is real: the
 * agent builds a post's title, description and answer from the deal record, so
 * it runs from the enquiry form, through the store, into a script element on a
 * public page.
 */
describe("structured data in a script element", () => {
  it("escapes the sequence that would close the element", () => {
    const hostile = "</script><img src=x onerror=alert(1)>";
    const out = jsonLdScript({ "@type": "Article", headline: hostile });

    expect(out).not.toContain("</script");
    expect(out).not.toContain("<img");
    expect(out).toContain("\\u003c");
    // And it is still JSON that parses back to exactly what went in, because a
    // citation that arrives mangled is a different bug.
    expect((JSON.parse(out) as { headline: string }).headline).toBe(hostile);
  });

  it("escapes the separators that are legal JSON and illegal JavaScript", () => {
    const out = jsonLdScript({ text: "a b c" });
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
    expect((JSON.parse(out) as { text: string }).text).toBe("a b c");
  });

  it("leaves ordinary content alone", () => {
    const out = jsonLdScript({ headline: "Deal Score 61: a 3-bed in Erdington" });
    expect(out).toBe('{"headline":"Deal Score 61: a 3-bed in Erdington"}');
  });

  it("is what every page actually uses", async () => {
    // A serialiser nothing calls is not a control. These are the five files
    // that put a script element on a page.
    const pages = [
      "src/app/layout.tsx",
      "src/app/blog/[slug]/page.tsx",
      "src/app/blog/topic/[topic]/page.tsx",
      "src/app/glossary/page.tsx",
      "src/app/glossary/[slug]/page.tsx",
    ];
    for (const page of pages) {
      const source = readFileSync(path.join(process.cwd(), page), "utf8");
      expect(source, page).not.toMatch(/__html:\s*JSON\.stringify/);
      if (source.includes("__html")) expect(source, page).toContain("jsonLdScript");
    }
  });
});
