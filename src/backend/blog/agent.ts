import { runDealDirector } from "@shared/domain/director";
import { publicProtectionSummary } from "@shared/domain/protection";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { referTradePartners } from "@shared/domain/partners";
import { gbp, gbpSigned, percent } from "@shared/format";
import { metaDescription, type Block, type BlogPost, type Topic } from "@shared/domain/blog";
import type { CitationKey } from "@shared/domain/citations";
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
    /*
     * The opening, and only the opening.
     *
     * This used to end with a "Why it lands where it does" list built from the
     * whole of `evidence`, which is now said properly further down the post —
     * component by component, with the score each one earned. Two lists of the
     * same reasoning on one page is not thoroughness, it is a reader deciding
     * the page is padded, and it was the same sentences twice.
     */
    const opening = brief.evidence.slice(0, 3);
    const body: Block[] = [
      { kind: "paragraph", text: opening[0] ?? brief.headline },
      ...(opening.length > 1
        ? [{ kind: "paragraph" as const, text: opening.slice(1).join(" ") }]
        : []),
      { kind: "heading", text: "The figures" },
      { kind: "figures", caption: "Computed by the engine, after tax", rows: brief.figures },
    ];

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
  const score = briefing.scored.breakdown.composite;

  /*
   * The title carries the subject.
   *
   * It used to read "A 3-bed in Erdington at £212,000: the full working",
   * which is a description of the page and shares no word with anything the
   * page is about. "Deal Score" is a term this site defines, the post is
   * literally about the score, and a title that names it is the difference
   * between a page competing for its subject and competing for nothing.
   */
  const headline = blocked
    ? `Deal Score ${score}: why we rejected ${property.locality}`
    : `Deal Score ${score}: a ${property.bedrooms}-bed in ${property.locality}`;

  /*
   * What may be said about the protection outcome, and nothing else.
   *
   * Every flag's label used to go straight into the post — on a public page,
   * for a named locality — including "possible capacity concern reported" and
   * "elderly seller combined with a substantial discount". Those are facts
   * about a person, the first is health data, and §20 prohibits publishing a
   * seller's circumstances for exactly this reason. `publicProtectionSummary`
   * is now the only route from a protection outcome to a public surface, and
   * it counts what it withholds rather than pretending there was nothing.
   */
  const protection = publicProtectionSummary(briefing.scored.protection);

  const evidence = [
    briefing.headline,
    ...briefing.reasons,
    ...briefing.scored.redTeam.singleFactorLosses.map(
      (loss) => `It loses money under one stress on its own: ${loss}.`,
    ),
  ];

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
    { label: "Deal Score", value: `${score}/100` },
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

  /*
   * Everything below is appended after the drafter returns.
   *
   * The seam is deliberately narrow: a language model writes the opening
   * paragraphs and nothing else. Every section here is assembled from figures
   * and reasoning the engine produced, so swapping the drafter changes how the
   * post reads and cannot change what it says. It is also most of the length —
   * a post has to cover its subject to compete for it, and the engine already
   * has more to say about a deal than a person would bother to type.
   */

  body.push(
    { kind: "heading", text: "Why does it score what it scores?" },
    {
      kind: "paragraph",
      text: `The Deal Score is nine weighted components computed on profit after tax, never before it. ${briefing.scored.verdictReason}`,
    },
    {
      kind: "list",
      items: briefing.scored.breakdown.components.map(
        (component) => `${component.label} — ${component.score}/100. ${component.rationale}`,
      ),
    },
  );

  const losses = briefing.scored.redTeam.singleFactorLosses;
  body.push(
    { kind: "heading", text: "How does it hold up under stress?" },
    { kind: "paragraph", text: briefing.scored.redTeam.summary },
    losses.length > 0
      ? {
          kind: "list",
          items: losses.map(
            (loss) => `Loses money when this moves on its own: ${loss}.`,
          ),
        }
      : {
          kind: "paragraph",
          text: "No single factor moving on its own takes this deal into a loss. That is the tier that matters — a scenario in which the market falls, the works overrun and the rate rises simultaneously is a real risk and a poor reason to reject an otherwise sound purchase.",
        },
  );

  const rejected = briefing.strategies.rejected;
  if (rejected.length > 0) {
    body.push(
      { kind: "heading", text: "Which strategies were rejected, and why?" },
      {
        kind: "paragraph",
        text: `${briefing.strategies.tested} structures were tested against this property, this seller and this jurisdiction. The rejections carry the information — an investor who is told why a cash purchase fails but an assisted sale clears has learned something reusable.`,
      },
      {
        kind: "list",
        items: rejected.map((result) => `${result.candidate.label} — ${result.reason}`),
      },
    );
  }

  body.push(
    { kind: "heading", text: "The ways out" },
    { kind: "paragraph", text: briefing.exits.summary },
    {
      kind: "figures",
      caption: "Every exit costed against the same purchase, after tax",
      rows: briefing.exits.options.map((option) => ({
        label: option.label,
        value: `${gbpSigned(option.profit)}${option.viable ? "" : " — not viable"}`,
      })),
    },
    {
      kind: "paragraph",
      text: `Capital recycling: ${percent(briefing.recycle.recycledBps, 0)} of the cash deployed comes back on a refinance, leaving ${gbp(briefing.recycle.leftIn)} in the property. ${briefing.recycle.verdict}`,
    },
  );

  /*
   * The stack, always. It is computed for every deal, it is the question a
   * funder actually asks, and it is the section that keeps a quiet deal — one
   * with nothing rejected and nothing flagged — from being a thin post. None
   * of it touches the seller.
   */
  const stack = briefing.stack;
  body.push(
    { kind: "heading", text: "How would it be funded?" },
    {
      kind: "paragraph",
      text: stack.feasible
        ? `The stack closes. ${gbp(stack.requirement)} is required and ${gbp(stack.totalRaised)} is raised across ${stack.layers.length} layer${stack.layers.length === 1 ? "" : "s"}, leaving ${gbp(stack.originatorCash)} for the originator to find in cash.`
        : `The stack does not close on these assumptions. ${gbp(stack.requirement)} is required, ${gbp(stack.totalRaised)} is raised, and the shortfall is ${gbp(stack.shortfall)} — a gap somebody is expected to find is an assumption rather than funding, and it fails at completion rather than at appraisal.`,
    },
    {
      kind: "figures",
      caption: "Every layer, ordered by who is repaid first",
      rows: [
        ...stack.layers.map((layer) => ({ label: layer.label, value: gbp(layer.amount) })),
        { label: "Originator's own cash", value: gbp(stack.originatorCash) },
        { label: "Residual profit after every provider is paid", value: gbpSigned(stack.residualProfit) },
      ],
    },
  );

  if (stack.warnings.length > 0) {
    body.push({ kind: "list", items: [...stack.warnings] });
  }

  body.push(
    { kind: "heading", text: "What would have to change?" },
    {
      kind: "paragraph",
      text: `The walk-away price is computed rather than chosen. On these figures the most that could be paid and still clear the target margin is ${gbp(briefing.maxViablePrice)} — above that the deal does not work at any point, whatever else is negotiated.`,
    },
  );

  /*
   * Not `briefing.gatingActions`.
   *
   * That list is assembled for an operator and it interleaves transaction
   * facts with the remedies for seller-subject flags — "elderly seller
   * combined with a substantial discount", with what to do about it. Published
   * verbatim, as it was, it put a person's circumstances on a public page
   * under a locality heading. The publishable flags carry their own remedies
   * and that is what a reader is entitled to.
   */
  if (protection.publishable.length > 0) {
    body.push({
      kind: "paragraph",
      text: "On the transaction itself, each of the following would have to be done before this could be shown to capital:",
    });
    body.push({
      kind: "list",
      items: protection.publishable.map((flag) => `${flag.label} — ${flag.remedy}`),
    });
  }
  if (protection.withheld > 0) {
    body.push({ kind: "paragraph", text: protection.summary });
  }

  if (blocked) {
    body.push(
      { kind: "heading", text: "The margin was never the problem" },
      {
        kind: "quote",
        text: "A block fails a hard criterion in every buying mandate, and the buyer count for the property becomes zero. The margin does not override it, and no amount of profit does.",
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
      {
        question: "Is the Deal Score computed before or after tax?",
        answer:
          "After. A pre-tax appraisal overstates every deal and overstates marginal ones most, which is exactly where the decision is being made. There is no pre-tax score anywhere on this platform.",
      },
      {
        question: "Could this property still be bought at a different price?",
        answer: `The walk-away price on these figures is ${gbp(briefing.maxViablePrice)}. Below that the deal works; at or above it there is nowhere for a negotiation to go, which is why the figure is computed before the conversation rather than during it.`,
      },
    ],
  });

  /*
   * The answer, and why it is assembled rather than drafted.
   *
   * It is the sentence most likely to be quoted by anything summarising this
   * page, so it is the last place a model should be allowed near. Every figure
   * in it is the engine's.
   */
  const answer = blocked
    ? `This property showed a ${percent(appraisal.marginOnGdvBps, 1)} margin on gross development value and we did not buy it. Seller Protection blocked it, which caps the Deal Score at ${score} and forces a rejection whatever the margin says. The full working is published below, including the figures that make it look attractive.`
    : `A ${property.bedrooms}-bedroom ${property.tenure} ${property.propertyType} in ${property.locality} ${property.postcodeArea}, valued at ${gbp(property.openMarketValue)} and modelled at ${gbp(working.inputs.purchasePrice)} with ${gbp(appraisal.costs.refurbishment)} of works. After every cost and after tax it returns ${gbpSigned(appraisal.profit)}, scoring ${score} out of 100.`;

  const description = metaDescription(
    blocked
      ? `A ${percent(appraisal.marginOnGdvBps, 1)} margin in ${property.locality} that we refused. What Seller Protection found, what the score did, and every figure behind the decision.`
      : `${property.bedrooms}-bed in ${property.locality} ${property.postcodeArea}: ${gbp(property.openMarketValue)} value, ${gbp(appraisal.costs.refurbishment)} of works, ${percent(appraisal.marginOnGdvBps, 1)} margin and a Deal Score of ${score}. Every cost, then the tax.`,
  );

  /*
   * What the post rests on.
   *
   * Every deal breakdown charges a transfer tax and a profit tax, values the
   * property against registered sales, and describes a property that would
   * have to be marketed. Those are the four, and they are the four whatever
   * the deal is — a citation list that varied with the prose would be
   * decoration.
   */
  const citations: CitationKey[] = [
    "stamp-duty",
    "corporation-tax",
    "price-paid-data",
    "material-information",
  ];
  if (blocked) citations.push("dmcc-act");

  const published = record.createdAt;

  return {
    slug,
    title: prose.title,
    description,
    answer,
    topic: "deal-analysis",
    publishedAt: published,
    updatedAt: published,
    body,
    attributions: [`Figures computed by the Lode engine for ${record.reference}.`],
    fromLiveDeal: true,
    citations,
  };
}
