import { runDealDirector } from "@shared/domain/director";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { referTradePartners } from "@shared/domain/partners";
import { gbp, gbpSigned, percent } from "@shared/format";
import { metaDescription, type Block, type BlogPost, type Topic } from "@shared/domain/blog";
import type { DealRecord } from "@backend/store/schema";

/**
 * The blog agent.
 *
 * It writes a post from a deal that actually exists, using the figures the
 * engine actually produced. That is the whole design: a property blog that
 * invents "typical returns of 20%" is doing the thing this product exists to
 * refuse, and a post whose numbers disagree with the Deal Room is worse than no
 * post at all.
 *
 * The split follows the rule the rest of the platform follows — deterministic
 * engines, language models at the edges:
 *
 *   - **The figures are computed.** `runDealDirector()` returns them and the
 *     agent formats them. Nothing here decides a score, a verdict or a tax
 *     number.
 *   - **The prose has a seam.** `Drafter` is the edge. The default
 *     implementation composes from the briefing's own explanations, which are
 *     already written for people — every score component carries a rationale,
 *     every rejected strategy carries a reason. That means the blog works today
 *     with no API key and no network. An LLM drafter can be dropped in for
 *     better sentences without touching a single figure.
 *
 * When an LLM drafter is wired, posts should be persisted rather than derived
 * per request, because generation stops being reproducible at that point.
 */

export interface DraftBrief {
  readonly slug: string;
  readonly topic: Topic;
  readonly headline: string;
  /** The engine's own sentences, already fit to show a person. */
  readonly evidence: readonly string[];
  readonly figures: readonly { readonly label: string; readonly value: string }[];
}

export interface DraftedProse {
  readonly title: string;
  readonly standfirst: string;
  readonly body: readonly Block[];
}

export interface Drafter {
  readonly name: string;
  draft(brief: DraftBrief): Promise<DraftedProse>;
}

/**
 * The default drafter: no model, no network, no key.
 *
 * It assembles the post from the engine's own reasoning. This is not a
 * placeholder standing in for the real thing — the reasoning strings are
 * written to be read, and a post built from them says something true. An LLM
 * would phrase it better; it would not know anything more.
 */
export const engineDrafter: Drafter = {
  name: "engine",
  async draft(brief: DraftBrief): Promise<DraftedProse> {
    const body: Block[] = [
      { kind: "paragraph", text: brief.evidence[0] ?? brief.headline },
      { kind: "heading", text: "The figures" },
      { kind: "figures", caption: "Computed by the engine, after tax", rows: brief.figures },
    ];

    if (brief.evidence.length > 1) {
      body.push({ kind: "heading", text: "Why it lands where it does" });
      body.push({ kind: "list", items: brief.evidence.slice(1) });
    }

    return {
      title: brief.headline,
      standfirst: brief.evidence[0] ?? brief.headline,
      body,
    };
  },
};

/**
 * A drafter backed by a language model.
 *
 * Fails closed with no key configured, like every other credential here, rather
 * than silently returning nothing. The prompt is given the figures and told
 * explicitly not to invent any — and it could not usefully invent one anyway,
 * because the figures block is assembled after the model returns and overwrites
 * nothing.
 *
 * NOT VERIFIED: no request has been made from the build environment, where
 * outbound access is blocked. `engineDrafter` is the default for that reason.
 */
export function modelDrafter(
  fetchImpl: typeof fetch = fetch,
): Drafter {
  return {
    name: "model",
    async draft(brief: DraftBrief): Promise<DraftedProse> {
      const key = process.env.BLOG_MODEL_API_KEY;
      const url = process.env.BLOG_MODEL_API_URL;
      if (key === undefined || key === "" || url === undefined || url === "") {
        throw new Error("BLOG_MODEL_API_KEY and BLOG_MODEL_API_URL are not configured.");
      }

      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          topic: brief.topic,
          headline: brief.headline,
          evidence: brief.evidence,
          figures: brief.figures,
          instruction:
            "Write two or three short paragraphs for a UK property investment blog. Use only the figures and evidence supplied. Do not invent numbers, returns, or claims about the market. British English.",
        }),
      });
      if (!response.ok) throw new Error(`Drafting model returned ${response.status}`);

      const drafted = (await response.json()) as { paragraphs?: readonly string[] };
      const paragraphs = drafted.paragraphs ?? [];
      if (paragraphs.length === 0) throw new Error("Drafting model returned no prose");

      return {
        title: brief.headline,
        standfirst: paragraphs[0] ?? brief.headline,
        body: [
          ...paragraphs.map((text): Block => ({ kind: "paragraph", text })),
          { kind: "heading", text: "The figures" },
          // Appended after the model returns, so the numbers are the engine's
          // whatever the model wrote.
          { kind: "figures", caption: "Computed by the engine, after tax", rows: brief.figures },
        ],
      };
    },
  };
}

/**
 * Turn one deal into a post.
 *
 * The interesting posts are the rejections. Everybody publishes the deals they
 * did; almost nobody publishes the one with a 24% margin that they refused, and
 * that is the post that says something a reader cannot get elsewhere.
 */
export async function writeDealPost(
  record: DealRecord,
  drafter: Drafter = engineDrafter,
): Promise<BlogPost> {
  const working = toWorkingDeal(record.inputs);
  const briefing = runDealDirector(working.inputs);
  const appraisal = briefing.scored.appraisal;
  const property = record.property;
  const pack = getJurisdiction(property.jurisdiction);
  const blocked = briefing.scored.protection.blocked;

  const headline = blocked
    ? `We turned down a ${percent(appraisal.marginOnGdvBps, 1)} margin in ${property.locality}. Here is why`
    : `A ${property.bedrooms}-bed in ${property.locality} at ${gbp(property.openMarketValue)}: the full working`;

  const evidence = [
    briefing.headline,
    ...briefing.reasons,
    ...briefing.scored.redTeam.singleFactorLosses.map(
      (loss) => `It loses money under one stress on its own: ${loss}.`,
    ),
  ];

  if (blocked) {
    evidence.push(
      ...briefing.scored.protection.flags
        .filter((f) => f.severity === "block")
        .map((f) => `${f.label}. ${f.remedy}`),
    );
  }

  const figures = [
    { label: "Open market value", value: gbp(property.openMarketValue) },
    { label: "Price modelled", value: gbp(working.inputs.purchasePrice) },
    { label: pack.transferTaxLabel, value: gbp(appraisal.costs.transferTax) },
    { label: "Refurbishment", value: gbp(appraisal.costs.refurbishment) },
    { label: "Total deployed", value: gbp(appraisal.effectiveBasis) },
    { label: "Value after works", value: gbp(appraisal.exit.grossDevelopmentValue) },
    { label: "Profit before tax", value: gbpSigned(appraisal.profitBeforeTax) },
    { label: "Profit tax", value: gbp(appraisal.profitTax) },
    { label: "Profit after tax", value: gbpSigned(appraisal.profit) },
    { label: "Margin on GDV", value: percent(appraisal.marginOnGdvBps, 1) },
    { label: "True discount to value", value: percent(appraisal.trueDiscountBps, 1) },
    { label: "Deal Score", value: `${briefing.scored.breakdown.composite}/100` },
  ];

  const slug = `${blocked ? "why-we-rejected" : "deal-breakdown"}-${property.locality
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}-${property.postcodeArea.toLowerCase()}`;

  const prose = await drafter.draft({
    slug,
    topic: "deal-analysis",
    headline,
    evidence,
    figures,
  });

  const partners = referTradePartners(property, record.seller);
  const body: Block[] = [...prose.body];

  if (blocked) {
    body.push(
      { kind: "heading", text: "The margin was never the problem" },
      {
        kind: "quote",
        text: "A block caps the Deal Score at 35 and forces a rejection. It fails a hard criterion in every buying mandate, and the buyer count for the property becomes zero. The margin does not override it, and no amount of profit does.",
      },
    );
  }

  if (partners.referrals.length > 0) {
    // One sentence per referral rather than a concatenation. Splicing a partner
    // name onto a lowercased reason produced "JNseya Construction the figures
    // assume around £18k of works", which is not a sentence.
    body.push({ kind: "heading", text: "Who would do the works" });
    body.push({
      kind: "paragraph",
      text: "The refurbishment line above is an assumption until somebody prices it, and the estimate is what the appraisal should be re-run against.",
    });
    body.push({
      kind: "list",
      items: partners.referrals.map(
        (r) => `${r.partner.name} — ${r.partner.remit.toLowerCase()}. ${r.reasons.join(" ")} ${r.disclosure}`,
      ),
    });
  }

  body.push({
    kind: "faq",
    items: [
      {
        question: "Are these figures real?",
        answer: `Yes. They come from the same engine that produces the Deal Room for this property, computed on profit after ${pack.transferTaxLabel} and profit tax. Tax figures are screening estimates and require professional review.`,
      },
      {
        question: "Why show the deals you turned down?",
        answer:
          "Because the rejections carry the information. Anyone can publish a deal that worked. A platform that refuses its highest-margin opportunity is telling you something about how it decides.",
      },
    ],
  });

  const published = record.createdAt;

  return {
    slug,
    title: prose.title,
    description: metaDescription(prose.standfirst),
    topic: "deal-analysis",
    publishedAt: published,
    updatedAt: published,
    body,
    attributions: [`Figures computed by the Lode engine for ${record.reference}.`],
    fromLiveDeal: true,
  };
}
