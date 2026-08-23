import { describe, expect, it } from "vitest";
import type { BlogPost } from "@shared/domain/blog";
import { auditCorpus, seoReport } from "@shared/domain/seo";

function post(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    slug: "a-post",
    title: "A post",
    description: "About something.",
    topic: "deal-analysis",
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    body: [{ kind: "paragraph", text: "Plain text with no jargon in it at all." }],
    attributions: [],
    fromLiveDeal: false,
    ...overrides,
  };
}

const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");

/** A post that should pass everything, used to prove a failure is the one under test. */
function healthy(overrides: Partial<BlogPost> = {}): BlogPost {
  return post({
    slug: "true-discount-versus-asking-price",
    title: "True discount versus asking price on a below-market deal",
    description:
      "What a true discount actually measures once costs and tax are taken off, and why the headline percentage off asking price is almost never the number that matters.",
    body: [
      { kind: "heading", text: "What the true discount measures" },
      { kind: "paragraph", text: `The true discount and the GDV and bridging finance. ${words(500)}` },
      { kind: "heading", text: "Why asking price misleads" },
      { kind: "paragraph", text: words(450) },
      {
        kind: "faq",
        items: [{ question: "Is it worth it?", answer: "It depends on the true discount." }],
      },
    ],
    ...overrides,
  });
}

const SIBLINGS: readonly BlogPost[] = [
  post({ slug: "s1", title: "Sibling one", body: [{ kind: "paragraph", text: "About true discount." }] }),
  post({ slug: "s2", title: "Sibling two", body: [{ kind: "paragraph", text: "Also true discount." }] }),
  post({ slug: "s3", title: "Sibling three", body: [{ kind: "paragraph", text: "More true discount." }] }),
];

describe("a score that says what it is scoring", () => {
  it("gives every check a finding, and a remedy on anything that is not a pass", () => {
    // The platform rule: no bare numbers. A score with no reasoning behind it
    // tells whoever reads it nothing about what to do next.
    const report = seoReport(post(), []);
    for (const check of report.checks) {
      expect(check.finding, check.id).not.toBe("");
      if (check.severity !== "pass") {
        expect(check.remedy, check.id).toBeDefined();
      }
    }
  });

  it("scores out of 100 and never outside it", () => {
    const bare = seoReport(post(), []);
    const good = seoReport(healthy(), SIBLINGS);
    for (const report of [bare, good]) {
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    }
  });

  it("scores a complete post far above a thin one", () => {
    expect(seoReport(healthy(), SIBLINGS).score).toBeGreaterThan(seoReport(post(), []).score + 40);
  });

  it("bands the score consistently with the number", () => {
    const report = seoReport(healthy(), SIBLINGS);
    expect(report.band).toBe(report.score >= 80 ? "strong" : report.score >= 55 ? "workable" : "weak");
    expect(seoReport(post(), []).band).toBe("weak");
  });

  it("lists problems before improvements", () => {
    const report = seoReport(post(), []);
    const severities = report.issues.map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) => (a === b ? 0 : a === "problem" ? -1 : 1)));
  });
});

describe("the individual checks", () => {
  function finding(p: BlogPost, id: string, corpus: readonly BlogPost[] = SIBLINGS) {
    return seoReport(p, corpus).checks.find((c) => c.id === id);
  }

  it("fails a title Google would truncate, and one too short to say anything", () => {
    expect(finding(healthy({ title: "Tax" }), "title-length")?.severity).toBe("problem");
    expect(finding(healthy({ title: `${"Long title about stamp duty ".repeat(4)}` }), "title-length")?.severity).toBe("problem");
    expect(finding(healthy(), "title-length")?.severity).toBe("pass");
  });

  it("fails a description that is too long to render or too short to be used", () => {
    expect(finding(healthy({ description: "Short." }), "description-length")?.severity).toBe("problem");
    expect(finding(healthy({ description: words(60) }), "description-length")?.severity).toBe("problem");
  });

  it("fails a slug that is not lowercase hyphenated", () => {
    expect(finding(healthy({ slug: "True_Discount Post" }), "slug-shape")?.severity).toBe("problem");
    expect(finding(healthy(), "slug-shape")?.severity).toBe("pass");
  });

  it("treats a post between the floor and the target as an improvement, not a problem", () => {
    // A post with 700 words is not in the same state as one with 40, and a
    // check that reports them identically cannot be used to decide what to fix.
    const middling = healthy({
      body: [
        { kind: "heading", text: "One" },
        { kind: "heading", text: "Two" },
        { kind: "paragraph", text: `true discount GDV bridging finance ${words(700)}` },
      ],
    });
    const check = finding(middling, "body-length");
    expect(check?.severity).toBe("improvement");
    expect(check?.earned).toBeGreaterThan(0);
    expect(check?.earned).toBeLessThan(check?.weight ?? 0);
  });

  it("flags a post with no headings", () => {
    expect(
      finding(healthy({ body: [{ kind: "paragraph", text: words(1000) }] }), "headings")?.severity,
    ).toBe("problem");
  });

  it("flags a post nothing else links to", () => {
    expect(finding(healthy(), "not-orphaned", [])?.severity).toBe("problem");
    expect(finding(healthy(), "not-orphaned", SIBLINGS)?.severity).toBe("pass");
  });

  it("treats a missing FAQ as an improvement rather than a problem", () => {
    // A post without an FAQ is a normal post, not a broken one.
    const noFaq = healthy({ body: healthy().body.filter((b) => b.kind !== "faq") });
    expect(finding(noFaq, "rich-result")?.severity).toBe("improvement");
  });

  it("does not penalise a title for a subject the post never names", () => {
    // Nothing to check against is not the same as failing the check.
    expect(finding(post({ body: [{ kind: "paragraph", text: "No defined terms here." }] }), "title-topic")?.severity).toBe("pass");
  });

  it("catches a title that names none of the subject the body is about", () => {
    const drifted = healthy({ title: "What we learned in March about the market" });
    expect(finding(drifted, "title-topic")?.severity).toBe("problem");
  });
});

describe("auditing the whole corpus", () => {
  it("returns the worst post first, because that is the one to fix", () => {
    const corpus = [healthy(), ...SIBLINGS];
    const scores = auditCorpus(corpus).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it("reports on every post exactly once", () => {
    const corpus = [healthy(), ...SIBLINGS];
    expect(auditCorpus(corpus)).toHaveLength(corpus.length);
    expect(new Set(auditCorpus(corpus).map((r) => r.slug)).size).toBe(corpus.length);
  });

  it("handles an empty corpus", () => {
    expect(auditCorpus([])).toEqual([]);
  });
});
