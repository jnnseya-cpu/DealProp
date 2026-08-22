/**
 * The blog: content model, glossary, internal link graph and SEO metadata.
 *
 * Two rules shape this module, and both come from the rest of the platform
 * rather than from anything about publishing.
 *
 * **Every figure in a post comes from the engine.** A property blog that
 * invents "typical returns of 20%" is doing the thing this product exists to
 * refuse. Posts are built from `runDealDirector()` output, so the number in a
 * paragraph and the number in the Deal Room are the same number, and a post
 * about a deal we turned down says what it actually scored.
 *
 * **Links are computed, not typed.** Internal linking is most of what on-page
 * SEO is, and hand-maintained links rot the moment a slug changes. Every
 * glossary term that appears in a body is linked to its definition, every post
 * links to the others sharing its topic, and every one of those is derived from
 * the corpus at render time. Nothing here is a hardcoded href.
 */

export type Topic =
  | "deal-analysis"
  | "seller-guides"
  | "finance"
  | "tax"
  | "regulation"
  | "data";

export const TOPICS: readonly Topic[] = [
  "deal-analysis",
  "seller-guides",
  "finance",
  "tax",
  "regulation",
  "data",
];

export interface TopicDefinition {
  readonly topic: Topic;
  readonly label: string;
  /** The hub page's own heading and meta description. */
  readonly title: string;
  readonly description: string;
}

export const TOPIC_DEFINITIONS: Record<Topic, TopicDefinition> = {
  "deal-analysis": {
    topic: "deal-analysis",
    label: "Deal analysis",
    title: "Property deal analysis, with the working shown",
    description:
      "Real deals run through the engine: the costs, the tax, the stress tests, and the ones we turned down.",
  },
  "seller-guides": {
    topic: "seller-guides",
    label: "Selling a property",
    title: "Selling a property that will not sell",
    description:
      "Probate, inherited houses, failed listings and properties needing work — what your options actually pay, and when.",
  },
  finance: {
    topic: "finance",
    label: "Finance",
    title: "Bridging, refurbishment finance and capital stacks",
    description:
      "How refurbishment purchases are funded, what the finance really costs, and when a stack stops closing.",
  },
  tax: {
    topic: "tax",
    label: "Tax",
    title: "Property tax that changes the answer",
    description:
      "Stamp duty, the additional dwelling surcharge and profit tax — and why a pre-tax appraisal overstates every deal.",
  },
  regulation: {
    topic: "regulation",
    label: "Regulation",
    title: "The rules around motivated-seller property",
    description:
      "Estate agency supervision, financial promotions, seller protection and what may lawfully be offered.",
  },
  data: {
    topic: "data",
    label: "Property data",
    title: "Open property data, and what it can tell you",
    description:
      "Price Paid Data, the EPC register and what they reveal about a property nobody has listed yet.",
  },
};

/* ----------------------------------------------------------------- glossary */

export interface GlossaryTerm {
  readonly slug: string;
  readonly term: string;
  /** Other spellings and inflections that should also link here. */
  readonly aliases: readonly string[];
  /** One sentence. Shown in the tooltip, the hub and the meta description. */
  readonly short: string;
  /** The full definition, as paragraphs. */
  readonly body: readonly string[];
  readonly topic: Topic;
}

/**
 * The glossary.
 *
 * These are the load-bearing terms: the ones where a reader who misunderstands
 * the word misunderstands the figure. Every one of them is a concept the engine
 * actually computes, which is what stops the glossary drifting into a keyword
 * list — a term nobody in `src/shared/domain` uses does not belong here.
 */
export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    slug: "true-discount",
    term: "true discount",
    aliases: ["true discount to value"],
    short:
      "Total money deployed measured against open market value, rather than the headline discount on the purchase price.",
    topic: "deal-analysis",
    body: [
      "A property bought at 20% below market value is not bought at a 20% discount. The buyer also pays stamp duty, legal fees, a survey, finance arrangement fees, interest, selling costs and the works themselves.",
      "True discount is what is left once all of that is counted: total money deployed, against open market value. A purchase that looks 20% below market and costs 19% of value to transact and repair is not a discount, and the figure will say so with a negative number.",
      "It is the number that decides whether a deal is worth doing, and it is almost always worse than the headline.",
    ],
  },
  {
    slug: "deal-score",
    term: "Deal Score",
    aliases: ["deal scoring"],
    short:
      "A 0-100 score computed from nine weighted components, always on profit after tax, never before it.",
    topic: "deal-analysis",
    body: [
      "Nine components, each carrying its own reasoning: margin, resilience under stress, exit optionality, capital recycling, seller motivation, completion probability, jurisdiction readiness, protection status and valuation confidence.",
      "The score is computed on profit after tax. A pre-tax appraisal overstates every deal, and overstates marginal ones most — which is exactly where the decision matters.",
      "Hard gates cap it. A seller protection block caps the score at 35 and forces a rejection, whatever the margin says.",
    ],
  },
  {
    slug: "gross-development-value",
    term: "gross development value",
    aliases: ["GDV"],
    short: "What a property is expected to be worth once the planned works are finished.",
    topic: "finance",
    body: [
      "Gross development value, usually shortened to GDV, is the end value: what the property should sell for, or be valued at for a refinance, once the works are complete.",
      "Lenders size refurbishment facilities against it, and margin is usually quoted as a percentage of it. An optimistic GDV is the single easiest way to make a bad deal look viable, which is why it is stress-tested rather than trusted.",
    ],
  },
  {
    slug: "bridging-finance",
    term: "bridging finance",
    aliases: ["bridging loan", "bridge finance", "bridging"],
    short:
      "Short-term secured lending used to buy and refurbish property that a mortgage will not lend against.",
    topic: "finance",
    body: [
      "A property without a kitchen or bathroom, or with a short lease or structural problems, is usually unmortgageable. Bridging lenders will lend against it anyway, at a higher rate and for a short term, on the expectation that the works make it mortgageable.",
      "The facility typically advances against the purchase price plus a tranche for the works, drawn in stages. Interest is charged on what has been drawn, which is why charging day-one interest on the whole works budget overstates the cost of every phased project.",
    ],
  },
  {
    slug: "additional-dwelling-surcharge",
    term: "additional dwelling surcharge",
    aliases: ["surcharge", "second property surcharge"],
    short:
      "Extra transfer tax charged when the buyer already owns another property, or is buying through a company.",
    topic: "tax",
    body: [
      "England and Northern Ireland charge it as a Stamp Duty Land Tax surcharge; Scotland charges the Additional Dwelling Supplement under LBTT, at a different rate. Wales charges higher residential rates under Land Transaction Tax.",
      "For an investor buying through a company it applies from the first pound, and it is large enough to decide whether a deal works. It is the clearest example of why country-specific rates cannot be assumed to be the same across the United Kingdom.",
    ],
  },
  {
    slug: "seller-protection",
    term: "seller protection",
    aliases: ["protection engine", "vulnerable seller"],
    short:
      "Checks that can stop a transaction outright where a seller may not be able to give free and informed consent.",
    topic: "regulation",
    body: [
      "The commercial temptation in motivated-seller acquisition is to convert distress into discount. That route produces complaints, unenforceable contracts and enforcement action.",
      "So the checks here can block rather than warn. A block caps the Deal Score at 35, forces a rejection, fails a hard criterion in every buying mandate, and makes the buyer count zero. Blocks fire on reported capacity concerns, third-party pressure, an elderly seller combined with a large discount, and discounts beyond the review threshold.",
      "Missing answers raise caution rather than passing quietly: absent evidence is a reason to be more careful, never less.",
    ],
  },
  {
    slug: "assisted-sale",
    term: "assisted sale",
    aliases: ["assisted sales"],
    short:
      "The seller keeps ownership while a partner funds and manages the works, then the property is sold and the seller takes an agreed sum.",
    topic: "seller-guides",
    body: [
      "For a property needing work, an assisted sale usually pays the seller more than a cash purchase, because the discount a cash buyer needs is the price of certainty and speed.",
      "The trade-off is time and conditionality. The seller does not get their money on completion; they get it when the improved property sells, and the figure depends on the works estimate being right.",
    ],
  },
  {
    slug: "price-paid-data",
    term: "Price Paid Data",
    aliases: ["Land Registry data", "PPD"],
    short:
      "Every registered property sale in England and Wales since 1995, published free under the Open Government Licence.",
    topic: "data",
    body: [
      "Price Paid Data records the price, date, postcode, property type and tenure of every registered sale, and marks which sales were not at arm's length — repossessions, portfolio transfers, sales between related parties.",
      "Excluding those matters more than it sounds. Leaving them in a local median drags it down and makes every deal in the street look better than it is.",
    ],
  },
  {
    slug: "epc-register",
    term: "EPC register",
    aliases: ["energy performance certificate", "EPC"],
    short:
      "The public register of energy performance certificates, which also publishes floor area and lodgement dates.",
    topic: "data",
    body: [
      "The rating is the least interesting part. The register also carries floor area, which turns a price into a price per square metre — and a three-bedroom terrace can be 70 square metres or 110, which is the entire margin.",
      "The lodgement date matters too. An EPC is a legal precondition of marketing a property, so a certificate lodged eighteen months ago with no sale registered since means somebody prepared to sell and it did not happen.",
    ],
  },
  {
    slug: "mees",
    term: "MEES",
    aliases: ["minimum energy efficiency standard"],
    short:
      "The rule making it unlawful to continue letting a domestic property in England and Wales rated F or G.",
    topic: "regulation",
    body: [
      "Since 1 April 2023 the Minimum Energy Efficiency Standard applies to continuing tenancies, not just new ones. A landlord holding an F or G must improve the property or register a valid exemption.",
      "It does not extend to Scotland or Northern Ireland. Assuming it does would treat compliant landlords there as though they faced a deadline they do not have.",
    ],
  },
];

export function glossaryTerm(slug: string): GlossaryTerm | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

/* --------------------------------------------------------------- the corpus */

/** A block of a post body. Deliberately small: this is not a CMS. */
export type Block =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "quote"; readonly text: string }
  | {
      readonly kind: "figures";
      readonly caption: string;
      readonly rows: readonly { readonly label: string; readonly value: string }[];
    }
  /** Rendered as a FAQ block and as FAQPage structured data. */
  | {
      readonly kind: "faq";
      readonly items: readonly { readonly question: string; readonly answer: string }[];
    };

export interface BlogPost {
  readonly slug: string;
  readonly title: string;
  /** The meta description. Kept to one sentence and under 160 characters. */
  readonly description: string;
  readonly topic: Topic;
  /** ISO-8601. */
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly body: readonly Block[];
  /** Where the figures came from, for the attribution line. */
  readonly attributions: readonly string[];
  /**
   * True where the figures were computed from a live deal rather than from a
   * worked example. Rendered as a note, because a reader is entitled to know
   * which they are looking at.
   */
  readonly fromLiveDeal: boolean;
}

/* --------------------------------------------------------- links and SEO */

export interface InternalLink {
  readonly href: string;
  readonly label: string;
  /** Why this link is here, used as the title attribute. */
  readonly context: string;
}

/** All the text of a post, for term detection and reading time. */
export function plainText(post: BlogPost): string {
  return post.body
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
        case "heading":
        case "quote":
          return block.text;
        case "list":
          return block.items.join(" ");
        case "figures":
          return `${block.caption} ${block.rows.map((r) => `${r.label} ${r.value}`).join(" ")}`;
        case "faq":
          return block.items.map((i) => `${i.question} ${i.answer}`).join(" ");
      }
    })
    .join(" ");
}

/** 230 words a minute, rounded up. Nobody wants "0 min read". */
export function readingMinutes(post: BlogPost): number {
  const words = plainText(post).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 230));
}

/**
 * Glossary terms a post actually mentions.
 *
 * Whole words only, case-insensitive. Matching inside words would link "data"
 * inside "database" and turn the body into a mess of false links, which reads
 * as spam to a person and to a search engine.
 */
export function termsMentioned(post: BlogPost): readonly GlossaryTerm[] {
  const text = plainText(post).toLowerCase();
  return GLOSSARY.filter((term) =>
    [term.term, ...term.aliases].some((phrase) => {
      const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`).test(text);
    }),
  );
}

/**
 * Posts related to this one, best first.
 *
 * Scored on shared glossary terms then shared topic, because two posts using
 * the same vocabulary are more use to a reader than two filed under the same
 * heading. Computed rather than curated: a hand-maintained list of related
 * posts is wrong the day after the next post is published.
 */
export function relatedPosts(
  post: BlogPost,
  corpus: readonly BlogPost[],
  limit = 4,
): readonly BlogPost[] {
  const mine = new Set(termsMentioned(post).map((t) => t.slug));

  return corpus
    .filter((other) => other.slug !== post.slug)
    .map((other) => {
      const shared = termsMentioned(other).filter((t) => mine.has(t.slug)).length;
      return { other, score: shared * 2 + (other.topic === post.topic ? 1 : 0) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.other.slug.localeCompare(b.other.slug))
    .slice(0, limit)
    .map((c) => c.other);
}

/**
 * Every internal link a post should carry.
 *
 * Internal linking is most of what on-page SEO is, and this is where the "many
 * links" come from — one per glossary term used, one per related post, the
 * topic hub, and the product pages the subject actually leads to. All derived,
 * so a renamed slug cannot leave a dead link behind.
 */
export function internalLinks(
  post: BlogPost,
  corpus: readonly BlogPost[],
): readonly InternalLink[] {
  const links: InternalLink[] = [
    {
      href: `/blog/topic/${post.topic}`,
      label: TOPIC_DEFINITIONS[post.topic].label,
      context: "More on this topic",
    },
  ];

  for (const term of termsMentioned(post)) {
    links.push({
      href: `/glossary/${term.slug}`,
      label: term.term,
      context: term.short,
    });
  }

  for (const related of relatedPosts(post, corpus)) {
    links.push({ href: `/blog/${related.slug}`, label: related.title, context: related.description });
  }

  for (const cta of CALLS_TO_ACTION[post.topic]) {
    links.push(cta);
  }

  return links;
}

/**
 * Where a reader of each topic most plausibly wants to go next.
 *
 * Per topic rather than the same three buttons everywhere: somebody reading
 * about probate wants the seller journey, and somebody reading about capital
 * stacks does not.
 */
const CALLS_TO_ACTION: Record<Topic, readonly InternalLink[]> = {
  "deal-analysis": [
    { href: "/invest", label: "Buying mandates", context: "What investors on the platform will buy" },
    { href: "/newsletter", label: "The weekly deal teardown", context: "One real deal a week, including the ones we reject" },
  ],
  "seller-guides": [
    { href: "/sell", label: "See what your property would fetch", context: "Four costed routes, in about three minutes" },
    { href: "/glossary/assisted-sale", label: "How an assisted sale works", context: "Usually the highest figure, and the slowest" },
  ],
  finance: [
    { href: "/capital", label: "Funding mandates", context: "What lenders on the platform will fund, and on what terms" },
    { href: "/glossary/bridging-finance", label: "Bridging finance explained", context: "Short-term lending against unmortgageable property" },
  ],
  tax: [
    { href: "/glossary/deal-score", label: "Why the score is computed after tax", context: "A pre-tax appraisal overstates every deal" },
    { href: "/sell", label: "Get the figures for your own property", context: "Every route costed after tax" },
  ],
  regulation: [
    { href: "/glossary/seller-protection", label: "When we block a deal", context: "Checks that stop a transaction rather than warn about it" },
    { href: "/newsletter", label: "Weekly, with the reasoning", context: "Including the deals we turned down and why" },
  ],
  data: [
    { href: "/glossary/price-paid-data", label: "Price Paid Data", context: "Every registered sale since 1995, free" },
    { href: "/glossary/epc-register", label: "The EPC register", context: "Floor area, and when a sale was prepared" },
  ],
};

/* ---------------------------------------------------------------- metadata */

/** Trim to a meta description: one sentence, under 160 characters, no cut words. */
export function metaDescription(text: string, limit = 158): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit).replace(/[,;:]$/, "")}…`;
}

export function canonical(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Article structured data.
 *
 * Returned as a plain object for the page to serialise, so this module stays
 * free of anything framework-shaped and can be asserted in a test.
 */
export function articleJsonLd(
  post: BlogPost,
  baseUrl: string,
  publisher: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: canonical(baseUrl, `/blog/${post.slug}`),
    author: { "@type": "Organization", name: publisher },
    publisher: { "@type": "Organization", name: publisher },
    articleSection: TOPIC_DEFINITIONS[post.topic].label,
    isAccessibleForFree: true,
  };
}

export function breadcrumbJsonLd(
  trail: readonly { readonly name: string; readonly path: string }[],
  baseUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: canonical(baseUrl, crumb.path),
    })),
  };
}

/** FAQPage data, or undefined where the post has no FAQ block to describe. */
export function faqJsonLd(post: BlogPost): Record<string, unknown> | undefined {
  const faq = post.body.find((b) => b.kind === "faq");
  if (faq === undefined || faq.kind !== "faq") return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
