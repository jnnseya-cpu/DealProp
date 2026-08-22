import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonical,
  faqJsonLd,
  GLOSSARY,
  glossaryTerm,
  internalLinks,
  metaDescription,
  readingMinutes,
  relatedPosts,
  termsMentioned,
  TOPIC_DEFINITIONS,
  TOPICS,
  type BlogPost,
} from "@shared/domain/blog";
import { normaliseSiteUrl } from "@shared/site";
import { engineDrafter } from "@backend/blog/agent";

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

describe("the glossary", () => {
  it("gives every term a unique slug and a one-sentence summary", () => {
    const slugs = GLOSSARY.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const term of GLOSSARY) {
      expect(term.short.length, term.slug).toBeGreaterThan(20);
      expect(term.body.length, term.slug).toBeGreaterThan(0);
      expect(TOPICS).toContain(term.topic);
    }
  });

  it("has no alias that collides with another term", () => {
    // A collision would link the same words to two different definitions
    // depending on which was checked first.
    const seen = new Map<string, string>();
    for (const term of GLOSSARY) {
      for (const phrase of [term.term, ...term.aliases]) {
        const key = phrase.toLowerCase();
        expect(seen.get(key), `${phrase} claimed by ${seen.get(key) ?? ""}`).toBeUndefined();
        seen.set(key, term.slug);
      }
    }
  });

  it("finds a term by slug and nothing by a made-up one", () => {
    expect(glossaryTerm("true-discount")?.term).toBe("true discount");
    expect(glossaryTerm("not-a-term")).toBeUndefined();
  });
});

describe("term detection", () => {
  it("matches whole words only", () => {
    // Substring matching would link "data" inside "database" and turn the body
    // into false links, which reads as spam to a person and a crawler alike.
    const withTerm = post({ body: [{ kind: "paragraph", text: "The true discount is negative." }] });
    const without = post({ body: [{ kind: "paragraph", text: "Untruediscounted nonsense." }] });
    expect(termsMentioned(withTerm).map((t) => t.slug)).toContain("true-discount");
    expect(termsMentioned(without)).toHaveLength(0);
  });

  it("matches aliases as well as the term itself", () => {
    const gdv = post({ body: [{ kind: "paragraph", text: "GDV is the end value." }] });
    expect(termsMentioned(gdv).map((t) => t.slug)).toContain("gross-development-value");
  });

  it("is case-insensitive", () => {
    const shouty = post({ body: [{ kind: "paragraph", text: "BRIDGING FINANCE costs more." }] });
    expect(termsMentioned(shouty).map((t) => t.slug)).toContain("bridging-finance");
  });

  it("looks inside every block kind, not just paragraphs", () => {
    const inList = post({
      body: [{ kind: "list", items: ["Watch the additional dwelling surcharge."] }],
    });
    const inFaq = post({
      body: [{ kind: "faq", items: [{ question: "What is MEES?", answer: "A standard." }] }],
    });
    expect(termsMentioned(inList).map((t) => t.slug)).toContain("additional-dwelling-surcharge");
    expect(termsMentioned(inFaq).map((t) => t.slug)).toContain("mees");
  });
});

describe("the internal link graph", () => {
  const corpus = [
    post({ slug: "a", title: "A", body: [{ kind: "paragraph", text: "About true discount." }] }),
    post({ slug: "b", title: "B", body: [{ kind: "paragraph", text: "Also about true discount." }] }),
    post({
      slug: "c",
      title: "C",
      topic: "tax",
      body: [{ kind: "paragraph", text: "Nothing in common whatsoever." }],
    }),
  ];

  it("relates posts that share vocabulary, and not ones that do not", () => {
    const related = relatedPosts(corpus[0] as BlogPost, corpus);
    expect(related.map((p) => p.slug)).toEqual(["b"]);
  });

  it("never relates a post to itself", () => {
    for (const p of corpus) {
      expect(relatedPosts(p, corpus).map((r) => r.slug)).not.toContain(p.slug);
    }
  });

  it("gives every post its topic hub, its terms and a call to action", () => {
    // This is where "many links" actually comes from, and all of it is derived
    // — a renamed slug cannot leave a dead link behind.
    const links = internalLinks(corpus[0] as BlogPost, corpus);
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain("/blog/topic/deal-analysis");
    expect(hrefs).toContain("/glossary/true-discount");
    expect(hrefs).toContain("/blog/b");
    expect(links.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every link a context, so none renders as a bare href", () => {
    for (const link of internalLinks(corpus[0] as BlogPost, corpus)) {
      expect(link.context, link.href).not.toBe("");
      expect(link.label, link.href).not.toBe("");
    }
  });

  it("points every call to action at a route that exists", () => {
    const routes = new Set(["/sell", "/invest", "/capital", "/newsletter", "/blog", "/glossary"]);
    for (const topic of TOPICS) {
      const links = internalLinks(post({ topic }), []);
      for (const link of links) {
        const ok =
          routes.has(link.href) ||
          link.href.startsWith("/glossary/") ||
          link.href.startsWith("/blog/");
        expect(ok, `${topic} links to ${link.href}`).toBe(true);
      }
    }
  });

  it("labels every topic hub", () => {
    for (const topic of TOPICS) {
      expect(TOPIC_DEFINITIONS[topic].label).toBeTruthy();
      expect(TOPIC_DEFINITIONS[topic].description.length).toBeGreaterThan(30);
    }
  });
});

describe("SEO metadata", () => {
  it("keeps a meta description under the length search engines show", () => {
    const long = "word ".repeat(80);
    const description = metaDescription(long);
    expect(description.length).toBeLessThanOrEqual(159);
  });

  it("cuts at a word boundary rather than mid-word", () => {
    const description = metaDescription("a".repeat(10) + " " + "b".repeat(200));
    expect(description.endsWith("…")).toBe(true);
    expect(description).not.toMatch(/b{5,}…$/);
  });

  it("leaves a short description alone", () => {
    expect(metaDescription("Short and complete.")).toBe("Short and complete.");
  });

  it("builds canonical URLs without a double slash", () => {
    // A trailing slash produces https://example.com//blog, which a crawler
    // treats as a different URL from the one every link points at.
    expect(canonical("https://example.com/", "/blog")).toBe("https://example.com/blog");
    expect(normaliseSiteUrl("https://example.com///")).toBe("https://example.com");
    expect(normaliseSiteUrl(undefined)).toBe("http://localhost:3000");
    expect(normaliseSiteUrl("  ")).toBe("http://localhost:3000");
  });

  it("emits Article data with the dates and section filled in", () => {
    const json = articleJsonLd(post(), "https://example.com", "Lode");
    expect(json["@type"]).toBe("Article");
    expect(json.datePublished).toBe("2026-08-01T00:00:00.000Z");
    expect(json.mainEntityOfPage).toBe("https://example.com/blog/a-post");
    expect(json.articleSection).toBe("Deal analysis");
  });

  it("numbers breadcrumb positions from one", () => {
    const json = breadcrumbJsonLd(
      [
        { name: "Blog", path: "/blog" },
        { name: "A", path: "/blog/a" },
      ],
      "https://example.com",
    );
    const items = json.itemListElement as { position: number; item: string }[];
    expect(items[0]?.position).toBe(1);
    expect(items[1]?.item).toBe("https://example.com/blog/a");
  });

  it("emits FAQ data only where the post has an FAQ", () => {
    // Marking up an FAQ that is not on the page is how a site earns a manual
    // action.
    expect(faqJsonLd(post())).toBeUndefined();
    const withFaq = post({
      body: [{ kind: "faq", items: [{ question: "Q?", answer: "A." }] }],
    });
    const json = faqJsonLd(withFaq);
    expect(json?.["@type"]).toBe("FAQPage");
    expect((json?.mainEntity as unknown[]).length).toBe(1);
  });

  it("never reports a zero-minute read", () => {
    expect(readingMinutes(post({ body: [{ kind: "paragraph", text: "Two words" }] }))).toBe(1);
  });
});

describe("the drafter seam", () => {
  it("writes a post from the engine's own evidence, with no model", async () => {
    // The default drafter needs no API key and no network, which is why the
    // blog works today. An LLM drafter improves the sentences, not the facts.
    const drafted = await engineDrafter.draft({
      slug: "x",
      topic: "deal-analysis",
      headline: "A headline",
      evidence: ["The first sentence.", "A supporting reason."],
      figures: [{ label: "Profit after tax", value: "£35,359" }],
    });
    expect(drafted.title).toBe("A headline");
    expect(drafted.standfirst).toBe("The first sentence.");
    const figures = drafted.body.find((b) => b.kind === "figures");
    expect(figures?.kind).toBe("figures");
  });

  it("survives a brief with no evidence rather than throwing", async () => {
    const drafted = await engineDrafter.draft({
      slug: "x",
      topic: "tax",
      headline: "Only a headline",
      evidence: [],
      figures: [],
    });
    expect(drafted.standfirst).toBe("Only a headline");
  });
});
