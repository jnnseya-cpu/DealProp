import { describe, expect, it } from "vitest";
import { featurePosts } from "@backend/blog/features";
import { loadCorpus } from "@backend/blog/corpus";
import { seoReport, SCORE_FLOOR } from "@shared/domain/seo";
import { externalCitations, internalLinks, termsMentioned, plainText, TOPICS } from "@shared/domain/blog";

/**
 * The feature posts, held to the same bar as every other post and to a few
 * things the general corpus test cannot say.
 *
 * A feature post that drifts below the floor is a failing build like any other
 * — but these also sell a capability, so the point of this file is to pin that
 * they do it under the house rules: no invented figure a reader could mistake
 * for a return, nothing about a seller's circumstances, every claim cited.
 */
describe("the feature posts", () => {
  const posts = featurePosts();

  it("publishes a distinct, well-formed slug for each", () => {
    const slugs = posts.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), slug).toBe(true);
      expect(slug.length, slug).toBeLessThanOrEqual(60);
    }
  });

  it("files every post under a real topic", () => {
    for (const post of posts) expect(TOPICS, post.slug).toContain(post.topic);
  });

  it("clears the score floor on every feature post, in the full corpus", async () => {
    const corpus = await loadCorpus();
    const featureSlugs = new Set(posts.map((p) => p.slug));
    for (const post of corpus) {
      if (!featureSlugs.has(post.slug)) continue;
      const report = seoReport(post, corpus);
      expect(report.score, `${post.slug}: ${report.score} — ${report.issues.map((i) => i.id).join(", ")}`).toBeGreaterThanOrEqual(
        SCORE_FLOOR,
      );
    }
  });

  it("answers its own title first, in a length something will quote", () => {
    for (const post of posts) {
      const words = post.answer.trim().split(/\s+/).length;
      expect(words, `${post.slug}: ${words} words`).toBeGreaterThanOrEqual(25);
      expect(words, `${post.slug}: ${words} words`).toBeLessThanOrEqual(75);
      expect(post.answer.trim().endsWith("."), post.slug).toBe(true);
    }
  });

  it("cites at least two primary sources that resolve", () => {
    for (const post of posts) {
      const sources = externalCitations(post);
      expect(sources.length, post.slug).toBeGreaterThanOrEqual(2);
      for (const source of sources) expect(source.url, `${post.slug}: ${source.key}`).toMatch(/^https:\/\//);
    }
  });

  it("carries enough computed links and defined terms to cluster", async () => {
    const corpus = await loadCorpus();
    const featureSlugs = new Set(posts.map((p) => p.slug));
    for (const post of corpus) {
      if (!featureSlugs.has(post.slug)) continue;
      expect(internalLinks(post, corpus).length, post.slug).toBeGreaterThanOrEqual(10);
      expect(termsMentioned(post).length, post.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("carries a figure block and a question heading on every post", () => {
    for (const post of posts) {
      expect(post.body.some((b) => b.kind === "figures"), post.slug).toBe(true);
      expect(post.body.some((b) => b.kind === "faq"), post.slug).toBe(true);
      const questionHeadings = post.body.filter(
        (b) => b.kind === "heading" && (b.text.trim().endsWith("?") || /^(what|why|how|when|who|which|does|is|are)\b/i.test(b.text.trim())),
      ).length;
      expect(questionHeadings, post.slug).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * §20 again: a feature post is still a public page, and the one that sells
   * Seller Protection is the one most tempted to describe the person it
   * protects. It must sell the control by what it does to a transaction.
   */
  it("says nothing about a seller's personal circumstances", () => {
    const forbidden = [
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
    for (const post of posts) {
      const text = `${post.title} ${post.description} ${post.answer} ${plainText(post)}`.toLowerCase();
      for (const phrase of forbidden) {
        expect(text.includes(phrase), `${post.slug} publishes "${phrase}"`).toBe(false);
      }
    }
  });

  /**
   * No figure a reader could take as an offered return. The feature posts use
   * qualitative comparison tables, so a bare percentage or currency amount in a
   * figure row would be exactly the invented number the house rules forbid.
   */
  it("puts no currency amount or percentage in a figure row", () => {
    for (const post of posts) {
      for (const block of post.body) {
        if (block.kind !== "figures") continue;
        for (const row of block.rows) {
          expect(/[£$]\s?\d|\d+\s?%/.test(row.value), `${post.slug}: "${row.value}"`).toBe(false);
        }
      }
    }
  });
});
