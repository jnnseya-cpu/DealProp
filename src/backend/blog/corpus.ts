import { appraise } from "@shared/domain/economics";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { UK_INVESTOR_CATEGORISATION } from "@shared/domain/jurisdictions/uk-financial-promotion";
import { fromMajor, pct } from "@shared/money";
import { gbp, gbpSigned, percent } from "@shared/format";
import { metaDescription, type BlogPost } from "@shared/domain/blog";
import type { DealInputs } from "@shared/domain/types";
import { listDeals } from "@backend/store/repository";
import type { DealRecord } from "@backend/store/schema";
import { engineDrafter, writeDealPost, type Drafter } from "@backend/blog/agent";

/**
 * The corpus.
 *
 * Two kinds of post, and the reader is told which is which:
 *
 *  - **Deal breakdowns**, written by the agent from deals that exist. These
 *    change as the pipeline changes, and the rejections are the ones worth
 *    publishing.
 *  - **Evergreen explainers**, whose worked examples are computed here rather
 *    than typed. "Stamp duty on a £212,000 second property" is a figure the
 *    jurisdiction pack knows; writing it into prose by hand is how a blog ends
 *    up quoting a rate that changed two budgets ago.
 *
 * Derived per request rather than stored, which is correct while the drafter is
 * deterministic — the same deal always yields the same post. Wiring a language
 * model breaks that property, and posts should be persisted at that point.
 */

/** A worked example, computed rather than asserted. */
function stampDutyExample(): {
  price: ReturnType<typeof fromMajor>;
  company: string;
  individual: string;
  scotland: string;
} {
  const price = fromMajor(212_000);
  const england = getJurisdiction("GB-ENG");
  const scotland = getJurisdiction("GB-SCT");
  const base = {
    price,
    isResidential: true,
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
  };
  return {
    price,
    company: gbp(england.transferTax(base)),
    individual: gbp(
      england.transferTax({ ...base, buyerIsCompany: false, buyerOwnsOtherProperty: false }),
    ),
    scotland: gbp(scotland.transferTax(base)),
  };
}

/** The true-discount worked example, straight through the appraisal. */
function trueDiscountExample(): {
  headline: string;
  actual: string;
  deployed: string;
  profit: string;
} {
  const property = {
    id: "example",
    jurisdiction: "GB-ENG" as const,
    postcodeArea: "B23",
    locality: "Erdington",
    propertyType: "house" as const,
    tenure: "freehold" as const,
    bedrooms: 3,
    occupancy: "vacant" as const,
    openMarketValue: fromMajor(212_000),
    valuationConfidence: pct(80),
    refurbishmentEstimate: fromMajor(34_000),
    postWorksValue: fromMajor(285_000),
    monthlyRent: fromMajor(1_250),
    knownIssues: [],
  };
  const inputs: DealInputs = {
    property,
    seller: { situation: "probate", priorities: ["speed"] },
    purchasePrice: fromMajor(170_000),
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: "cash-purchase",
    finance: {
      ltvBps: pct(0),
      refurbAdvanceBps: pct(0),
      annualRateBps: pct(0),
      arrangementFeeBps: pct(0),
      exitFeeBps: pct(0),
      interestRolledUp: false,
      lenderCosts: fromMajor(0),
    },
    exit: "sell",
  };
  const appraisal = appraise(inputs);
  return {
    headline: percent(appraisal.discountToOmvBps, 1),
    actual: percent(appraisal.trueDiscountBps, 1),
    deployed: gbp(appraisal.effectiveBasis),
    profit: gbpSigned(appraisal.profit),
  };
}

const PUBLISHED = "2026-08-01T09:00:00.000Z";

function evergreen(): readonly BlogPost[] {
  const sdlt = stampDutyExample();
  const discount = trueDiscountExample();
  const rules = UK_INVESTOR_CATEGORISATION;

  return [
    {
      slug: "true-discount-versus-below-market-value",
      title: "Twenty per cent below market value is not a twenty per cent discount",
      description: metaDescription(
        "The headline discount ignores stamp duty, finance, works and selling costs. True discount counts all of it, and it is almost always worse.",
      ),
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      attributions: ["Worked example computed by the Lode appraisal engine."],
      body: [
        {
          kind: "paragraph",
          text: "Below-market-value is the most quoted number in property sourcing and the least useful one. It measures the gap between what you paid and what the property is worth, and stops there — as though buying were the only thing that costs money.",
        },
        {
          kind: "heading",
          text: "A worked example, computed rather than asserted",
        },
        {
          kind: "paragraph",
          text: `Take a three-bedroom freehold house in Erdington worth ${gbp(fromMajor(212_000))}, bought by a company at ${gbp(fromMajor(170_000))} with ${gbp(fromMajor(34_000))} of works. The headline discount is ${discount.headline}.`,
        },
        {
          kind: "figures",
          caption: "The same purchase, counted two ways",
          rows: [
            { label: "Headline discount to open market value", value: discount.headline },
            { label: "Total money actually deployed", value: discount.deployed },
            { label: "True discount to value", value: discount.actual },
            { label: "Profit after tax on a sale", value: discount.profit },
          ],
        },
        {
          kind: "paragraph",
          text: "Nothing was hidden to produce that gap. It is stamp duty at the company rate, legal fees, a survey, holding costs across the works, selling costs at the end, and a contingency — every one of them ordinary, and together large enough to move the answer.",
        },
        {
          kind: "heading",
          text: "Why it matters more on the deals you are unsure about",
        },
        {
          kind: "paragraph",
          text: "On an obviously good deal the difference is academic. On a marginal one it decides the outcome, and marginal deals are where the decision is actually being made. A true discount that comes out negative means you have deployed more than the property is worth, and the headline number will still be reassuring you.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "What is included in true discount?",
              answer:
                "Every pound deployed: purchase price, transfer tax, legal and survey fees, finance arrangement and interest, holding costs, selling costs and contingency, measured against open market value.",
            },
            {
              question: "Can true discount be negative?",
              answer:
                "Yes, and it frequently is on a property bought visibly below market. A negative figure means the total deployed exceeds the property's open market value.",
            },
          ],
        },
      ],
    },

    {
      slug: "stamp-duty-on-a-second-property-through-a-company",
      title: "What stamp duty actually costs a company buying a £212,000 house",
      description: metaDescription(
        "The additional dwelling surcharge applies from the first pound for a company, and Scotland charges a different rate entirely. The figures, computed.",
      ),
      topic: "tax",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      attributions: [
        `Rates as encoded for ${getJurisdiction("GB-ENG").name}, as of ${getJurisdiction("GB-ENG").asOf}, and ${getJurisdiction("GB-SCT").name}, as of ${getJurisdiction("GB-SCT").asOf}.`,
      ],
      body: [
        {
          kind: "paragraph",
          text: "Transfer tax is the largest single cost after the property and the works, and it is the one most often modelled at the wrong rate. An individual buying their only home pays one figure; a company buying the same house pays a materially larger one, from the first pound.",
        },
        {
          kind: "figures",
          caption: `The same ${gbp(sdlt.price)} house, three buyers`,
          rows: [
            { label: "Individual, no other property (England)", value: sdlt.individual },
            { label: "Company, additional dwelling (England)", value: sdlt.company },
            { label: "Company, additional dwelling (Scotland, LBTT)", value: sdlt.scotland },
          ],
        },
        {
          kind: "paragraph",
          text: "Scotland is not England with a different name. Land and Buildings Transaction Tax has its own bands, its own Additional Dwelling Supplement at a different rate, and no non-resident surcharge. Modelling a Scottish purchase with English rates produces a plausible number that is simply wrong.",
        },
        {
          kind: "heading",
          text: "Why the score is computed after tax",
        },
        {
          kind: "paragraph",
          text: "Transfer tax is paid on the way in and profit tax on the way out, and a deal appraised before either is a brochure. A pre-tax appraisal overstates every deal and overstates the marginal ones most, which is exactly where somebody is trying to decide.",
        },
        {
          kind: "quote",
          text: "Rate tables are dated snapshots and will go stale. A silent rate change is the most dangerous failure in this system, because every downstream number stays plausible.",
        },
      ],
    },

    {
      slug: "what-open-property-data-tells-you-before-a-listing",
      title: "What the public record tells you about a house nobody has listed",
      description: metaDescription(
        "Price Paid Data and the EPC register are free and licensed for reuse. Together they identify motivated owners without touching a portal.",
      ),
      topic: "data",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      attributions: [
        "Contains HM Land Registry data © Crown copyright and database right",
        "Contains EPC data © Crown copyright",
      ],
      body: [
        {
          kind: "paragraph",
          text: "Most tools that claim to find motivated sellers are reading portal listings: days on market, price reductions, relists. The portals prohibit that, and the data was only ever a proxy for something else.",
        },
        {
          kind: "heading",
          text: "The proxies, and what they were standing in for",
        },
        {
          kind: "list",
          items: [
            "Relist count was standing in for a sale that was prepared and failed. An EPC is a legal precondition of marketing, so a certificate lodged eighteen months ago with no sale registered since says the same thing, from a free and licensed source.",
            "Days on market was standing in for motivation. Years since the last recorded sale says more: long ownership means accumulated equity, which is what makes a below-market price acceptable to a seller rather than impossible for them.",
            "Bedroom count was standing in for size, badly. The EPC register publishes floor area, and a three-bedroom terrace can be 70 square metres or 110 — which is the entire margin.",
            "Nothing on a portal tells you the owner is a company in liquidation. Companies House does, for free.",
          ],
        },
        {
          kind: "heading",
          text: "One signal with a statutory deadline behind it",
        },
        {
          kind: "paragraph",
          text: "Since April 2023 it has been unlawful to continue letting a domestic property in England or Wales rated F or G. A landlord holding one must spend money on it or stop letting it. That is not a soft indicator of motivation; it is a decision with a date attached, and the rating is published.",
        },
        {
          kind: "paragraph",
          text: "It does not apply in Scotland or Northern Ireland, and treating it as though it does would flag compliant landlords there as forced sellers.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Is Price Paid Data free to use commercially?",
              answer:
                "Yes, under the Open Government Licence, with attribution. The EPC register is also free but requires registration, and its licence permits display rather than onward redistribution.",
            },
            {
              question: "Why not just scrape the portals?",
              answer:
                "Their terms prohibit it, and property data carries licensing and data-protection obligations on top. Use requires a commercial agreement with the portal or a licensed reseller.",
            },
          ],
        },
      ],
    },

    {
      slug: "selling-a-house-that-needs-work",
      title: "Selling a house that needs work: what each route actually pays",
      description: metaDescription(
        "Cash purchase, part now and part later, or an assisted sale. What each pays, how long it takes, and what you give up.",
      ),
      topic: "seller-guides",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      attributions: ["Route economics computed by the Lode seller-routes engine."],
      body: [
        {
          kind: "paragraph",
          text: "A house needing serious work has a smaller market than it looks. Most buyers need a mortgage, and a lender will not advance against a property without a working kitchen or bathroom. That leaves cash buyers and bridging-funded buyers, and both price the risk they are taking on.",
        },
        {
          kind: "heading",
          text: "The trade-off is never only about price",
        },
        {
          kind: "list",
          items: [
            "A fast cash purchase pays least and completes quickest. You are being paid for speed and certainty, not for the property's full open-market value.",
            "Part now and the rest later usually pays more, and completes on a longer timetable. The balance depends on the buyer performing.",
            "An assisted sale usually produces the highest figure. You keep ownership while a partner funds and manages the works, and you are paid from the proceeds when it sells — so the figure depends on the works estimate being right.",
            "Doing the work yourself is a genuine option and we would rather say so than pretend otherwise.",
          ],
        },
        {
          kind: "paragraph",
          text: "Which is better depends on the problem you came with. If a probate estate needs closing by a date, the highest figure is not the best route. If there is no deadline at all, taking the fastest offer is leaving money behind.",
        },
        {
          kind: "quote",
          text: "Any figure quoted to you should come with what the buyer expects to make on it. If nobody will show you that, ask why.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Will I be offered less because I need to sell quickly?",
              answer:
                "Yes, and it should be stated plainly. A cash buyer taking on the risk of a property in unknown condition prices that risk. What matters is that the discount is explained and that slower routes paying more are offered alongside it.",
            },
            {
              question: "Do I have to sell to get an answer?",
              answer:
                "No. The routes are costed whether or not you proceed, and renovating rather than selling is one of them.",
            },
          ],
        },
      ],
    },

    {
      slug: "why-a-deal-pack-is-a-financial-promotion",
      title: "Why sending you a deal pack is a regulated act",
      description: metaDescription(
        "An investment invitation must be made or approved by an authorised person, or fall in an exemption. That is why investors certify before receiving anything.",
      ),
      topic: "regulation",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      attributions: [`Categorisation rules as recorded on ${rules.asOf}. ${rules.sources.join("; ")}.`],
      body: [
        {
          kind: "paragraph",
          text: "Section 21 of the Financial Services and Markets Act 2000 restricts inviting or inducing someone to engage in investment activity. Unless the person making the invitation is authorised, or the promotion is approved by somebody who is, it must fall within an exemption. A property deal pack sent to a private investor is such an invitation.",
        },
        {
          kind: "heading",
          text: "The exemptions turn on the investor, not on the platform",
        },
        {
          kind: "paragraph",
          text: "This is why platforms ask investors to certify. The exemptions apply to certified high net worth individuals, self-certified sophisticated investors, certified sophisticated investors and investment professionals — and the certification is a statement the investor makes, in the first person, valid for twelve months.",
        },
        {
          kind: "list",
          items: [
            "An expired certification is not a weaker certification. It is none, and sending on the strength of one is as unlawful as sending to somebody who never certified.",
            "A restricted investor certificate does not cover this. That exemption is written for restricted mass market investments, not for an unregulated property deal.",
            "A certified sophisticated investor certificate is signed by an authorised firm, not by the investor and not by the platform.",
          ],
        },
        {
          kind: "paragraph",
          text: `The thresholds themselves are a moving target. They were raised in 2023 and the change was then announced for reversal, which is why any platform quoting them should tell you the date they were captured — ours are recorded as at ${rules.asOf} and marked as pending verification.`,
        },
        {
          kind: "faq",
          items: [
            {
              question: "Why can I not just see the deals?",
              answer:
                "Because showing them to an uncertified private investor would be an unapproved financial promotion. The certification takes a minute and lasts twelve months.",
            },
            {
              question: "Does certifying make me a professional investor?",
              answer:
                "No. It records which statutory exemption applies to communications sent to you. It is not advice, and it does not change what the investment is.",
            },
          ],
        },
      ],
    },
  ];
}

/**
 * The whole corpus: evergreen explainers plus a post per interesting deal.
 *
 * Blocked deals come first, because those are the posts nobody else writes.
 */
export async function loadCorpus(drafter: Drafter = engineDrafter): Promise<readonly BlogPost[]> {
  // The blog is a public page and the evergreen posts need no database at all.
  // A store that is down or unreachable must cost the reader the deal
  // breakdowns, not the whole site — a marketing page that 500s because the
  // deal database is unreachable is an outage nobody needed to have.
  let records: readonly DealRecord[] = [];
  try {
    records = await listDeals();
  } catch (error) {
    process.stderr.write(`blog: serving evergreen posts only — ${String(error)}\n`);
  }

  const dealPosts: BlogPost[] = [];
  for (const record of records) {
    try {
      dealPosts.push(await writeDealPost(record, drafter));
    } catch {
      // One deal that will not appraise must not take the whole blog down.
      // Skipping is right here: the post is derived content, not the record.
    }
  }

  // Deduplicate by slug — two deals in the same locality would otherwise
  // collide and render twice under one URL.
  const bySlug = new Map<string, BlogPost>();
  for (const post of [...dealPosts, ...evergreen()]) {
    if (!bySlug.has(post.slug)) bySlug.set(post.slug, post);
  }

  return [...bySlug.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function loadPost(slug: string): Promise<BlogPost | undefined> {
  return (await loadCorpus()).find((p) => p.slug === slug);
}
