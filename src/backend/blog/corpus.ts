import { appraise } from "@shared/domain/economics";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { UK_INVESTOR_CATEGORISATION } from "@shared/domain/jurisdictions/uk-financial-promotion";
import { bps, fromMajor, pct } from "@shared/money";
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
      title: "Below market value is not the same as a discount",
      description: metaDescription(
        "The headline discount ignores stamp duty, finance, works and selling costs. True discount counts every pound deployed, and it is almost always worse.",
      ),
      answer:
        "A property bought 20% below market value is not bought at a 20% discount. True discount measures every pound deployed — purchase price, transfer tax, finance, works, holding and selling costs — against open market value. On an ordinary refurbishment purchase the two figures differ by most of the margin, and the true one is frequently negative.",
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["stamp-duty", "additional-dwelling-rates", "corporation-tax", "price-paid-data"],
      attributions: ["Worked example computed by the Lode appraisal engine."],
      body: [
        {
          kind: "paragraph",
          text: "Below-market-value is the most quoted number in property sourcing and the least useful one. It measures the gap between what you paid and what the property is worth, and stops there — as though buying were the only thing that costs money.",
        },
        {
          kind: "heading",
          text: "What does true discount actually count?",
        },
        {
          kind: "paragraph",
          text: "Everything that leaves the bank account before the property can be sold again. Transfer tax at whatever rate the buyer's circumstances attract. Legal fees on the purchase and again on the sale. A survey. Finance arrangement fees, interest across the hold, and an exit fee where the facility has one. The works themselves, and a contingency against the works being wrong. Council tax, insurance and utilities across the void. Selling costs at the end.",
        },
        {
          kind: "paragraph",
          text: "None of that is exotic and none of it is avoidable. It is the ordinary cost of transacting, and the reason a headline discount and a true discount diverge is not that something was hidden — it is that the headline was never measuring the same thing.",
        },
        {
          kind: "heading",
          text: "A worked example, computed rather than asserted",
        },
        {
          kind: "paragraph",
          text: `Take a three-bedroom freehold house in Erdington worth ${gbp(fromMajor(212_000))}, bought by a company at ${gbp(fromMajor(170_000))} with ${gbp(fromMajor(34_000))} of works and a nine-month hold. The headline discount is ${discount.headline}. The figures below come from the same appraisal engine that produces the Deal Room, on the same inputs.`,
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
          text: "The gap between those first and third rows is the entire subject. It is stamp duty at the company rate, legal fees, a survey, holding costs across the works, selling costs at the end, and a contingency — every one of them ordinary, and together large enough to move the answer from comfortable to marginal.",
        },
        {
          kind: "heading",
          text: "Why the gap widens on the deals you are least sure about",
        },
        {
          kind: "paragraph",
          text: "On an obviously good purchase the difference is academic: a property bought at half its value survives any amount of transaction cost. On a marginal one it decides the outcome, and marginal deals are where the decision is actually being made. Nobody needs an appraisal to reject a bad deal or accept a spectacular one.",
        },
        {
          kind: "paragraph",
          text: "The failure mode is specific and it is common. A true discount that comes out negative means more has been deployed than the property is worth, and the headline number will still be reassuring — 20% below market, on a spreadsheet, next to a loss. That is not a rare edge case on properties needing significant work; it is the base case, which is why the works estimate carries a contingency and why the contingency is charged rather than noted.",
        },
        {
          kind: "heading",
          text: "How does finance change the figure?",
        },
        {
          kind: "paragraph",
          text: "Materially, and in both directions. Debt reduces the cash deployed, which improves the return on cash while leaving true discount to value roughly where it was — the money is still spent, it is simply somebody else's. What debt adds is cost: an arrangement fee, interest across the hold, often an exit fee, and the lender's own legal costs charged to the borrower.",
        },
        {
          kind: "paragraph",
          text: "Where interest is retained rather than serviced, the net advance is smaller than the facility, and a model that treats the facility as cash arriving on completion is wrong by the whole of the retained interest. The capital stack has to be costed at what it releases, not at what it says on the offer.",
        },
        {
          kind: "heading",
          text: "What to do with the number",
        },
        {
          kind: "list",
          items: [
            "Compute it before you negotiate, not after. It sets the walk-away price, and a walk-away price computed in the room is a preference rather than a limit.",
            "Charge the contingency into the deployed figure. A contingency held outside the total is a contingency you will spend and never account for.",
            "Recompute it after any change to the works estimate. The works are the input with the widest error bar and the largest effect.",
            "Compare it against local evidence rather than against the asking price. Price Paid Data records what actually completed, which is the only figure that has been tested by a buyer.",
          ],
        },
        {
          kind: "paragraph",
          text: "A number computed this way is duller than a headline discount and it is the one that survives contact with a completion statement. That is the whole argument for it.",
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
                "Yes, and it frequently is on a property bought visibly below market. A negative figure means the total deployed exceeds the property's open market value — you have paid more than it is worth, by the only measure that counts.",
            },
            {
              question: "Is true discount the same as margin?",
              answer:
                "No. True discount compares money deployed against the property's current value. Margin compares profit against the finished value after the works. A deal can show a healthy margin and a poor true discount, and the second is the one that tells you what happens if the works do not go to plan.",
            },
            {
              question: "Does it apply to a buy-to-let purchase?",
              answer:
                "It applies to any purchase, but it matters most where there are works. On a tenanted purchase with no refurbishment the two figures are close, because the transaction costs are the only difference between them.",
            },
          ],
        },
      ],
    },

    {
      slug: "stamp-duty-on-a-second-property-through-a-company",
      title: "Stamp duty and the additional dwelling surcharge",
      description: metaDescription(
        "A company pays the additional dwelling surcharge from the first pound, with no starting threshold. On a typical purchase that is thousands, before anything else is spent.",
      ),
      answer:
        `A company buying a residential property in England pays the higher rates for additional dwellings on the whole price, with no nil-rate starting band. On a ${gbp(sdlt.price)} purchase that is ${sdlt.company}, against ${sdlt.individual} for an individual buying their only home. Scotland charges a different tax at different rates on the same purchase: ${sdlt.scotland}.`,
      topic: "tax",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: [
        "stamp-duty",
        "additional-dwelling-rates",
        "corporation-tax",
        "lbtt-scotland",
        "ltt-wales",
      ],
      attributions: [
        "Computed from the Lode jurisdiction packs, each dated and pinned by test.",
      ],
      body: [
        {
          kind: "paragraph",
          text: "Transfer tax is the first cost of a purchase and the one most often carried in somebody's head at the wrong number. It is not one tax, the rate depends on facts about the buyer rather than about the property, and it changes at budgets rather than on a schedule anybody can plan around.",
        },
        {
          kind: "heading",
          text: "How much stamp duty does a company pay?",
        },
        {
          kind: "paragraph",
          text: `On the same ${gbp(sdlt.price)} house, three buyers pay three different figures. The difference between the first and the second is not a rounding item — it is a deposit.`,
        },
        {
          kind: "figures",
          caption: `Transfer tax on a ${gbp(sdlt.price)} residential purchase`,
          rows: [
            { label: "Company, additional dwelling (England)", value: sdlt.company },
            { label: "Individual, only property (England)", value: sdlt.individual },
            { label: "Company, additional dwelling (Scotland, LBTT)", value: sdlt.scotland },
          ],
        },
        {
          kind: "heading",
          text: "The surcharge starts at the first pound",
        },
        {
          kind: "paragraph",
          text: "This is the part that catches people. An individual buying their only home pays nothing on the first slice of the price. A company buying a residential property does not get that band at all — the additional dwelling surcharge applies to the whole consideration from the first pound, and it is charged on top of the ordinary rates rather than instead of them.",
        },
        {
          kind: "paragraph",
          text: "The effect is largest at the bottom of the market, which is exactly where refurbishment purchases sit. On a cheap terrace the surcharge can be a double-digit percentage of the price, and an appraisal that applied an individual's rates to a company purchase has understated the first cost of the deal by more than the contingency.",
        },
        {
          kind: "heading",
          text: "Scotland and Wales are different taxes, not different rates",
        },
        {
          kind: "paragraph",
          text: "Land and Buildings Transaction Tax in Scotland and Land Transaction Tax in Wales are separate taxes with their own bands, their own supplements and their own legislation. Treating them as Stamp Duty Land Tax with the numbers changed produces the right shape and the wrong answer, and it produces it silently.",
        },
        {
          kind: "paragraph",
          text: "That is why the tax rules on this platform live in per-jurisdiction packs with a dated set of rates and a test pinning each one, and why a jurisdiction with no pack returns not-supported rather than defaulting to England. A default that guesses England is a guess that will be wrong in three of the four UK nations.",
        },
        {
          kind: "heading",
          text: "Does the tax change the deal, or just the deposit?",
        },
        {
          kind: "paragraph",
          text: "Both, and the second is what surprises people. Transfer tax is not lendable — no bridging facility advances against it — so it comes out of the sponsor's own cash on the day. A deal that works on paper at 75% loan to value can still fail to complete because the tax, the legals and the survey together exceed the cash available.",
        },
        {
          kind: "paragraph",
          text: "It also changes the answer at the other end. Profit is taxed as well as the purchase, and a deal scored before tax overstates every outcome — most on the marginal deals, which is where the decision is being made. That is why the Deal Score on this platform is computed after profit tax and never before it.",
        },
        {
          kind: "heading",
          text: "What it means for an appraisal",
        },
        {
          kind: "list",
          items: [
            "State the buyer, not just the property. Company or individual, first property or additional, resident or not — each one moves the figure.",
            "Charge the tax into the deployed total before computing true discount. A tax held to one side is a tax that will be paid and never counted.",
            "Never carry a rate in your head across a budget. Rates move; a pinned, dated rate table is one edit and a memory is a silent error.",
            "Take advice on anything unusual. Multiple dwellings, mixed use, linked transactions and partnership acquisitions all have their own treatment, and none of them is a screening question.",
          ],
        },
        {
          kind: "paragraph",
          text: "The figures on this page are screening estimates produced by an engine against dated rate tables. They are the right order of magnitude for a decision about whether to keep looking at a property. They are not a computation of your liability, and every real transaction needs a professional to confirm it.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Does a company pay the 3% surcharge?",
              answer:
                "A company buying a residential dwelling pays the higher rates for additional dwellings, and it pays them on the whole price with no nil-rate band. The exact supplement is set by legislation and changes at budgets, which is why the figure here is computed from a dated rate table rather than quoted from memory.",
            },
            {
              question: "Is stamp duty an allowable cost against profit?",
              answer:
                "Transfer tax forms part of the acquisition cost rather than a revenue expense, so it reduces the gain on a later disposal rather than the profit in the year of purchase. The treatment differs between a trading company and an investment company, and it is a question for an accountant rather than a calculator.",
            },
            {
              question: "What if the property is uninhabitable?",
              answer:
                "Whether a dilapidated building is residential for transfer-tax purposes is a genuinely contested question with case law behind it, and the answer changes the rate. It is not a screening judgement — a property in that condition needs advice before the figure is relied on.",
            },
            {
              question: "Do the same rates apply in Scotland and Wales?",
              answer:
                "No. Scotland charges Land and Buildings Transaction Tax and Wales charges Land Transaction Tax, each with its own bands and its own supplement for additional dwellings. They are separate taxes, not regional variations of one.",
            },
          ],
        },
      ],
    },

    {
      slug: "what-open-property-data-tells-you-before-a-listing",
      title: "What open property data shows before a listing",
      description: metaDescription(
        "Price Paid Data and the EPC register are free, official and quietly revealing. Together they show which properties were prepared for sale and never sold.",
      ),
      answer:
        "Two free official datasets do most of the work. Price Paid Data records every registered sale in England and Wales since 1995, with the flags that mark a sale as not at arm's length. The EPC register records floor area, construction age and the date each certificate was lodged — and a certificate lodged with no sale registered since is a property somebody prepared to sell that did not sell.",
      topic: "data",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: [
        "price-paid-data",
        "epc-register",
        "house-price-index",
        "land-registration-act",
        "mees-regs",
      ],
      attributions: [
        "Sources are used under their published licences, recorded in the platform's source registry.",
      ],
      body: [
        {
          kind: "paragraph",
          text: "Most of what a sourcing tool sells as proprietary insight is public, free and published by the government. The advantage is not access. It is knowing which fields matter, which records to exclude, and what the absence of a record means.",
        },
        {
          kind: "heading",
          text: "Which datasets are actually free?",
        },
        {
          kind: "figures",
          caption: "The three that carry the most signal",
          rows: [
            { label: "Price Paid Data", value: "Every registered sale since 1995" },
            { label: "Energy Performance of Buildings Register", value: "Floor area, age band, lodgement date" },
            { label: "UK House Price Index", value: "Official movement by local authority" },
          ],
        },
        {
          kind: "paragraph",
          text: "All three are published under open licences and all three are updated on a published schedule. None of them requires a subscription, and none of them is the thing a portal is charging for — a portal sells asking prices, which are the one number in property with no evidential value whatever.",
        },
        {
          kind: "heading",
          text: "What Price Paid Data can and cannot tell you",
        },
        {
          kind: "paragraph",
          text: "It records the price, the date, the postcode, the property type, the tenure and whether the sale was a new build. It also carries a category flag marking transfers that were not at arm's length: repossessions, portfolio sales, transfers between related parties, and sales where the price was not the market price.",
        },
        {
          kind: "paragraph",
          text: "Excluding those matters more than it sounds. Leaving them in a street-level median drags it down, and every deal on that street then looks better than it is. A comparable set built without the exclusion is not conservative — it is systematically optimistic, in the direction that costs money.",
        },
        {
          kind: "paragraph",
          text: "What it cannot tell you is condition. Two identical terraces on the same street, sold in the same month, can differ by forty thousand pounds because one had been rewired and one had not, and the register records neither fact. Price Paid Data sets the range. It does not place a specific property inside it.",
        },
        {
          kind: "paragraph",
          text: "That matters downstream. Open market value is the denominator in true discount, so an error in the comparable set propagates into every figure computed from it — the margin, the Deal Score, and the walk-away price. A range from registered sales, with the non-arm's-length transfers excluded, is the most defensible starting point available for nothing.",
        },
        {
          kind: "heading",
          text: "Why the EPC register is the more useful half",
        },
        {
          kind: "paragraph",
          text: "The rating is the least interesting field on it. The register also publishes total floor area, which converts a price into a price per square metre — and a three-bedroom terrace can be 70 square metres or 110. That difference is the entire margin on a refurbishment purchase, and it is free, and almost nobody uses it.",
        },
        {
          kind: "paragraph",
          text: "It carries construction age band, which predicts the works: solid walls, no cavity, likely rewire, likely damp. It carries the assessor's recommendations, which are a costed list of what the property needs written by somebody who stood in it. And it carries the lodgement date.",
        },
        {
          kind: "heading",
          text: "How do you tell a prepared sale from a live one?",
        },
        {
          kind: "paragraph",
          text: "By joining the two datasets on the date. An EPC is a legal precondition of marketing a residential property, so a certificate exists because somebody intended to sell. If a certificate was lodged eighteen months ago and Price Paid Data records no sale of that address since, something went wrong — the sale fell through, the property failed to attract an offer, or the owner changed their mind.",
        },
        {
          kind: "paragraph",
          text: "That is a signal no portal publishes, because it is defined by the absence of a listing rather than the presence of one. It is also the single most useful thing in either dataset, and it is the reason the two are worth holding together rather than separately.",
        },
        {
          kind: "paragraph",
          text: "For a rented property the register does a second job. An F or a G rating is a compliance problem as well as an energy one, and a landlord holding one faces improving the property or registering an exemption. That is a reason to sell that has a date attached to it.",
        },
        {
          kind: "heading",
          text: "The limits, stated",
        },
        {
          kind: "list",
          items: [
            "Registration lags completion. A sale completed last month may not appear for several months, so recent silence is not evidence of no sale.",
            "The register is not a condition survey. It records what an assessor observed for energy purposes, not what a builder would find.",
            "Neither dataset carries ownership. Who owns a title is a separate register with its own rules, and it is not free at scale.",
            "An address that appears in neither is not an opportunity. It is an address about which nothing is known, which is a different thing.",
            "Both are licensed, and the licence governs what may be done with them. Reading data you have no licence for is a problem created at the moment of taking it, not at the moment of publishing it.",
          ],
        },
        {
          kind: "paragraph",
          text: "Used carefully these datasets narrow a town to a list worth looking at. They do not value a property, they do not tell you whether anybody wants to sell, and treating a derived signal as a decision is how a sourcing business acquires a portfolio of properties nobody wanted for a reason.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Is Price Paid Data free to use commercially?",
              answer:
                "It is published under an open licence that permits commercial use with attribution. The licence terms are the thing to read rather than the summary — and using any dataset without a recorded licence is a decision that is made when you take the data, not when you publish it.",
            },
            {
              question: "How current is the EPC register?",
              answer:
                "Certificates appear after lodgement rather than in real time, and a certificate is valid for ten years. A recent certificate tells you somebody prepared to market the property recently; an old one tells you very little about today.",
            },
            {
              question: "Can you find the owner of a property from open data?",
              answer:
                "Not from these datasets. Ownership sits on the register of title, which is a separate service with its own fees and rules, and a lawful lookup is made against a specific title for a stated purpose rather than by sweeping a postcode.",
            },
            {
              question: "What does an EPC with no subsequent sale actually mean?",
              answer:
                "That somebody took the legally required step to market a property and no registered sale followed. It is a strong signal and not a conclusion — the sale may simply not have registered yet, or the certificate may have been lodged for a letting.",
            },
          ],
        },
      ],
    },

    {
      slug: "selling-a-house-that-needs-work",
      title: "Selling a house that needs work: assisted sale?",
      description: metaDescription(
        "A cash sale, an assisted sale, a deferred structure or an ordinary listing. What each one pays, how long it takes, and what you give up for the speed.",
      ),
      answer:
        "There are four realistic routes and they trade money against certainty. A fast cash purchase pays least and completes in weeks. An assisted sale usually pays most because you keep the uplift from the works, and it is slowest and conditional. A deferred structure sits between them. An ordinary listing may beat all three if the property can be marketed and you can wait.",
      topic: "seller-guides",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: [
        "estate-agents-act-s18",
        "material-information",
        "dmcc-act",
        "consumer-rights-act",
      ],
      attributions: ["Routes and figures computed by the Lode seller-route engine."],
      body: [
        {
          kind: "paragraph",
          text: "A property needing significant work does not fail to sell because it is unattractive. It fails because most buyers cannot borrow against it. A lender will not advance on a house with no kitchen, no working heating or a damp problem in the survey, so the pool shrinks to people buying with cash — and people buying with cash expect to be paid for the certainty they bring.",
        },
        {
          kind: "heading",
          text: "What are the actual options?",
        },
        {
          kind: "figures",
          caption: "The trade being made, route by route",
          rows: [
            { label: "Fast cash purchase", value: "Lowest price, highest certainty, weeks" },
            { label: "Deferred structure", value: "Part now, the rest on sale, months" },
            { label: "Assisted sale", value: "Usually highest, conditional, longest" },
            { label: "Ordinary listing", value: "Market price if it can be marketed at all" },
          ],
        },
        {
          kind: "paragraph",
          text: "Nobody should choose between those on a description. The figure that matters is what each one puts in your hand after costs, and it is different for every property — which is why the routes on this platform are computed against the actual figures rather than described in general terms.",
        },
        {
          kind: "paragraph",
          text: "Certainty is not a feeling either. Roughly a third of agreed sales in England and Wales fall through, so completion probability is part of what you are being offered, and a higher price on a route that is less likely to complete is not obviously the better offer. The material information about the property has to be published before it can be marketed at all, whichever route is chosen — and where a question about it has never been answered, that is published too.",
        },
        {
          kind: "heading",
          text: "Fast cash purchase",
        },
        {
          kind: "paragraph",
          text: "A buyer with funds purchases as it stands, usually in two to four weeks, and takes the whole risk of the works. The discount is not arbitrary: it has to cover the transfer tax, the works, the contingency, the holding costs, the selling costs and a margin for the risk that any of those is wrong. Measured properly — as true discount, against every pound they will deploy rather than against the price alone — the buyer's position is a good deal less generous than the headline reduction suggests. On a property needing thirty thousand pounds of work, that is a large number before anybody has made a penny.",
        },
        {
          kind: "paragraph",
          text: "It is the right route when the certainty is the point — a probate sale with beneficiaries waiting, a repossession date, a property two hundred miles away that nobody can manage.",
        },
        {
          kind: "heading",
          text: "Assisted sale",
        },
        {
          kind: "paragraph",
          text: "You keep ownership. A partner funds and manages the works, the improved property is sold, and you take an agreed sum from the proceeds. Because you are no longer selling the risk of the works, you are not paying the discount that risk commands — which is why an assisted sale usually produces the highest figure of the four.",
        },
        {
          kind: "paragraph",
          text: "The trade is time and conditionality. Money arrives when the improved property sells, not on completion, and the figure depends on the works estimate being right and the finished value being achieved. It needs a written agreement that says what happens if either turns out otherwise, and it needs your own solicitor to read it.",
        },
        {
          kind: "heading",
          text: "Which one pays most, and which one is certain?",
        },
        {
          kind: "paragraph",
          text: "Almost never the same route. That is the honest shape of the answer and it is why a single headline offer tells you nothing useful. The right question is not which number is biggest but which combination of number and date solves the problem you actually have.",
        },
        {
          kind: "paragraph",
          text: "It is also why any offer below market value should arrive alongside what you are giving up for it — including, plainly, that an estate agent would probably get you more if the property can be marketed and you can wait. An offer presented without that comparison is not a worse offer. It is an incomplete one.",
        },
        {
          kind: "heading",
          text: "What must be told to you before you are bound",
        },
        {
          kind: "list",
          items: [
            "Any fee, before you are committed to it. A fee disclosed afterwards is unenforceable without a court's permission, and a business that leaves it late is telling you something.",
            "Whether the buyer is connected to the person advising you, and how each of them is paid.",
            "What happens if the works cost more than estimated, and who carries that.",
            "What happens if you change your mind, and by when.",
            "Whether you are already tied to an agent. Under sole agency or sole selling rights that agent may be owed a fee on a sale whoever introduced the buyer, and a second fee on top means paying twice for one completion.",
          ],
        },
        {
          kind: "paragraph",
          text: "The last one is the one that costs people real money and it is the one nobody asks about. Check your existing agreement, and check the notice period, before signing anything else.",
        },
        {
          kind: "paragraph",
          text: "Take your own legal advice. Not the buyer's solicitor, not a firm the buyer recommends — your own, instructed by you, paid by you and answerable to you. On any structure where you do not receive the whole price on completion, that is not a formality.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Will a cash buyer really complete in two weeks?",
              answer:
                "Sometimes, if the title is registered, there is no chain and the searches are already in hand. Two to four weeks is realistic on a straightforward freehold. Ask what the buyer's funds are and whether they have been evidenced — a buyer who cannot show the money cannot deliver the speed they are charging you for.",
            },
            {
              question: "Do I pay anything to see my options?",
              answer:
                "Not on this platform. Seeing four costed routes is free and there is no obligation attached to it. Any fee that would apply if you went on to sell is stated before you are bound by anything, because that is what the law requires and because a fee somebody discovers later is a complaint.",
            },
            {
              question: "Is an assisted sale safe?",
              answer:
                "It is a legitimate structure and it carries real risk, which is not the same as being unsafe. The risks are that the works cost more than estimated, the finished value is not achieved, or the partner fails to perform. All three are addressable in the agreement, and none of them is addressable afterwards.",
            },
            {
              question: "What if my house has already been on the market and not sold?",
              answer:
                "That is the ordinary starting point here rather than a problem. A long unsold listing usually means the price was set for a buyer who cannot borrow on it, and the useful question is which of the other three routes fits — not another reduction.",
            },
          ],
        },
      ],
    },

    {
      slug: "why-a-deal-pack-is-a-financial-promotion",
      title: "When a deal pack becomes a financial promotion",
      description: metaDescription(
        "Direct property purchase sits outside the perimeter. Package it, share it, or publish a return, and the same pack becomes something only an authorised person may approve.",
      ),
      answer:
        "A deal pack describing a property you buy yourself is not a financial promotion, because land is not a controlled investment. The same pack becomes one as soon as it invites somebody into a structure — shares in a company, a loan note, a joint venture, a share of profit — or publishes a return as an inducement. From that point only an authorised person may communicate or approve it.",
      topic: "regulation",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: [
        "fsma-s21",
        "financial-promotion-order",
        "fca-perg-8",
        "regulated-activities-order",
      ],
      attributions: [
        "Categorisation thresholds computed from the platform's UK financial promotion pack.",
      ],
      body: [
        {
          kind: "paragraph",
          text: "The most common regulatory mistake in property sourcing is not made by people who know they are near a line. It is made by people who do not believe the line applies to them, because what they are selling is a house.",
        },
        {
          kind: "heading",
          text: "What makes a communication a financial promotion?",
        },
        {
          kind: "paragraph",
          text: "Two things together: it is an invitation or inducement to engage in investment activity, and it is made in the course of business. Both halves matter. Material that merely informs is not an inducement; material designed to persuade somebody to put money in is, whatever it is called and whether or not it asks for money directly.",
        },
        {
          kind: "paragraph",
          text: "The consequence is not a fine and a form. Communicating one without authorisation or an exemption is a criminal offence, and an agreement entered into as a result may be unenforceable against the investor — which means they can ask for their money back, and get it.",
        },
        {
          kind: "paragraph",
          text: "It is worth separating this from two things it is often confused with. It is not the same question as customer due diligence, which asks who you are transacting with and is an anti-money-laundering obligation. And it is not the same as material information, which is what must be published about the property itself before it can be marketed. A pack can satisfy both and still be an unlawful promotion.",
        },
        {
          kind: "heading",
          text: "Land is not a controlled investment — until it is packaged",
        },
        {
          kind: "paragraph",
          text: "Buying a house is not investment activity in the regulatory sense. Land itself is not on the list of controlled investments, which is precisely why a deal pack for your own purchase is not a financial promotion and why the property world contains so much material that would be unlawful in any other asset class.",
        },
        {
          kind: "paragraph",
          text: "What changes it is the wrapper. Shares in a special purpose vehicle are a controlled investment. A loan note is a controlled investment. A profit share in somebody else's project is very likely one. The moment the pack invites participation in a structure rather than a purchase, the same document has changed category without changing a word.",
        },
        {
          kind: "paragraph",
          text: "A yield, a margin or a return on cash published to persuade is the other trigger, and it is the one that catches ordinary marketing. A discount and a cost describe a property. A return describes what an investor would make from it.",
        },
        {
          kind: "heading",
          text: "The exemptions, and what categorisation actually is",
        },
        {
          kind: "paragraph",
          text: "There are exemptions, and the ones people reach for concern investors who are certified as high net worth or as sophisticated. They are real and they are narrower than they are usually treated.",
        },
        {
          kind: "figures",
          caption: "The certified thresholds, as the platform records them",
          rows: [
            { label: "Certified high net worth — annual income", value: gbp(rules.highNetWorthIncome) },
            { label: "Certified high net worth — net assets", value: gbp(rules.highNetWorthNetAssets) },
            { label: "Restricted investor — cap on net assets invested", value: percent(bps(rules.restrictedInvestorCapBps), 0) },
            { label: "How long a signed statement lasts", value: `${rules.certificationValidMonths} months` },
            { label: "Thresholds as recorded on", value: rules.asOf },
          ],
        },
        {
          kind: "paragraph",
          text: "Categorisation is a signed statement by the investor, in a prescribed form, before the promotion is made. It is not a checkbox, not a tick on a landing page and not something that can be inferred from somebody's behaviour. A promotion sent first and categorised afterwards was an unlawful promotion at the moment it was sent.",
        },
        {
          kind: "heading",
          text: "How should a deal pack be written?",
        },
        {
          kind: "list",
          items: [
            "Decide what is being offered before writing a word. A property, or a participation. The whole answer follows from that.",
            "Keep property arithmetic and investor returns apart. Cost, price and true discount describe the asset; margin, loan to GDV and return on cash describe a stake in it.",
            "Label a worked example as a worked example. An illustration is not a statement that opportunities are available at that figure.",
            "If a return has to be published, get it approved by an authorised person first. There is no version of this where it is easier to fix afterwards.",
            "Where you are not sure, withhold the figure and say why. A page that explains what it is not permitted to say is more credible than one that quietly says it.",
          ],
        },
        {
          kind: "heading",
          text: "What we do about it",
        },
        {
          kind: "paragraph",
          text: "The permission is recorded or it is not held, and the code reads the record rather than an assumption. Where the platform does not hold approver permission, the public pages do not publish opportunity returns and they print the reason instead of leaving a gap. Deal economics — the Deal Score, the capital stack, the exit matrix — sit behind categorisation, which is a form somebody signs.",
        },
        {
          kind: "paragraph",
          text: "This page is a description of how the rules work, not legal advice, and the perimeter has genuinely difficult edges. If a structure is being built, the time to ask a regulatory solicitor is before the first pack goes out — not after somebody asks for their money back.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Is a deal pack for my own purchase a financial promotion?",
              answer:
                "No. A pack describing a property you are buying yourself, for your own account, is not an inducement to engage in investment activity, because direct purchase of land is not a controlled investment.",
            },
            {
              question: "What if I share it with one other investor?",
              answer:
                "If that investor is being invited into a structure rather than buying the property themselves, it is a promotion — and there is no exemption for a small number of recipients. One recipient is enough.",
            },
            {
              question: "Does putting a disclaimer on it help?",
              answer:
                "Not by itself. Whether something is an inducement is judged on its substance and effect, not on what it calls itself. A disclaimer on a document plainly designed to persuade somebody to invest does not change what it is.",
            },
            {
              question: "Can an authorised firm approve my promotion?",
              answer:
                "Yes, and that is the ordinary route for an unauthorised business. Since the approver gateway was introduced the firm must itself have permission to approve promotions of that type, so the question to ask is not whether a firm is authorised but whether it holds that specific permission.",
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
