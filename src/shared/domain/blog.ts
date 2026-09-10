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

import {
  resolveCitation,
  type CitationKey,
  type CitationLink,
} from "@shared/domain/citations";

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
  {
    slug: "capital-stack",
    term: "capital stack",
    aliases: ["capital stacks", "funding stack"],
    short:
      "Every source of money in a purchase, ordered by who is repaid first and what each layer costs.",
    topic: "finance",
    body: [
      "Senior debt sits at the bottom and is repaid first. Above it sit mezzanine, sponsor equity and whatever is left unfunded, and the gap at the top is the one that closes a deal or kills it a week before completion.",
      "The stack is only sound if each layer's cost is charged against the deal rather than assumed away. Arrangement fees, exit fees, retained interest and the lender's own legal costs are all money the sponsor never sees, and a stack modelled on the face value of the facility overstates what arrives.",
      "A gap the sponsor is expected to find is not funding. It is an assumption, and it fails at completion rather than at appraisal, which is the most expensive point at which to discover it.",
    ],
  },
  {
    slug: "net-advance",
    term: "net advance",
    aliases: ["net advances", "day one advance"],
    short:
      "The cash a lender actually releases at drawdown, after arrangement fees and any interest retained up front.",
    topic: "finance",
    body: [
      "A facility is not a cash sum. Where interest is retained, the lender deducts the whole term's interest at drawdown, so a £200,000 facility over twelve months at a retained rate releases materially less than £200,000 on the day.",
      "The difference is the sponsor's problem, not the lender's. Deriving the cash position from the face value of the debt is the single most common modelling error in refurbishment finance, and it is always discovered at the worst moment.",
      "Every figure downstream — the deposit needed, the works schedule, the contingency — depends on this number rather than on the headline.",
    ],
  },
  {
    slug: "retained-interest",
    term: "retained interest",
    aliases: ["rolled-up interest", "retained interest facility"],
    short:
      "Interest deducted at drawdown for the whole term rather than paid monthly, which reduces the cash released.",
    topic: "finance",
    body: [
      "Retention suits a borrower with no rental income during the works, because there is nothing to service. It is not free: the interest is charged on the full facility for the full term whether or not the project runs to time.",
      "An early exit does not always refund it. Whether unused retained interest is rebated is a term of the facility, and it is worth reading before comparing two lenders on headline rate alone.",
    ],
  },
  {
    slug: "loan-to-gdv",
    term: "loan to GDV",
    aliases: ["LTGDV", "loan to gross development value"],
    short:
      "Total debt measured against the finished value rather than the purchase price, which is how a development lender sizes risk.",
    topic: "finance",
    body: [
      "Loan to value against the purchase price flatters a refurbishment purchase, because the purchase price is the low point. Loan to GDV asks the question the lender is actually asking: if this is sold at the end, does the sale repay the debt?",
      "A deal at 70% loan to value on the purchase can be at 65% loan to GDV or at 90%, depending entirely on whether the works estimate is real.",
    ],
  },
  {
    slug: "capital-recycling",
    term: "capital recycling",
    aliases: ["capital recycled", "recycled capital"],
    short:
      "How much of the cash put into a deal comes back out on exit, and how much stays trapped in the property.",
    topic: "deal-analysis",
    body: [
      "A deal returning 100% of deployed cash lets the same money do the next one. A deal returning 68% means a third of it is stuck, and the next purchase needs new money rather than the same money again.",
      "It is the figure that separates a portfolio that compounds from one that stalls at four properties, and it is invisible in any appraisal that stops at profit.",
    ],
  },
  {
    slug: "red-team",
    term: "Red Team",
    aliases: ["red teaming", "stress test", "stress testing"],
    short:
      "Nine stress scenarios run against every deal, with single-factor losses treated more seriously than compound ones.",
    topic: "deal-analysis",
    body: [
      "The scenarios move one thing at a time — the end value, the works cost, the interest rate, the time to sell — and then move several together. A deal that loses money when one variable moves is fragile; a deal that only loses money when four move together is not, and treating those two identically is how a scoring system becomes useless.",
      "Only single-factor losses cap the score. A compound scenario in which the market falls, the works overrun and the rate rises simultaneously is a real risk and a bad reason to reject an otherwise sound purchase.",
    ],
  },
  {
    slug: "exit-matrix",
    term: "exit matrix",
    aliases: ["exit options", "exit optionality"],
    short:
      "Every way out of a property costed side by side: sell, refinance and hold, rent, or assign the contract.",
    topic: "deal-analysis",
    body: [
      "A deal with one exit is a bet on that exit. A deal with three is a position, and the difference shows up when the first one closes — which it does, regularly, and never with notice.",
      "The matrix is costed after tax, because the exits are taxed differently and comparing them before tax reverses the ordering more often than people expect.",
    ],
  },
  {
    slug: "completion-probability",
    term: "completion probability",
    aliases: ["probability of completion", "fall-through risk"],
    short:
      "The chance a transaction actually completes, derived from the chain, the tenure, the finance and what the seller needs.",
    topic: "deal-analysis",
    body: [
      "Roughly a third of agreed sales in England and Wales fall through. An appraisal that treats completion as certain is pricing a different transaction from the one being entered into.",
      "The inputs are unglamorous and decisive: whether there is a chain, whether the title is registered, whether the buyer's money is evidenced, and whether the seller can actually sell — which is where transactions fail far more often than on price.",
    ],
  },
  {
    slug: "buyer-readiness-passport",
    term: "Buyer Readiness Passport",
    aliases: ["buyer passport", "readiness grade"],
    short:
      "A buyer's identity and funding evidence, graded A to D, deciding whether they may be put in front of a seller at all.",
    topic: "regulation",
    body: [
      "Grade A is proceedable: identity verified, screened, funds evidenced in full, and a solicitor instructed or a purchase already completed. Grade B is funded subject to something. Neither C nor D reaches a seller.",
      "Grade C is the one that matters. It means we know exactly who somebody is and nothing whatever about their ability to pay, and it is the grade that looks most like readiness while being furthest from it.",
      "Identity evidence lapses after twelve months and proof of funds after three, because a bank statement from last year proves what was true last year.",
    ],
  },
  {
    slug: "material-information",
    term: "material information",
    aliases: ["material information parts a b and c"],
    short:
      "The facts that must be published about a property before it is marketed, in three parts, with unanswered treated as an answer.",
    topic: "regulation",
    body: [
      "Part A applies to every property: price, tenure, council tax band, and so on. Parts B and C apply where relevant — rights of way, flood history, restrictive covenants, mining, cladding.",
      "The state that matters is the third one. A question has three answers, not two: stated, not applicable, and not known — with a record of who was asked. A buyer cannot tell 'no covenants' from 'nobody looked', and publishing the second as the first is a misleading omission.",
      "An unanswered Part A question stops the property being marketed at all.",
    ],
  },
  {
    slug: "customer-due-diligence",
    term: "customer due diligence",
    aliases: ["CDD", "know your customer", "KYC"],
    short:
      "Identifying and verifying who you are transacting with, and who is behind them, before the transaction proceeds.",
    topic: "regulation",
    body: [
      "It asks three separate questions and conflating them is the usual mistake: who is this person, may they actually sell this property, and who stands behind them.",
      "The middle question is where transactions fail. The person on the telephone is very often not the registered proprietor, and an executor, an attorney and a company director each need entirely different evidence of their authority.",
      "Nothing recorded means unchecked. It never means no concerns.",
    ],
  },
  {
    slug: "financial-promotion",
    term: "financial promotion",
    aliases: ["financial promotions", "inducement to invest"],
    short:
      "An invitation or inducement to engage in investment activity, which only an authorised person may communicate or approve.",
    topic: "regulation",
    body: [
      "A price, a cost and a discount describe a property. A margin, a yield and a return on cash describe what an investor would make from it, and publishing the second to the public is a different act in law from publishing the first.",
      "Direct purchase of land is not itself a controlled investment, which is why the line is drawn where it is: a worked example labelled as an illustration is not a statement that opportunities are available at a given return.",
      "Getting it wrong is a criminal offence rather than a regulatory tidy-up, which is why the honest response to uncertainty is to withhold the figure and say why.",
    ],
  },
  {
    slug: "beneficial-owner",
    term: "beneficial owner",
    aliases: ["beneficial owners", "person with significant control"],
    short:
      "Whoever ultimately owns or controls an entity, identified from 25% ownership or voting rights upward.",
    topic: "regulation",
    body: [
      "A company selling a property is not a person, and identifying the director who signed is not identifying the customer. The obligation runs to whoever is behind the entity.",
      "Twenty-five per cent is the threshold in the Regulations. Where no individual meets it, the senior managing official is identified instead — a fallback, not an equivalent, and it should be recorded as the fallback it is.",
    ],
  },
  {
    slug: "refinance-window",
    term: "refinance window",
    aliases: ["refinance windows", "term end"],
    short:
      "The period in which a short-term facility must be refinanced or repaid, computed from completion and the facility term.",
    topic: "finance",
    body: [
      "A property is seasoned at six months, which is when most lenders will refinance at the improved value rather than the purchase price. The window becomes urgent ninety days before the term ends.",
      "What kills a refurbishment is almost never the interest rate. It is arriving at the term end with no exit arranged, at which point the options are an extension fee, a forced sale, or the lender taking it.",
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
  /**
   * The answer to the question the title asks, in two or three sentences,
   * before any preamble.
   *
   * A field rather than a block, because there must be exactly one and it must
   * come first, and a block could be absent, duplicated or buried. An answer
   * engine quoting this page will quote something; this decides what. It is
   * also what a reader who bounced in from a search result reads before
   * deciding whether to stay, so the two audiences want the same thing.
   */
  readonly answer: string;
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
  /**
   * The primary sources this post rests on.
   *
   * Keys rather than URLs, resolved through `citations.ts`, on the same rule
   * that governs internal links: nothing here is a typed address. A post that
   * asserts what the law requires and cites nothing is an opinion, and both a
   * reader and a model reading this page are entitled to check it.
   */
  readonly citations: readonly CitationKey[];
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
  // The answer is the first thing on the page and the thing most likely to be
  // quoted, so it counts as body text everywhere — word count, term detection
  // and reading time alike. Excluding it would let a post pass a length check
  // on prose a reader never reaches.
  return [post.answer, ...post.body
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
    })].join(" ");
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

/**
 * The primary sources a post rests on, resolved to something renderable.
 *
 * Outbound links are the half of the link graph a site cannot fake. A page
 * that cites the section of the Act it is describing is a page an answer
 * engine can check, and checkability is most of why one source gets quoted and
 * another gets paraphrased without attribution.
 */
export function externalCitations(post: BlogPost): readonly CitationLink[] {
  return post.citations.map(resolveCitation);
}

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
  corpus: readonly BlogPost[] = [],
): Record<string, unknown> {
  const url = canonical(baseUrl, `/blog/${post.slug}`);
  const terms = termsMentioned(post);
  const sources = externalCitations(post);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: post.title,
    description: post.description,
    // The answer, verbatim. `abstract` is the field a consumer reads when it
    // wants the claim rather than the article, and giving it the same sentence
    // the page opens with means the quoted version and the rendered version
    // cannot differ.
    abstract: post.answer,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    inLanguage: "en-GB",
    author: { "@type": "Organization", name: publisher, url: baseUrl },
    publisher: { "@type": "Organization", "@id": `${baseUrl}#organization`, name: publisher },
    articleSection: TOPIC_DEFINITIONS[post.topic].label,
    isAccessibleForFree: true,
    wordCount: plainText(post).trim().split(/\s+/).length,
    // The entity graph. `about` is what the piece is on, `mentions` what it
    // touches — both pointing at definitions on this site with stable
    // addresses, which is how a term in a sentence becomes a thing a machine
    // can resolve rather than a word it has to guess at.
    ...(terms.length > 0
      ? {
          about: terms.slice(0, 3).map((term) => definedTermRef(term, baseUrl)),
          mentions: terms.map((term) => definedTermRef(term, baseUrl)),
        }
      : {}),
    ...(sources.length > 0
      ? {
          citation: sources.map((source) => ({
            "@type": "CreativeWork",
            name: source.title,
            url: source.url,
            publisher: { "@type": "Organization", name: source.publisher },
          })),
        }
      : {}),
    ...(corpus.length > 0
      ? {
          isPartOf: { "@type": "Blog", "@id": `${canonical(baseUrl, "/blog")}#blog`, name: publisher },
        }
      : {}),
    // The answer and the headline, marked as the passage worth reading aloud.
    // Google treats speakable as a hint on news; its wider value is that it
    // says, unambiguously and in a place a machine looks, which part of this
    // page is the answer.
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", "[data-answer]"],
    },
  };
}

/** A reference to a defined term, by the id the glossary page publishes. */
function definedTermRef(term: GlossaryTerm, baseUrl: string): Record<string, unknown> {
  return {
    "@type": "DefinedTerm",
    "@id": `${canonical(baseUrl, `/glossary/${term.slug}`)}#term`,
    name: term.term,
    description: term.short,
    url: canonical(baseUrl, `/glossary/${term.slug}`),
    inDefinedTermSet: `${canonical(baseUrl, "/glossary")}#glossary`,
  };
}

/**
 * The glossary as a DefinedTermSet.
 *
 * The most under-used piece of schema there is, and the one that fits this
 * site exactly: a set of terms with stable addresses, each one referenced from
 * every post that uses it. That is an entity graph rather than a keyword list,
 * and it is the difference between a model knowing this site *discusses* true
 * discount and knowing it *defines* it.
 */
export function definedTermSetJsonLd(baseUrl: string, name: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": `${canonical(baseUrl, "/glossary")}#glossary`,
    name,
    url: canonical(baseUrl, "/glossary"),
    inLanguage: "en-GB",
    hasDefinedTerm: GLOSSARY.map((term) => definedTermRef(term, baseUrl)),
  };
}

/** One term, with its full definition, for its own page. */
export function definedTermJsonLd(
  term: GlossaryTerm,
  baseUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    "@id": `${canonical(baseUrl, `/glossary/${term.slug}`)}#term`,
    name: term.term,
    alternateName: [...term.aliases],
    description: term.body.join(" "),
    url: canonical(baseUrl, `/glossary/${term.slug}`),
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      "@id": `${canonical(baseUrl, "/glossary")}#glossary`,
      url: canonical(baseUrl, "/glossary"),
    },
  };
}

/**
 * The organisation and the site, once, with stable ids everything else points at.
 *
 * Every Article names its publisher by `@id` rather than repeating a name, so
 * a consumer assembling the graph gets one organisation with many articles
 * instead of many organisations that happen to share a string.
 */
export function organizationJsonLd(input: {
  readonly baseUrl: string;
  readonly name: string;
  readonly legalName?: string;
  readonly companyNumber?: string;
  readonly registeredOffice?: string;
  readonly email?: string;
  readonly description: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${input.baseUrl}#organization`,
    name: input.name,
    url: input.baseUrl,
    description: input.description,
    // Only what has been recorded. A structured-data block is a statement of
    // identity like any other, and an invented registration number in it is a
    // false statement rather than a missing one.
    ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
    ...(input.companyNumber !== undefined
      ? {
          identifier: {
            "@type": "PropertyValue",
            propertyID: "GB-COH",
            value: input.companyNumber,
          },
        }
      : {}),
    ...(input.registeredOffice !== undefined
      ? { address: { "@type": "PostalAddress", streetAddress: input.registeredOffice } }
      : {}),
    ...(input.email !== undefined
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: input.email,
          },
        }
      : {}),
    knowsAbout: GLOSSARY.map((term) => term.term),
  };
}

export function websiteJsonLd(input: {
  readonly baseUrl: string;
  readonly name: string;
  readonly description: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${input.baseUrl}#website`,
    name: input.name,
    url: input.baseUrl,
    description: input.description,
    inLanguage: "en-GB",
    publisher: { "@id": `${input.baseUrl}#organization` },
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

/* ----------------------------------------------------- machine-readable */

/**
 * The post as Markdown.
 *
 * Served alongside the HTML for anything reading this site as a source rather
 * than rendering it: an answer engine's crawler, an agent following a link, a
 * person pasting it into a model. HTML is a layout; this is the content, with
 * the link graph intact as real addresses rather than as relative hrefs a
 * consumer has to resolve against a base it may not have kept.
 *
 * Deterministic and derived — there is no second copy of a post to fall out of
 * date with the first.
 */
export function postMarkdown(
  post: BlogPost,
  corpus: readonly BlogPost[],
  baseUrl: string,
): string {
  const url = canonical(baseUrl, `/blog/${post.slug}`);
  const lines: string[] = [
    `# ${post.title}`,
    "",
    `> ${post.answer}`,
    "",
    `- Source: ${url}`,
    `- Topic: ${TOPIC_DEFINITIONS[post.topic].label}`,
    `- Published: ${post.publishedAt.slice(0, 10)}`,
    `- Updated: ${post.updatedAt.slice(0, 10)}`,
    `- Figures: ${post.fromLiveDeal ? "computed from a live deal on the platform" : "computed from a worked example"}`,
    "",
  ];

  for (const block of post.body) {
    switch (block.kind) {
      case "heading":
        lines.push(`## ${block.text}`, "");
        break;
      case "paragraph":
        lines.push(block.text, "");
        break;
      case "quote":
        lines.push(`> ${block.text}`, "");
        break;
      case "list":
        for (const item of block.items) lines.push(`- ${item}`);
        lines.push("");
        break;
      case "figures":
        lines.push(`### ${block.caption}`, "", "| | |", "| --- | --- |");
        for (const row of block.rows) lines.push(`| ${row.label} | ${row.value} |`);
        lines.push("");
        break;
      case "faq":
        lines.push("## Common questions", "");
        for (const item of block.items) lines.push(`### ${item.question}`, "", item.answer, "");
        break;
    }
  }

  const terms = termsMentioned(post);
  if (terms.length > 0) {
    lines.push("## Terms used", "");
    for (const term of terms) {
      lines.push(`- [${term.term}](${canonical(baseUrl, `/glossary/${term.slug}`)}) — ${term.short}`);
    }
    lines.push("");
  }

  const sources = externalCitations(post);
  if (sources.length > 0) {
    lines.push("## Sources", "");
    for (const source of sources) {
      const kind = source.direct ? "" : " (publisher's site; search the title there)";
      lines.push(`- [${source.title}](${source.url}) — ${source.publisher}${kind}. ${source.establishes}`);
    }
    lines.push("");
  }

  const related = relatedPosts(post, corpus);
  if (related.length > 0) {
    lines.push("## Related", "");
    for (const other of related) {
      lines.push(`- [${other.title}](${canonical(baseUrl, `/blog/${other.slug}`)}) — ${other.description}`);
    }
    lines.push("");
  }

  for (const line of post.attributions) lines.push(`_${line}_`, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * `llms.txt`: the site, described for something that reads rather than renders.
 *
 * A convention rather than a standard, and cheap enough that its uncertain
 * future is not a reason to skip it — it is a Markdown index of what is here
 * and where the canonical text of each piece lives. Computed from the corpus,
 * so a post that exists is listed and a post that is deleted is not.
 */
export function llmsTxt(
  corpus: readonly BlogPost[],
  baseUrl: string,
  siteName: string,
  summary: string,
): string {
  const lines: string[] = [`# ${siteName}`, "", `> ${summary}`, ""];

  lines.push(
    "Every figure published on this site is computed by the same engine that produces the",
    "product itself, on profit after tax, and each page says which deal or worked example it",
    "came from. Where a figure would be an inducement to invest rather than a fact about a",
    "property, it is withheld and the page says why.",
    "",
  );

  lines.push("## Writing", "");
  for (const post of corpus) {
    lines.push(
      `- [${post.title}](${canonical(baseUrl, `/blog/${post.slug}/index.md`)}): ${post.description}`,
    );
  }

  lines.push("", "## Definitions", "");
  for (const term of GLOSSARY) {
    lines.push(`- [${term.term}](${canonical(baseUrl, `/glossary/${term.slug}`)}): ${term.short}`);
  }

  lines.push("", "## Topics", "");
  for (const topic of TOPICS) {
    const definition = TOPIC_DEFINITIONS[topic];
    lines.push(
      `- [${definition.label}](${canonical(baseUrl, `/blog/topic/${topic}`)}): ${definition.description}`,
    );
  }

  lines.push("", "## Optional", "");
  lines.push(
    `- [Free appraisal](${canonical(baseUrl, "/appraise")}): every cost, the tax and the stress tests on figures you supply. No account.`,
    `- [Seller routes](${canonical(baseUrl, "/sell")}): four costed ways out of a property, with what each gives up.`,
  );

  return `${lines.join("\n")}\n`;
}
