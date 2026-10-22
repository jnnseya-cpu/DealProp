import { describe, expect, it } from "vitest";
import { proposeSeoActions, seoAgentDigest } from "@shared/domain/seoAgent";
import type { BlogPost, Topic } from "@shared/domain/blog";
import type { SeoCheck, SeoReport } from "@shared/domain/seo";

const NOW = new Date("2026-10-22T00:00:00.000Z");

function post(over: Partial<BlogPost> = {}): BlogPost {
  return {
    slug: "a-post",
    title: "A post",
    description: "A description.",
    answer: "An answer.",
    topic: "finance" as Topic,
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    body: [],
    attributions: [],
    fromLiveDeal: false,
    citations: [],
    ...over,
  } as BlogPost;
}

function check(over: Partial<SeoCheck> = {}): SeoCheck {
  return {
    id: "title-length",
    label: "Title length",
    severity: "problem",
    finding: "Title is 12 characters.",
    remedy: "Lengthen the title.",
    weight: 10,
    earned: 0,
    ...over,
  } as SeoCheck;
}

function report(over: Partial<SeoReport> = {}): SeoReport {
  const issues = over.issues ?? [check()];
  return {
    slug: "a-post",
    title: "A post",
    score: 60,
    band: "weak",
    checks: issues,
    issues,
    words: 500,
    internalLinkCount: 2,
    ...over,
  } as SeoReport;
}

describe("the SEO agent", () => {
  it("proposes fixing a flagged post, writing missing topics, and refreshing stale posts", () => {
    const corpus = [post({ slug: "p1", topic: "finance" })];
    const reports = [report({ slug: "p1", title: "P1" })];
    const proposals = proposeSeoActions({
      corpus,
      reports,
      views: new Map([["p1", 120]]),
      now: NOW,
    });
    const kinds = new Set(proposals.map((p) => p.kind));
    expect(kinds.has("fix-post")).toBe(true);
    // Five other topics have no post → cover-topic proposals.
    expect(proposals.filter((p) => p.kind === "cover-topic").length).toBeGreaterThanOrEqual(5);
  });

  it("ranks a problem on a read post above a topic with no post", () => {
    const proposals = proposeSeoActions({
      corpus: [post({ slug: "p1" })],
      reports: [report({ slug: "p1", score: 60, issues: [check({ severity: "problem" })] })],
      views: new Map([["p1", 200]]),
      now: NOW,
    });
    const fix = proposals.find((p) => p.kind === "fix-post");
    const topic = proposals.find((p) => p.kind === "cover-topic");
    expect(fix).toBeDefined();
    expect(topic).toBeDefined();
    expect(fix!.priority).toBeGreaterThan(topic!.priority);
    // Worst-first ordering.
    expect(proposals[0]?.priority).toBeGreaterThanOrEqual(proposals[proposals.length - 1]?.priority ?? 0);
  });

  it("flags a topic with no post as a problem and refreshes a year-old post", () => {
    const proposals = proposeSeoActions({
      corpus: [post({ slug: "old", topic: "finance", updatedAt: "2025-01-01T00:00:00.000Z" })],
      reports: [report({ slug: "old", issues: [] })],
      views: new Map(),
      now: NOW,
    });
    expect(proposals.some((p) => p.kind === "cover-topic" && p.severity === "problem")).toBe(true);
    expect(proposals.some((p) => p.kind === "refresh")).toBe(true);
  });

  it("never predicts a ranking, a backlink, a competitor or a search volume", () => {
    const proposals = proposeSeoActions({
      corpus: [post({ slug: "p1" })],
      reports: [report({ slug: "p1" })],
      views: new Map([["p1", 50]]),
      now: NOW,
    });
    for (const p of proposals) {
      expect(/rank|backlink|search volume|competitor/i.test(p.reason), p.reason).toBe(false);
    }
  });

  it("digests the queue and says it is grounded, not guessed", () => {
    const proposals = proposeSeoActions({
      corpus: [post({ slug: "p1" })],
      reports: [report({ slug: "p1" })],
      views: new Map(),
      now: NOW,
    });
    const digest = seoAgentDigest(proposals);
    expect(digest.total).toBe(proposals.length);
    expect(digest.toFix + digest.toWrite + digest.toRefresh).toBe(digest.total);
    expect(digest.summary).toMatch(/not from any guess about rankings/);
  });

  it("says there is nothing to do when the corpus clears and every topic is covered", () => {
    const full = (["deal-analysis", "seller-guides", "finance", "tax", "regulation", "data"] as Topic[]).flatMap(
      (t, i) => [post({ slug: `${t}-1`, topic: t }), post({ slug: `${t}-2`, topic: t })].map((p, j) => ({ ...p, slug: `${t}-${i}${j}` })),
    );
    const reports = full.map((p) => report({ slug: p.slug, score: 95, band: "strong", issues: [] }));
    const proposals = proposeSeoActions({ corpus: full, reports, views: new Map(), now: NOW });
    expect(proposals).toEqual([]);
    expect(seoAgentDigest(proposals).summary).toMatch(/Nothing to do/);
  });
});
