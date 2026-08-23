import {
  internalLinks,
  plainText,
  relatedPosts,
  termsMentioned,
  type BlogPost,
} from "@shared/domain/blog";

/**
 * On-page SEO audit.
 *
 * A score is only useful if it says what it is scoring, so this returns the
 * findings and derives the number from them rather than returning a number with
 * a rationale bolted on afterwards. Same rule as every other score on this
 * platform: no bare figures.
 *
 * What this is **not**: a ranking prediction. Nothing here can see a backlink, a
 * competitor, a search volume or a SERP. It checks the things that are (a)
 * entirely within this codebase's control and (b) known to matter — title and
 * description length against what Google actually renders, heading structure,
 * body length, internal linking, and structured-data eligibility. A post can
 * score 100 here and rank nowhere; a post scoring 40 has problems that are
 * definitely costing it.
 *
 * Every check is deterministic and computed from the post itself. There is no
 * external service, no API key and nothing to be rate-limited by, which is why
 * this can run on every post on every render of the operator dashboard.
 */

export type CheckId =
  | "title-length"
  | "title-topic"
  | "description-length"
  | "slug-shape"
  | "body-length"
  | "headings"
  | "internal-links"
  | "glossary-coverage"
  | "not-orphaned"
  | "rich-result";

export type Severity =
  /** Costs the post something measurable in search. */
  | "problem"
  /** Works, but is leaving something on the table. */
  | "improvement"
  | "pass";

export interface SeoCheck {
  readonly id: CheckId;
  readonly label: string;
  readonly severity: Severity;
  /** What was found, in figures. Never "looks good". */
  readonly finding: string;
  /** What to do about it. Absent on a pass. */
  readonly remedy?: string;
  /** Points available, and points earned. */
  readonly weight: number;
  readonly earned: number;
}

export interface SeoReport {
  readonly slug: string;
  readonly title: string;
  /** 0–100. */
  readonly score: number;
  readonly band: "strong" | "workable" | "weak";
  readonly checks: readonly SeoCheck[];
  /** Just the ones worth acting on, worst first. */
  readonly issues: readonly SeoCheck[];
  readonly words: number;
  readonly internalLinkCount: number;
}

/*
 * The limits below are what Google renders, not house style.
 *
 * Titles are truncated by pixel width rather than character count, and ~60
 * characters is where a typical title starts being cut on desktop. Descriptions
 * are rewritten by Google more often than not, but a description over ~158
 * characters is truncated when it is used at all, and one under ~70 usually
 * means the snippet gets written from body copy instead.
 */
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 158;
const SLUG_MAX = 60;

/**
 * Below this a post is thin content and competes badly for anything.
 *
 * 600 words is not a ranking factor — there is no word-count factor — but a
 * page that cannot say 600 words about a subject usually has not covered it,
 * and Google's helpful-content systems are explicitly looking for coverage.
 */
const WORDS_MIN = 600;
const WORDS_COMFORTABLE = 900;

const HEADINGS_MIN = 2;
const LINKS_MIN = 5;
const GLOSSARY_MIN = 2;
const RELATED_MIN = 2;

export function seoReport(post: BlogPost, corpus: readonly BlogPost[]): SeoReport {
  const text = plainText(post);
  const words = countWords(text);
  const headings = post.body.filter((b) => b.kind === "heading").length;
  const links = internalLinks(post, corpus);
  const terms = termsMentioned(post);
  const related = relatedPosts(post, corpus);
  const hasFaq = post.body.some((b) => b.kind === "faq");

  const checks: SeoCheck[] = [
    lengthCheck({
      id: "title-length",
      label: "Title length",
      value: post.title.length,
      min: TITLE_MIN,
      max: TITLE_MAX,
      unit: "characters",
      weight: 12,
      shortRemedy: `Under ${TITLE_MIN} characters wastes the strongest on-page signal there is.`,
      longRemedy: `Over ${TITLE_MAX} characters is truncated in the result, so the end of the title is not read.`,
    }),

    check({
      id: "title-topic",
      label: "Title carries the subject",
      weight: 8,
      passed: titleCarriesSubject(post),
      finding: titleCarriesSubject(post)
        ? "The title contains a term the post is about."
        : "The title shares no significant word with the body's subject terms.",
      remedy: "Put the thing somebody would search for in the title, not only in the body.",
    }),

    lengthCheck({
      id: "description-length",
      label: "Meta description length",
      value: post.description.length,
      min: DESCRIPTION_MIN,
      max: DESCRIPTION_MAX,
      unit: "characters",
      weight: 10,
      shortRemedy: `Under ${DESCRIPTION_MIN} characters and Google usually writes its own snippet from the body instead.`,
      longRemedy: `Over ${DESCRIPTION_MAX} characters is truncated mid-sentence.`,
    }),

    check({
      id: "slug-shape",
      label: "URL",
      weight: 6,
      passed: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) && post.slug.length <= SLUG_MAX,
      finding: `\`/blog/${post.slug}\` — ${post.slug.length} characters.`,
      remedy: `Lowercase words separated by hyphens, at most ${SLUG_MAX} characters. Changing a published slug costs its links, so this is worth getting right once.`,
    }),

    graded({
      id: "body-length",
      label: "Body length",
      weight: 14,
      value: words,
      floor: WORDS_MIN,
      target: WORDS_COMFORTABLE,
      finding: `${words} words.`,
      remedy: `Under ${WORDS_MIN} words is thin for a subject anybody is competing on. Cover the question rather than padding.`,
    }),

    check({
      id: "headings",
      label: "Section headings",
      weight: 10,
      passed: headings >= HEADINGS_MIN,
      finding: `${headings} heading${headings === 1 ? "" : "s"}.`,
      remedy: `At least ${HEADINGS_MIN}. Headings are how both a reader scanning the page and a crawler extracting a passage find the answer.`,
    }),

    graded({
      id: "internal-links",
      label: "Internal links",
      weight: 18,
      value: links.length,
      floor: LINKS_MIN,
      target: LINKS_MIN * 2,
      finding: `${links.length} internal link${links.length === 1 ? "" : "s"}.`,
      remedy: `Fewer than ${LINKS_MIN} and the post neither passes authority on nor gives a crawler a route deeper into the site. These are derived from glossary terms, related posts and the topic hub — a post with few links usually mentions few defined terms.`,
    }),

    check({
      id: "glossary-coverage",
      label: "Defined terms used",
      weight: 8,
      passed: terms.length >= GLOSSARY_MIN,
      finding: `${terms.length} glossary term${terms.length === 1 ? "" : "s"} mentioned.`,
      remedy: `At least ${GLOSSARY_MIN}. Each one becomes a link to its definition and a definition linking back, which is what makes the topic cluster a cluster.`,
    }),

    check({
      id: "not-orphaned",
      label: "Linked from siblings",
      weight: 8,
      passed: related.length >= RELATED_MIN,
      finding: `${related.length} related post${related.length === 1 ? "" : "s"}.`,
      remedy: `Fewer than ${RELATED_MIN} and this page is close to orphaned. Publish more in its topic, or check the topic is right.`,
    }),

    check({
      id: "rich-result",
      label: "Rich result eligibility",
      weight: 6,
      passed: hasFaq,
      severityWhenFailed: "improvement",
      finding: hasFaq
        ? "Carries an FAQ block, so it emits FAQPage structured data."
        : "No FAQ block, so only Article structured data is emitted.",
      remedy: "An FAQ block answers the long-tail questions people actually type, and is eligible for an expanded result.",
    }),
  ];

  const weight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  const score = weight === 0 ? 0 : Math.round((earned / weight) * 100);

  const rank: Record<Severity, number> = { problem: 0, improvement: 1, pass: 2 };

  return {
    slug: post.slug,
    title: post.title,
    score,
    band: score >= 80 ? "strong" : score >= 55 ? "workable" : "weak",
    checks,
    issues: checks
      .filter((c) => c.severity !== "pass")
      .sort((a, b) => rank[a.severity] - rank[b.severity] || b.weight - a.weight),
    words,
    internalLinkCount: links.length,
  };
}

/** Every post, worst first — which is the order they need working on. */
export function auditCorpus(corpus: readonly BlogPost[]): readonly SeoReport[] {
  return corpus.map((post) => seoReport(post, corpus)).sort((a, b) => a.score - b.score);
}

/* ------------------------------------------------------------- internals */

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

function check(input: {
  id: CheckId;
  label: string;
  weight: number;
  passed: boolean;
  finding: string;
  remedy: string;
  severityWhenFailed?: Severity;
}): SeoCheck {
  if (input.passed) {
    return {
      id: input.id,
      label: input.label,
      severity: "pass",
      finding: input.finding,
      weight: input.weight,
      earned: input.weight,
    };
  }
  return {
    id: input.id,
    label: input.label,
    severity: input.severityWhenFailed ?? "problem",
    finding: input.finding,
    remedy: input.remedy,
    weight: input.weight,
    earned: 0,
  };
}

/**
 * A check with a floor and a target.
 *
 * Below the floor is a problem and earns nothing. Between floor and target it
 * works but is leaving something behind, and earns proportionally — a post with
 * four internal links is not in the same state as one with none, and a score
 * that treats them identically tells whoever reads it nothing about which to
 * fix first.
 */
function graded(input: {
  id: CheckId;
  label: string;
  weight: number;
  value: number;
  floor: number;
  target: number;
  finding: string;
  remedy: string;
}): SeoCheck {
  if (input.value >= input.target) {
    return {
      id: input.id,
      label: input.label,
      severity: "pass",
      finding: input.finding,
      weight: input.weight,
      earned: input.weight,
    };
  }
  if (input.value < input.floor) {
    return {
      id: input.id,
      label: input.label,
      severity: "problem",
      finding: input.finding,
      remedy: input.remedy,
      weight: input.weight,
      earned: 0,
    };
  }
  const span = input.target - input.floor;
  const progress = span <= 0 ? 1 : (input.value - input.floor) / span;
  return {
    id: input.id,
    label: input.label,
    severity: "improvement",
    finding: input.finding,
    remedy: input.remedy,
    weight: input.weight,
    // Half the weight for clearing the floor, the rest earned towards target.
    earned: Math.round(input.weight * (0.5 + 0.5 * progress)),
  };
}

function lengthCheck(input: {
  id: CheckId;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  weight: number;
  shortRemedy: string;
  longRemedy: string;
}): SeoCheck {
  const finding = `${input.value} ${input.unit} (aim for ${input.min}–${input.max}).`;
  if (input.value >= input.min && input.value <= input.max) {
    return {
      id: input.id,
      label: input.label,
      severity: "pass",
      finding,
      weight: input.weight,
      earned: input.weight,
    };
  }
  return {
    id: input.id,
    label: input.label,
    severity: "problem",
    finding,
    remedy: input.value < input.min ? input.shortRemedy : input.longRemedy,
    weight: input.weight,
    earned: 0,
  };
}

/**
 * Does the title contain a word the post is actually about?
 *
 * Approximated from the glossary terms the body mentions, because those are the
 * subject vocabulary this platform has already defined. Not a keyword-density
 * check — those measure nothing — but a post titled "What we learned in March"
 * about stamp duty is a real and common failure, and this catches it.
 */
function titleCarriesSubject(post: BlogPost): boolean {
  const terms = termsMentioned(post);
  if (terms.length === 0) return true; // Nothing to check against; do not penalise.
  const title = post.title.toLowerCase();
  return terms.some((term) =>
    term.term
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .some((word) => title.includes(word)),
  );
}
