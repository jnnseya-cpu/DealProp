import { metaDescription, type BlogPost } from "@shared/domain/blog";

/**
 * Feature posts: what each part of the platform does, and why it is built the
 * way it is.
 *
 * These are evergreen explainers in the same sense as the ones in `corpus.ts`,
 * written in code and derived per request. They differ in intent: each one
 * takes a single capability and makes the case for it, so a reader arriving
 * from a search for "how is a property deal scored" or "how do I publish a
 * listing" meets the feature and the reasoning behind it in one page.
 *
 * The house rules that govern every other post govern these without exception,
 * and they are the whole reason a feature post here reads differently from a
 * sales page anywhere else:
 *
 *  - **No invented figure.** Where a post needs a number it is computed by the
 *    engine, exactly as in `corpus.ts`; where it compares approaches it uses a
 *    labelled qualitative table, which states a trade rather than a return. A
 *    yield, a margin or a return on cash offered as an inducement would be a
 *    financial promotion, so none appears.
 *  - **Every claim cites a primary source**, by key, resolved through
 *    `citations.ts`. A page that asserts what the law requires and names
 *    nothing is an opinion.
 *  - **Nothing about a seller's personal circumstances** reaches the page. The
 *    Seller Protection post sells the control by describing what it does to a
 *    transaction, never by describing a person.
 *
 * The argument each post makes is therefore the same argument the product
 * makes: the discipline is the feature. That is the only honest way to sell a
 * platform whose entire claim is that it does not fake the number.
 */

const PUBLISHED = "2026-10-20T09:00:00.000Z";

export function featurePosts(): readonly BlogPost[] {
  return [
    /* ------------------------------------------------ the Deal Score */
    {
      slug: "how-a-deal-score-is-computed",
      title: "The Deal Score, and why it is computed after tax",
      description: metaDescription(
        "Nine weighted components, each carrying its own reasoning, scored on profit after tax and capped by hard gates. A pre-tax score flatters every deal, and flatters the marginal ones most.",
      ),
      answer:
        "The Deal Score is a 0–100 figure built from nine weighted components — margin, resilience, exit optionality, capital recycling, seller motivation, completion probability, jurisdiction readiness, protection status and valuation confidence. It is computed on profit after tax, never before it, because a pre-tax number flatters every deal. Hard gates cap it: a Seller Protection block holds it at 35 whatever the margin says.",
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["corporation-tax", "stamp-duty", "additional-dwelling-rates", "price-paid-data"],
      attributions: ["Component descriptions reflect the Lode scoring engine; every live score carries the same reasoning."],
      body: [
        {
          kind: "paragraph",
          text: "A single number for a property deal is only worth having if it cannot be gamed and it says why it is what it is. A score that is one unexplained figure invites the user to argue with it; a score that shows its working invites them to act on it. The Deal Score is built to be the second kind.",
        },
        { kind: "heading", text: "What goes into the number?" },
        {
          kind: "paragraph",
          text: "Nine components, each weighted and each carrying its own sentence of reasoning. None of them is a vibe. They are the things that actually decide whether a purchase is worth making and whether it survives contact with a completion statement.",
        },
        {
          kind: "figures",
          caption: "The nine components, each scored with its reasoning",
          rows: [
            { label: "Margin", value: "Profit after tax against the finished value" },
            { label: "Resilience", value: "How the deal holds under the Red Team stresses" },
            { label: "Exit optionality", value: "How many of the exit matrix routes actually work" },
            { label: "Capital recycling", value: "How much deployed cash comes back on exit" },
            { label: "Seller motivation", value: "Whether there is a real reason to transact" },
            { label: "Completion probability", value: "Whether the transaction is likely to complete at all" },
            { label: "Jurisdiction readiness", value: "Whether the nation's tax and rules are fully modelled" },
            { label: "Protection status", value: "Whether Seller Protection has anything to say" },
            { label: "Valuation confidence", value: "How well the open market value is evidenced" },
          ],
        },
        {
          kind: "paragraph",
          text: "Because each component is scored separately and published with its reasoning, two deals that land on the same total for different reasons do not look identical. One scoring 61 on a thin margin and a strong exit is a different proposition from one scoring 61 on a fat margin and a single fragile exit, and the breakdown says so.",
        },
        { kind: "heading", text: "Why after tax, and not before?" },
        {
          kind: "paragraph",
          text: "Profit is taxed, and transfer tax is paid on the way in. A score computed before either overstates every outcome — and it overstates the marginal ones most, which is exactly where the decision is being made. Nobody needs a score to reject an obvious dog or accept a once-in-a-decade bargain; the score earns its place on the deals in between, and those are the ones a pre-tax figure gets wrong.",
        },
        {
          kind: "paragraph",
          text: "So the additional dwelling surcharge is charged into the deployed total before true discount is computed, and corporation tax is charged against profit before the margin component is scored. The number that comes out is duller than a headline and it is the one that holds up.",
        },
        { kind: "heading", text: "What can cap a good score?" },
        {
          kind: "paragraph",
          text: "Hard gates, and they are not negotiable. A Seller Protection block caps the score at 35 and forces a rejection whatever the margin says, because converting someone's circumstances into a discount is the one thing this platform exists to refuse. A single-factor Red Team loss caps the score too — a deal that loses money when one variable moves is fragile, and no amount of headline margin buys that back.",
        },
        {
          kind: "paragraph",
          text: "A jurisdiction with no complete tax model cannot return a full score either. An unknown nation routes to not-supported rather than defaulting to England, because a confident score built on the wrong tax tables is worse than an honest refusal to score.",
        },
        { kind: "heading", text: "What the number is not" },
        {
          kind: "list",
          items: [
            "It is not a valuation. It scores a deal, not a property, and the same house is a different score at a different price.",
            "It is not a promise. Completion probability is a component precisely because a third of agreed sales fall through.",
            "It is not a pre-tax figure dressed up. The tax is in the number, not in a footnote beneath it.",
            "It is not a figure you can argue the engine out of. The reasoning is published so you can act on it, not appeal it.",
          ],
        },
        {
          kind: "paragraph",
          text: "That is the whole proposition. One number, computed the same way every time, on profit after tax, carrying the reasons it is what it is — and capped, hard, where a person's circumstances or a deal's fragility says it must be.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Is the Deal Score a valuation?",
              answer:
                "No. It scores a deal at a price, not a property. Move the purchase price and the score moves, because margin, true discount and capital recycling all depend on what you pay.",
            },
            {
              question: "Why can a high-margin deal still score badly?",
              answer:
                "Because margin is one component of nine, and because the hard gates override the total. A fat margin on a fragile deal that loses money when a single variable moves is capped by the Red Team gate, and a fat margin on a blocked deal is capped at 35.",
            },
            {
              question: "What does computing after tax actually change?",
              answer:
                "It lowers the score on every deal and lowers it most on the marginal ones. Transfer tax is charged into the deployed total and corporation tax against profit before the margin component is scored, so the number reflects what is left rather than what was gross.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ the Red Team */
    {
      slug: "red-team-stress-testing-a-property-deal",
      title: "Red Team stress testing: finding the fragile deal",
      description: metaDescription(
        "Nine scenarios move the value, the works, the rate and the timeline — one at a time, then together. Only single-factor losses cap the score, because a deal that needs four things to go wrong is not a fragile deal.",
      ),
      answer:
        "The Red Team runs nine stress scenarios against every deal, moving the finished value, the works cost, the interest rate and the time to sell — first one at a time, then several together. Only a single-factor loss caps the Deal Score. A deal that only loses money when four things go wrong at once is a real risk and a bad reason to reject an otherwise sound purchase.",
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["price-paid-data", "house-price-index", "corporation-tax", "stamp-duty"],
      attributions: ["Scenario structure reflects the Lode Red Team engine; tiering is pinned by test."],
      body: [
        {
          kind: "paragraph",
          text: "Every appraisal is a forecast, and every forecast is wrong. The useful question is not whether the central case holds but how much has to go against you before the deal stops working — and whether the things that would have to go wrong are one thing or four things at once. Treating those two cases identically is how a scoring system becomes useless.",
        },
        { kind: "heading", text: "What does the Red Team actually move?" },
        {
          kind: "paragraph",
          text: "The variables with the widest error bars and the largest effect: the gross development value, the works budget, the cost of finance, and the time the property sits before it sells. Each is moved against the deal, and the appraisal is recomputed in full — the same engine, the same true discount, the same after-tax margin, on worse inputs.",
        },
        {
          kind: "figures",
          caption: "Single-factor stresses, and what each one tests",
          rows: [
            { label: "Finished value falls", value: "Was the gross development value optimistic?" },
            { label: "Works overrun", value: "Is the contingency real, or a note?" },
            { label: "Rate rises", value: "Does the capital stack still close on dearer money?" },
            { label: "Sale is slow", value: "Does the deal survive a longer, costlier hold?" },
          ],
        },
        { kind: "heading", text: "Why do only single-factor losses cap the score?" },
        {
          kind: "paragraph",
          text: "Because fragility and risk are different things. A deal that turns a loss when one variable moves a realistic amount is fragile: it is a bet that nothing goes wrong, and something always goes wrong. A deal that only turns a loss when the market falls and the works overrun and the rate rises and the sale drags, all together, is not fragile — it is a sound deal facing a bad year, and rejecting it on a compound scenario would reject almost everything worth doing.",
        },
        {
          kind: "paragraph",
          text: "So the tiering is deliberate and it is pinned by a test, because it is exactly the kind of nuance a later simplification would flatten. Single-factor losses cap the Deal Score. Compound scenarios are reported — a reader is entitled to see them — but they do not cap, because a score that treats a once-in-a-decade confluence like a base case is a score that never approves anything.",
        },
        { kind: "heading", text: "How is this different from a sensitivity table?" },
        {
          kind: "paragraph",
          text: "A sensitivity table shows you numbers moving and leaves the judgement to you. The Red Team makes the judgement structural: it decides which movements are allowed to cap a deal and which are not, and it applies that decision the same way every time. The output is not a grid to interpret but a verdict with its reasoning — this deal is fragile to the works budget, that one is robust across every single-factor stress and only fails on a compound worst case.",
        },
        { kind: "heading", text: "What it means in practice" },
        {
          kind: "list",
          items: [
            "A thin-margin deal that survives every single-factor stress can outscore a fat-margin deal that fails one.",
            "The works budget is usually the variable that bites, which is why the contingency is charged into the deployed figure rather than noted beside it.",
            "A deal resting on an optimistic finished value is caught here even when the headline true discount looks comfortable.",
            "Resilience is a Deal Score component in its own right, so a robust deal is rewarded, not merely spared.",
          ],
        },
        {
          kind: "paragraph",
          text: "The point of stress testing is not to frighten the user out of every deal. It is to tell the fragile ones apart from the robust ones, so that the robust thin-margin purchase gets taken and the fragile fat-margin one gets left — which is the opposite of what a headline number does.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "What is the difference between a single-factor and a compound stress?",
              answer:
                "A single-factor stress moves one variable — the value, the works, the rate or the timeline — and leaves the rest at the central case. A compound stress moves several at once. Only single-factor losses cap the Deal Score; compound scenarios are shown but do not cap.",
            },
            {
              question: "Why not just reject anything that loses money under stress?",
              answer:
                "Because almost every sound deal loses money under a severe enough compound scenario, so that rule would reject everything. The distinction that matters is whether the deal is fragile to a single realistic movement, and that is the one the engine uses to cap.",
            },
            {
              question: "Which variable matters most?",
              answer:
                "Usually the works budget, because it has the widest error bar and feeds straight into true discount and the capital stack. A deal that only works if the works come in exactly on estimate is a fragile deal, and the Red Team says so.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ the exit matrix */
    {
      slug: "property-exit-matrix-sell-refinance-rent-assign",
      title: "The exit matrix: a position, not a bet",
      description: metaDescription(
        "Sell, refinance and hold, rent, or assign — every way out of a property costed side by side and after tax. A deal with one exit is a bet on that exit; a deal with three is a position.",
      ),
      answer:
        "The exit matrix costs every way out of a property side by side: sell, refinance and hold, rent only, or assign the contract. Each is computed after tax, because the exits are taxed differently and comparing them before tax reverses the ordering more often than people expect. A deal with one exit is a bet on that exit; a deal with three is a position, and the difference shows when the first exit closes.",
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["corporation-tax", "house-price-index", "price-paid-data", "regulated-activities-order"],
      attributions: ["Routes reflect the Lode exit matrix; every exit is costed after tax by the same engine."],
      body: [
        {
          kind: "paragraph",
          text: "Most deals are underwritten on a single exit — usually a sale at the finished value — and that exit is the one most likely to be unavailable exactly when it is needed. A market that softens, a lender that tightens, a buyer who pulls out: each one closes the planned door, and a deal with no second door becomes a forced sale. The exit matrix exists so that the second door is costed before it is needed, not improvised after.",
        },
        { kind: "heading", text: "What are the four exits?" },
        {
          kind: "figures",
          caption: "Four ways out, each costed after tax",
          rows: [
            { label: "Sell", value: "Realise the gross development value, pay the tax, release the cash" },
            { label: "Refinance and hold", value: "Pull capital out at the improved value, keep the asset" },
            { label: "Rent only", value: "Hold for income where a sale or refinance will not clear" },
            { label: "Assign", value: "Pass the contract on before completion where the law allows" },
          ],
        },
        {
          kind: "paragraph",
          text: "Each route is run through the same engine, so the figure for a sale and the figure for a refinance are comparable rather than computed two different ways. And each is computed after tax, because a sale, a refinance and a hold are taxed differently, and comparing them before tax can put them in the wrong order — the exit that looks best gross is routinely not the one that leaves the most in hand.",
        },
        { kind: "heading", text: "Why does the number of exits feed the score?" },
        {
          kind: "paragraph",
          text: "Exit optionality is a component of the Deal Score, and it is there for a simple reason: a deal with three working exits is worth more than an identical deal with one, even when the central-case profit is the same. The second and third exits are what turn a loss into a delay when the first one closes. Capital recycling interacts with this directly — a refinance exit that returns most of the deployed cash lets the same money do the next deal, where a rent-only hold leaves it trapped.",
        },
        {
          kind: "paragraph",
          text: "The refinance window makes the point concrete. A short-term facility has to be refinanced or repaid on a date, and a deal with no refinance exit arranged is relying entirely on a sale completing before the term ends. The exit matrix shows whether that reliance is a choice or a corner.",
        },
        { kind: "heading", text: "Does more exits always mean a better deal?" },
        {
          kind: "paragraph",
          text: "No — it means a more robust one. A deal with a single exit and an enormous margin can still be the right deal, if the margin is large enough to absorb the risk of that one door closing. What the matrix does is make the trade explicit rather than invisible: it shows you that you are making a concentrated bet, and what the fallback would cost if you had to take it. A bet made knowingly is a strategy; a bet made because nobody costed the alternative is an accident.",
        },
        { kind: "heading", text: "What it changes about how a deal is run" },
        {
          kind: "list",
          items: [
            "The walk-away price is set with the exits in view, so a deal is not priced for a sale that may not happen.",
            "A deal that only works on one exit is flagged as such, not quietly scored as though it had three.",
            "Refinance and hold is costed at the improved value, after the works, which is the only version of that exit that is real.",
            "Assignment is only offered where the contract and the law actually permit it, never as a default escape.",
          ],
        },
        {
          kind: "paragraph",
          text: "The whole argument for the matrix is that exits fail without notice and in the order you least expect. Costing all four before committing is the difference between a position you can hold and a bet you have to hope wins.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Why cost the exits after tax?",
              answer:
                "Because a sale, a refinance and a rental are taxed differently, and the ordering before tax is often reversed afterwards. Comparing gross figures can point you at the exit that leaves the least in hand.",
            },
            {
              question: "What is the difference between refinance-and-hold and rent-only?",
              answer:
                "Refinance-and-hold pulls capital back out of the deal at the improved value and keeps the asset, so the money can recycle. Rent-only holds for income without releasing the capital, which is the route when a refinance will not clear the debt.",
            },
            {
              question: "Is a single-exit deal always bad?",
              answer:
                "No. A single-exit deal with a large enough margin can be sound. The matrix does not forbid it — it makes the concentration visible and costs the fallback, so the bet is taken knowingly rather than by omission.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ net advance / capital stack */
    {
      slug: "what-a-bridging-facility-releases-on-day-one",
      title: "Net advance: what a bridging facility really releases",
      description: metaDescription(
        "A facility is not a cash sum. Where interest is retained it is deducted at drawdown, so the net advance is smaller than the headline. A capital stack modelled on the face value fails at completion, not at appraisal.",
      ),
      answer:
        "A bridging facility is not a cash sum. Where interest is retained, the lender deducts the whole term's interest at drawdown, and arrangement fees come out on top, so the net advance released on the day is materially less than the headline facility. A capital stack modelled on the face value of the debt overstates the cash that arrives, and it fails at completion rather than at appraisal.",
      topic: "finance",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["regulated-activities-order", "corporation-tax", "stamp-duty", "price-paid-data"],
      attributions: ["Finance mechanics reflect the Lode borrowing engine; the net advance drives every downstream figure."],
      body: [
        {
          kind: "paragraph",
          text: "The single most common modelling error in refurbishment finance is to treat a facility as cash arriving on completion. It is not. Between the headline figure on the offer and the money that actually lands in the account there is a gap, and the gap is the sponsor's problem, discovered at the worst possible moment — the day of completion, when the shortfall has to be found from somewhere.",
        },
        { kind: "heading", text: "What is the net advance?" },
        {
          kind: "paragraph",
          text: "The net advance is the cash the lender actually releases at drawdown, after everything deducted up front. On a facility with retained interest, the whole term's interest is taken on day one. The arrangement fee comes out too, and often the lender's own legal costs. A facility of a given face value over twelve months at a retained rate releases a good deal less than its face value, and every figure downstream — the deposit needed, the works schedule, the contingency — depends on that smaller number.",
        },
        {
          kind: "figures",
          caption: "Headline facility versus what arrives",
          rows: [
            { label: "Face value of the facility", value: "The number on the offer" },
            { label: "Less retained interest", value: "The whole term, deducted at drawdown" },
            { label: "Less arrangement fee", value: "A percentage of the facility, up front" },
            { label: "Less lender's legal costs", value: "Charged to the borrower" },
            { label: "Net advance", value: "The cash that actually lands — what to model on" },
          ],
        },
        { kind: "heading", text: "Why does retained interest exist at all?" },
        {
          kind: "paragraph",
          text: "Because a property under refurbishment produces no income to service a loan. Retention suits a borrower with nothing coming in: there is nothing to pay monthly, because it has already been taken. It is not free — the interest is charged on the full facility for the full term whether or not the project runs to time — and whether an early exit refunds the unused portion is a term of the facility worth reading before comparing two lenders on headline rate alone.",
        },
        { kind: "heading", text: "How does this change the capital stack?" },
        {
          kind: "paragraph",
          text: "The capital stack is every source of money in the purchase, ordered by who is repaid first. It is only sound if each layer is costed at what it releases rather than at what it says on the offer. A stack built on face values shows a gap at the top that looks closeable and is not, because the debt layer is smaller in cash than it appears. Deriving the sponsor's required equity from the net advance rather than the facility is the difference between a stack that closes and one that fails a week before completion.",
        },
        {
          kind: "paragraph",
          text: "Loan to GDV matters here too. A facility sized against the gross development value can look conservative on paper while the net advance leaves the sponsor short on day one — the two questions are different, and a deal that passes one can fail the other.",
        },
        { kind: "heading", text: "What to do with the number" },
        {
          kind: "list",
          items: [
            "Model the deposit and the works on the net advance, never the face value of the facility.",
            "Treat transfer tax as non-lendable cash: no bridging facility advances against stamp duty, so it comes out of the sponsor's own money on the day.",
            "Read whether retained interest is rebated on an early exit before comparing lenders on rate.",
            "Charge the arrangement and exit fees into the deal, because they are money the sponsor never sees and a deal costed without them is costed wrong.",
          ],
        },
        {
          kind: "paragraph",
          text: "A facility is a promise to lend, not a cheque. The net advance is what the promise is worth in cash on the day, and it is the only figure a capital stack can honestly be built on.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Is the net advance the same as the loan amount?",
              answer:
                "No. The loan amount is the face value of the facility. The net advance is what is left after retained interest, the arrangement fee and the lender's legal costs are deducted at drawdown — the cash that actually arrives.",
            },
            {
              question: "Does an early exit refund retained interest?",
              answer:
                "Sometimes, and sometimes not — it is a term of the facility. Retained interest is charged on the full facility for the full term, so whether the unused portion is rebated on an early repayment is a question to settle before signing, not after.",
            },
            {
              question: "Why can't I model the deal on the headline facility?",
              answer:
                "Because the headline facility never arrives in full. Modelling the deposit, the works and the contingency on the face value overstates the cash available, and the shortfall surfaces at completion, which is the most expensive moment to find it.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ refinance window */
    {
      slug: "the-refinance-window-on-a-refurbishment",
      title: "The refinance window: a date, not a status",
      description: metaDescription(
        "A short-term facility must be refinanced or repaid on a date computed from completion and the term. Seasoned at six months, urgent ninety days out. What kills a refurbishment is arriving at the term end with no exit arranged.",
      ),
      answer:
        "The refinance window is the period in which a short-term facility must be refinanced or repaid, computed from the completion date and the facility term rather than set by hand. A property is seasoned at six months, and the window turns urgent ninety days before the term ends. What kills a refurbishment is almost never the interest rate — it is arriving at the term end with no exit arranged.",
      topic: "finance",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["regulated-activities-order", "corporation-tax", "house-price-index", "price-paid-data"],
      attributions: ["Window dates are computed by the Lode funding engine from the completion date and the facility term."],
      body: [
        {
          kind: "paragraph",
          text: "Ask somebody what sinks a refurbishment deal and they will usually say the works overran or the rate was too high. Those hurt, but they rarely sink a deal on their own. What sinks a deal is the term end arriving with no exit in place — at which point the only options are an extension fee, a forced sale, or the lender taking the property. The refinance window exists so that the term end is never a surprise.",
        },
        { kind: "heading", text: "Why is it a date and not a status?" },
        {
          kind: "paragraph",
          text: "Because a status is something a person sets and forgets, and a date is something the calendar enforces. A field that reads \"refinancing in progress\" tells you what somebody believes; a window computed from the completion date and the facility term tells you how long there actually is. The two diverge exactly when it matters — when the project is late and the optimism is highest.",
        },
        {
          kind: "figures",
          caption: "The window, computed from completion and term",
          rows: [
            { label: "Seasoned", value: "Six months from completion — most lenders will now refinance at the improved value" },
            { label: "Open", value: "Between seasoning and the urgent threshold — the time to arrange the exit" },
            { label: "Urgent", value: "Ninety days before the term ends — the exit must be in hand" },
            { label: "Term end", value: "The facility is due — extension, forced sale, or repossession if nothing is arranged" },
          ],
        },
        { kind: "heading", text: "What does seasoning have to do with it?" },
        {
          kind: "paragraph",
          text: "Most lenders will not refinance at the improved, post-works value until the borrower has owned the property for six months — the seasoning period. Before that, a refinance is sized against the purchase price, which is the low point and usually will not release enough to clear the bridge. So the refinance exit the whole deal depends on is simply not available for the first half-year, and a deal underwritten as though it were is underwritten on an exit that does not yet exist.",
        },
        { kind: "heading", text: "How does the window connect to the rest of the deal?" },
        {
          kind: "paragraph",
          text: "Directly. The refinance window is one of the exit matrix routes, and whether it is open or urgent feeds the deal's resilience. The net advance on the refinance facility decides how much of the bridge it clears and how much capital recycles out. And the works schedule has to finish with enough of the window left to arrange the exit — a project that completes its works the week the window turns urgent has left itself no room.",
        },
        { kind: "heading", text: "What it changes" },
        {
          kind: "list",
          items: [
            "The exit is arranged in the open window, not scrambled for in the urgent one.",
            "A deal is not underwritten on a refinance that seasoning makes unavailable for six months.",
            "The works schedule is read against the window, so completion leaves time to refinance.",
            "An extension fee is treated as the cost of a missed window, not as a routine line item.",
          ],
        },
        {
          kind: "paragraph",
          text: "The interest rate is a cost you can see coming. The term end is a cliff, and the refinance window is the guardrail — a date the calendar enforces, so the exit is arranged while there is still time to arrange it.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "What does it mean for a property to be seasoned?",
              answer:
                "That the borrower has owned it long enough — usually six months — for a lender to refinance against the current, improved value rather than the original purchase price. Before seasoning, a refinance is sized against the low point and often will not clear the bridge.",
            },
            {
              question: "When does the window become urgent?",
              answer:
                "Ninety days before the facility term ends. At that point the refinance or sale needs to be in hand, because arranging an exit from scratch inside ninety days leaves no room for a valuation or a lender's delay.",
            },
            {
              question: "What happens if the window closes with no exit?",
              answer:
                "The options narrow to an extension fee, a forced sale, or the lender taking the property. All three are more expensive than refinancing on time, which is the entire reason the window is computed and surfaced rather than left to memory.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ buyer readiness passport */
    {
      slug: "buyer-readiness-passport-before-a-seller",
      title: "The Buyer Readiness Passport, graded A to D",
      description: metaDescription(
        "A buyer's identity and funding evidence, graded A to D, deciding whether they may be put in front of a seller at all. Grade C is the trap: we know exactly who they are and nothing about their ability to pay.",
      ),
      answer:
        "The Buyer Readiness Passport grades a buyer's identity and funding evidence from A to D, and the grade decides whether they reach a seller at all. Grade A is proceedable; Grade B is funded subject to something; neither C nor D reaches a seller. Grade C matters most: we know exactly who someone is and nothing about their ability to pay, which looks like readiness while being the opposite.",
      topic: "regulation",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["money-laundering-regs", "money-laundering-regs-r28", "data-protection-act", "material-information"],
      attributions: ["Grades reflect the Lode passport engine; the grade is the single decision point for approaching a seller."],
      body: [
        {
          kind: "paragraph",
          text: "A motivated seller is, by definition, someone with a reason to move quickly, and the fastest way to do them harm is to put an unchecked buyer in front of them. The Buyer Readiness Passport is the gate that stops that happening: one grade, computed from identity and funding evidence, that decides whether a buyer may approach a seller at all. No call site reads the raw evidence and invents its own answer — the grade owns the decision.",
        },
        { kind: "heading", text: "What do the grades mean?" },
        {
          kind: "figures",
          caption: "Four grades, and which reach a seller",
          rows: [
            { label: "Grade A", value: "Identity verified, screened, funds evidenced in full, solicitor instructed — proceedable" },
            { label: "Grade B", value: "Funded subject to something — may proceed with the condition stated" },
            { label: "Grade C", value: "Identity known, ability to pay unknown — does not reach a seller" },
            { label: "Grade D", value: "Identity not established — does not reach a seller" },
          ],
        },
        {
          kind: "paragraph",
          text: "Grade A is proceedable: identity verified, the buyer screened, funds evidenced in full, and a solicitor instructed or a purchase already completed. Grade B is funded subject to a condition that is named. Neither C nor D goes near a seller, and the reason the gate is drawn there rather than lower is Grade C.",
        },
        { kind: "heading", text: "Why is Grade C the trap?" },
        {
          kind: "paragraph",
          text: "Because it is the grade that looks most like readiness while being furthest from it. A Grade C buyer has passed identity: we know exactly who they are. We know nothing about whether they can pay. That combination feels reassuring — the hard-looking check has passed — and it is precisely the combination that wastes a seller's time and, on a fast sale, can cost them a completion. Knowing who somebody is tells you nothing about whether they can complete, and the passport refuses to let the first stand in for the second.",
        },
        { kind: "heading", text: "Why does the evidence lapse?" },
        {
          kind: "paragraph",
          text: "Because a document proves what was true on the day it was issued and no longer. Identity evidence lapses after twelve months and proof of funds after three, because a bank statement from last year proves last year. Customer due diligence is not a one-time stamp: the Regulations require that the customer is identified and verified from a reliable, independent source, and a stale source is not a current verification. The passport treats an expired check as no check, which is the only safe reading.",
        },
        {
          kind: "paragraph",
          text: "There is a second question the passport keeps separate: who stands behind the buyer. Where a company is buying, identifying the director who signed is not identifying the customer — the beneficial owner is whoever ultimately owns or controls the entity, and the passport asks for that rather than accepting the name on the cover.",
        },
        { kind: "heading", text: "What the gate protects" },
        {
          kind: "list",
          items: [
            "A seller's time, which a fast sale makes scarce and valuable.",
            "The completion itself, because completion probability collapses when the buyer cannot actually fund.",
            "The platform's own position under the money-laundering regime, which requires the customer to be identified and verified.",
            "The seller's data, which is never handed to a buyer who has not cleared the gate.",
          ],
        },
        {
          kind: "paragraph",
          text: "Investors and funders, incidentally, never hold the permission to view seller data at any point — the passport is about who may approach, and seeing a seller's situation is a separate decision with its own gate. The passport's whole job is to make sure that the person who reaches a motivated seller is one who can actually complete, and that \"we know who they are\" is never mistaken for \"they can pay.\"",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Why doesn't a verified identity get a buyer to a seller?",
              answer:
                "Because identity and funding are different questions. A Grade C buyer has a verified identity and no evidenced ability to pay, and approaching a seller with the first while missing the second is how a fast sale falls through. The gate requires both.",
            },
            {
              question: "How long does the evidence last?",
              answer:
                "Identity evidence lapses after twelve months and proof of funds after three. A lapsed check is treated as no check, because a document proves only what was true on the day it was issued.",
            },
            {
              question: "What happens with a company buyer?",
              answer:
                "The passport looks past the signatory to the beneficial owner — whoever ultimately owns or controls the entity — because identifying the director who signed is not identifying the customer under the money-laundering rules.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ material information */
    {
      slug: "material-information-nobody-looked-published",
      title: "Material information: publishing what nobody checked",
      description: metaDescription(
        "A listing fact has three states, not two: stated, not applicable, and not known — with a record of who was asked. A buyer cannot tell 'no covenants' from 'nobody looked', and publishing the second as the first is a misleading omission.",
      ),
      answer:
        "Material information is the set of facts that must be published about a property before it is marketed, in three parts. The state that matters is the third: a question has three answers, not two — stated, not applicable, and not known, with a record of who was asked. A buyer cannot tell 'no covenants' from 'nobody looked', and publishing the second as the first is a misleading omission.",
      topic: "regulation",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["material-information", "dmcc-act", "consumer-rights-act", "unfair-trading-regs"],
      attributions: ["Three-state model reflects the Lode material information engine and current National Trading Standards guidance."],
      body: [
        {
          kind: "paragraph",
          text: "A property listing is a set of claims, and the dangerous claims are the ones made by omission. When a listing is silent on flood history, a buyer reads the silence as \"no flooding\" — and if the truth is that nobody ever checked, the silence has misled them. Material information is the discipline of never letting \"nobody looked\" masquerade as \"nothing to report.\"",
        },
        { kind: "heading", text: "What are the three parts?" },
        {
          kind: "paragraph",
          text: "Part A applies to every property: price, tenure, council tax band, and the handful of facts no listing may omit. Parts B and C apply where relevant — rights of way, flood history, restrictive covenants, mining, cladding. The parts decide what must be addressed; the three states decide how.",
        },
        {
          kind: "figures",
          caption: "Three states of a listing fact",
          rows: [
            { label: "Stated", value: "The fact is known and published" },
            { label: "Not applicable", value: "The fact does not arise for this property" },
            { label: "Not known", value: "Nobody has established it — and here is who was asked" },
          ],
        },
        { kind: "heading", text: "Why is 'not known' a separate state?" },
        {
          kind: "paragraph",
          text: "Because collapsing it into either of the others misleads. Record a not-known fact as \"not applicable\" and you have claimed something you do not know. Leave it blank and the buyer fills the blank with an assumption. The only honest option is a third state that says, on the face of the listing, that the question was asked and not answered — and names who was asked, so the buyer knows whose silence they are reading. That is what turns an omission into a disclosure.",
        },
        {
          kind: "paragraph",
          text: "The consumer protection regime makes this a legal distinction, not a stylistic one. A misleading omission is as much a breach as a misleading statement, and the current rules treat the failure to disclose material information the average consumer needs as exactly that kind of omission. \"Nobody looked,\" published as though nothing were wrong, is the textbook case.",
        },
        { kind: "heading", text: "What does an unanswered question stop?" },
        {
          kind: "paragraph",
          text: "A Part A question with no answer stops the property being marketed at all — and because marketing is a precondition of a reveal, it stops the deal moving forward until the gap is filled. This is deliberate. The incentive on any listing is to go live and sort the details later; a gate that refuses to market an incomplete Part A removes that incentive, because \"later\" is where disclosure quietly dies.",
        },
        {
          kind: "paragraph",
          text: "Material information is one of several gates a listing clears before it is marketed, and they do different jobs. Seller Protection asks whether the transaction should happen at all and can block it outright. Customer due diligence asks who is actually selling — the person on the telephone is often not the registered proprietor. Material information asks what the buyer must be told about the property itself. A listing can satisfy one and fail another, which is why they are separate gates rather than a single checkbox, and why the completion probability of a deal rests on all three.",
        },
        { kind: "heading", text: "What it changes about a listing" },
        {
          kind: "list",
          items: [
            "A silence is never published as a fact — an unestablished point is shown as not known, with who was asked.",
            "An incomplete Part A blocks marketing rather than going live with a gap.",
            "The buyer can tell a checked fact from an unchecked one, which is the entire point of the exercise.",
            "The record of who was asked travels with the listing, so a later challenge can be answered.",
          ],
        },
        {
          kind: "paragraph",
          text: "Most of what makes a listing trustworthy is not the facts it states but the honesty of its gaps. A platform that publishes \"not known — we asked the executor and it is being established\" is more credible than one whose listings are suspiciously complete, and it is on the right side of the law while being so.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "What is the difference between 'not applicable' and 'not known'?",
              answer:
                "Not applicable means the fact does not arise for this property — there is no lease, so there is no ground rent. Not known means it does arise and has not been established, and the listing says so and names who was asked. Recording the second as the first is a false claim.",
            },
            {
              question: "Why does an unanswered question stop the marketing?",
              answer:
                "Because a Part A fact is one no listing may omit, and marketing with it blank is a misleading omission. Blocking the listing until the fact is stated or honestly marked not-known removes the incentive to go live and disclose later.",
            },
            {
              question: "Is publishing 'not known' worse for a sale than staying silent?",
              answer:
                "It is better, legally and commercially. Silence invites an assumption the seller may be held to; an honest 'not known, here is who was asked' is a disclosure, and it is more credible to a serious buyer than a listing with no gaps at all.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ negotiation / walk-away */
    {
      slug: "the-walk-away-price-is-computed-not-chosen",
      title: "The walk-away price in a deal: computed, not chosen",
      description: metaDescription(
        "The highest price at which a deal still works is computed from the same engine that scores it, so it cannot drift during a conversation. An offer below market value ships with what the seller gives up for it.",
      ),
      answer:
        "The hard part of a negotiation is not the words — it is knowing the highest price at which the deal still works and not going past it. That walk-away price is computed from the same engine that produces the Deal Score, so it cannot drift mid-conversation, which is how margin is lost: one concession at a time. The engine may accept, counter halfway, hold or walk, and never counters above the ceiling.",
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["estate-agents-act-s18", "material-information", "price-paid-data", "dmcc-act"],
      attributions: ["Negotiation behaviour reflects the Lode negotiation engine; the ceiling is computed, and counters never exceed it."],
      body: [
        {
          kind: "paragraph",
          text: "Margin is rarely lost in one bad decision. It is lost in a series of small ones, each defensible in the moment — another two thousand to keep the deal alive, a little more to match what they are asking. Every one feels like the reasonable thing to do, and together they walk a sound deal past the point where it stops working. The defence against that is not discipline in the room; it is a number computed before the room.",
        },
        { kind: "heading", text: "What is the walk-away price?" },
        {
          kind: "paragraph",
          text: "It is the highest price at which the deal still works — the ceiling above which the margin, the true discount and the exit matrix no longer justify the purchase. It is computed from the same engine that scores the deal, on the same inputs, so the walk-away price and the Deal Score cannot tell two different stories. Compute it in the room and it is a preference; compute it before the room and it is a limit.",
        },
        {
          kind: "figures",
          caption: "Four moves, and when the engine makes them",
          rows: [
            { label: "Accept", value: "The asking price is at or below target — take it" },
            { label: "Counter", value: "There is room below the ceiling — counter part-way, never above it" },
            { label: "Hold", value: "A counter would give away room with nothing in return" },
            { label: "Walk away", value: "The number required is above the walk-away price — the deal has stopped working" },
          ],
        },
        { kind: "heading", text: "Why does the engine never counter above the ceiling?" },
        {
          kind: "paragraph",
          text: "Because the ceiling is the whole point of computing it. An offer that lands exactly on the walk-away price has nowhere left to go — the deal works at that number and at no higher one, so any further movement is a loss taken knowingly. The engine's counters always leave room below the ceiling, and when the seller's number is above it the engine walks rather than inventing headroom that does not exist. A walk-away price you are willing to breach is not a walk-away price; it is a suggestion.",
        },
        { kind: "heading", text: "What must the seller be told?" },
        {
          kind: "paragraph",
          text: "That an offer below market value always ships with what they give up for it — plainly, including that an estate agent would likely get them more if the property can be marketed and they can wait. An offer presented without that comparison is not a worse offer; it is an incomplete one, and presenting the price alone is the practice the consumer-protection rules and the estate-agency rules are both built to catch. The platform puts the trade-off next to the number, not after it.",
        },
        {
          kind: "paragraph",
          text: "Seller Protection runs first, before any of this. A block means there is no negotiating position at all — not a lower one, none — because the first question is never \"what is the right price\" but \"should this transaction happen.\"",
        },
        { kind: "heading", text: "What it changes" },
        {
          kind: "list",
          items: [
            "The limit is set before the conversation, so concessions are measured against it rather than against the last number said aloud.",
            "A counter never drifts above the ceiling, because the engine computes the counter from the ceiling.",
            "The offer carries its context: what the seller gives up, and that an agent might get them more.",
            "A protection block stops the negotiation entirely, rather than producing a careful offer that should never have been made.",
          ],
        },
        {
          kind: "paragraph",
          text: "A negotiation runs on nerve and on numbers. The words are a person's job; the ceiling is not, and computing it from the same engine that scores the deal is how the number in the room stays the number that was true before anyone started talking.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Why compute the walk-away price in advance?",
              answer:
                "Because a limit decided in the moment is a preference, not a limit. Margin is lost through a series of small, reasonable-looking concessions, and the only defence is a ceiling computed before the conversation from the same engine that scores the deal.",
            },
            {
              question: "Can the engine ever counter above the walk-away price?",
              answer:
                "No. Counters are computed from the ceiling and always leave room below it. When the seller's required number is above the walk-away price the engine walks away rather than inventing headroom, because a deal that only works above its ceiling does not work.",
            },
            {
              question: "What has to go with an offer below market value?",
              answer:
                "What the seller gives up for it, stated plainly, including that an estate agent would likely achieve more if the property can be marketed and they can wait. The price alone is an incomplete offer; the trade-off goes next to it, not after it.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ the free appraisal */
    {
      slug: "a-free-property-deal-appraisal-no-account",
      title: "A free property appraisal that shows the true discount",
      description: metaDescription(
        "Every cost, the transfer tax and the stress tests on figures you supply, with no account and nothing tracked. It returns buyer-side arithmetic, not a Deal Score — and the reason why is the honest part.",
      ),
      answer:
        "The free appraisal runs every cost, the transfer tax and the Red Team stress tests on figures you supply, with no account and nothing tracked. It deliberately does not return a Deal Score. Scoring runs Seller Protection and the motivation diagnostics, which need answers about a person nobody has spoken to — so the appraisal gives you the buyer-side arithmetic it can compute honestly, and withholds the one number it cannot.",
      topic: "deal-analysis",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["stamp-duty", "additional-dwelling-rates", "corporation-tax", "price-paid-data"],
      attributions: ["The appraisal is the same engine that produces the Deal Room, run on figures the user supplies."],
      body: [
        {
          kind: "paragraph",
          text: "Most free property calculators are a lead-capture form with arithmetic attached: you get a reassuring number and they get your email and a tracking cookie. The free appraisal here is the opposite transaction. It runs the real engine — the same one behind every Deal Room — on figures you type in, returns the working, and asks for nothing. No account, no sign-up, and nothing tracked.",
        },
        { kind: "heading", text: "What does it actually compute?" },
        {
          kind: "paragraph",
          text: "The buyer-side arithmetic, in full. It takes the price, the works, the finished value and the finance, and returns the true discount against open market value, the transfer tax at the rate the buyer's circumstances attract, the costs across the hold, and the deal's behaviour under the Red Team stresses. These are figures that depend only on what you supply, so the engine can compute them honestly without knowing anything about a seller.",
        },
        {
          kind: "figures",
          caption: "What the appraisal returns, and what it withholds",
          rows: [
            { label: "True discount to value", value: "Returned — every pound deployed against open market value" },
            { label: "Transfer tax", value: "Returned — at the buyer's own rate, including the additional dwelling surcharge" },
            { label: "Costs and after-tax profit", value: "Returned — the full buyer-side arithmetic" },
            { label: "Red Team resilience", value: "Returned — how the figures hold under stress" },
            { label: "Deal Score", value: "Withheld — it needs answers about a person nobody has spoken to" },
          ],
        },
        { kind: "heading", text: "Why does it not return a Deal Score?" },
        {
          kind: "paragraph",
          text: "Because an honest Deal Score cannot be computed from the buyer's side alone. Scoring runs Seller Protection and the motivation diagnostics, and both need answers about the seller — their situation, their reason to move, whether they are in a position to give free and informed consent. Nobody has spoken to that person, so those answers do not exist, and a score computed as though they did would be inventing the most important inputs. The appraisal returns the arithmetic it can stand behind and says, plainly, why the score is not among it.",
        },
        {
          kind: "paragraph",
          text: "That refusal is the feature. A tool that handed you a Deal Score from four numbers and no seller would be faking exactly the part that matters, and the honest version is the one that tells you where its own knowledge stops.",
        },
        { kind: "heading", text: "Why is nothing tracked?" },
        {
          kind: "paragraph",
          text: "Because the appraisal is not a funnel. The deal lives in the query string rather than in an account, and the page is deliberately kept off the analytics route allowlist, so no pixel sees the figures you entered. You can run it, close the tab, and leave no trace — which is the correct default for a tool that exists to give you a straight answer rather than to capture you.",
        },
        { kind: "heading", text: "What it is good for" },
        {
          kind: "list",
          items: [
            "Pricing a purchase before you negotiate, so the true discount is known rather than guessed.",
            "Seeing the transfer tax at your own rate, including the additional dwelling surcharge a company pays from the first pound.",
            "Checking whether a deal survives the Red Team stresses before you commit cash to it.",
            "Getting a straight answer without handing over an email or picking up a cookie.",
          ],
        },
        {
          kind: "paragraph",
          text: "The appraisal gives away the engine because the engine is not the moat — the discipline around it is. A number you can trust, computed the same way as the paid product, with the one figure it cannot honestly produce left out and explained, is a better advertisement for the platform than any figure it could have faked.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Do I need an account to use the appraisal?",
              answer:
                "No. There is no sign-up and nothing to create. The deal lives in the query string, the page is kept off the analytics allowlist, and you can run it and close the tab leaving no trace.",
            },
            {
              question: "Why is there no Deal Score at the end?",
              answer:
                "Because a Deal Score runs Seller Protection and the motivation diagnostics, which need answers about a seller nobody has spoken to. Rather than invent those inputs, the appraisal returns the buyer-side arithmetic it can compute honestly and says why the score is withheld.",
            },
            {
              question: "Is the free version a weaker engine?",
              answer:
                "No. It is the same engine that produces every Deal Room, run on the figures you supply. The difference is not the maths but the inputs — the appraisal has your numbers and no seller, so it returns what those numbers can honestly support.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ one-click listing import */
    {
      slug: "publish-a-property-from-a-listing-link",
      title: "Publish a property from a link, material facts only",
      description: metaDescription(
        "An agent, an auction house or a seller pastes a link to a listing they are entitled to publish, and the facts are imported — never the photos or the copy. Portals are refused before anything is fetched.",
      ),
      answer:
        "A rights-holder — an estate agent, an auction house or the seller — pastes a link to a listing they may publish, and the platform imports the facts: address, tenure, price, the structured data a page already exposes. It never takes the photographs or the written copy, which are someone else's copyright, and it refuses the big portals before fetching anything, because importing is lawful only when the person importing holds the rights.",
      topic: "seller-guides",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["material-information", "land-registration-act", "price-paid-data", "dmcc-act"],
      attributions: ["Import behaviour reflects the Lode listing-import engine; facts are mapped, copyright material is not taken."],
      body: [
        {
          kind: "paragraph",
          text: "Getting a property onto a new platform usually means re-typing everything, which is why most of it never happens. One-click import removes the typing without crossing the line that re-typing stays the right side of: it reads the facts a listing page already publishes about itself, and it leaves everything that belongs to somebody else exactly where it is.",
        },
        { kind: "heading", text: "Who can import, and what is actually taken?" },
        {
          kind: "paragraph",
          text: "Only a rights-holder: an agent instructed on the property, an auction house running the lot, or the seller themselves. What is taken is the factual skeleton — address, tenure, price, property type, the structured data the page exposes for exactly this purpose. What is never taken is the photography and the marketing copy, because those are the listing author's copyright and importing them would be reproduction, not reference.",
        },
        {
          kind: "figures",
          caption: "What imports, and what does not",
          rows: [
            { label: "Address and location", value: "Imported — a fact about the property" },
            { label: "Tenure, type, price", value: "Imported — structured facts a page publishes" },
            { label: "Photographs", value: "Not imported — the author's copyright" },
            { label: "Marketing description", value: "Not imported — the author's copyright" },
            { label: "A portal listing", value: "Refused before fetch — the importer is not the rights-holder" },
          ],
        },
        { kind: "heading", text: "Why are the portals refused before anything is fetched?" },
        {
          kind: "paragraph",
          text: "Because the person pasting a portal link is almost never the rights-holder for that page, and the fetch itself is the exposure — the problem is created by taking the data, not by displaying it later. So a URL that resolves to a major portal is refused at classification, before a single request goes out. The same classifier guards against the request being pointed somewhere it should not go: it will not fetch an internal address or a non-public host, because an import tool that can be aimed at a private network is a server-side request forgery waiting to happen.",
        },
        { kind: "heading", text: "What happens to the facts once they are in?" },
        {
          kind: "paragraph",
          text: "They become a draft, and a draft is not a live listing. The imported facts seed the material information record, where every one of them is held in its proper state — stated, not applicable, or not known. Nothing an import could not establish is filled in by guesswork; a fact the source page did not carry arrives as not known, with the source recorded, rather than as a confident blank. From the draft, the listing goes through the same appraisal and the same seller checks as anything typed in by hand.",
        },
        {
          kind: "paragraph",
          text: "That is the honest limit on \"one click to live.\" The facts can be imported in one action; the property still has to be appraised and the seller still has to be checked, because a listing that skipped those would be live, wrong, and nobody's fault in particular. Price Paid Data and the EPC register can enrich a draft with public signal, but neither of those is a substitute for the human steps that turn a draft into a deal.",
        },
        { kind: "heading", text: "What it changes" },
        {
          kind: "list",
          items: [
            "A rights-holder gets a property onto the platform in one action instead of a form.",
            "Copyright material stays with its author — facts are referenced, photographs and copy are not reproduced.",
            "Portal links and non-public hosts are refused at classification, before any request is made.",
            "The result is a draft that still passes appraisal and seller due diligence, not a listing that skipped them.",
          ],
        },
        {
          kind: "paragraph",
          text: "Import is fast because it reads what a page already says about itself, and lawful because it reads only that. The convenience is real; the discipline that makes it safe is the part worth selling.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Can I import any listing I find online?",
              answer:
                "No. Import is for a rights-holder — the instructed agent, the auction house or the seller. Portal links are refused at classification because the person pasting them is almost never entitled to publish that page, and the fetch itself is the exposure.",
            },
            {
              question: "Does it copy the photos and the description?",
              answer:
                "No. It takes the facts a page publishes about itself — address, tenure, price, property type — and never the photography or the marketing copy, which are the listing author's copyright. Facts are referenced; creative work is not reproduced.",
            },
            {
              question: "Is an imported property immediately live?",
              answer:
                "No. Import produces a draft that seeds the material information record. The property still goes through appraisal and seller due diligence before it is live, because a listing that skipped those would be published wrong.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ licensed discovery */
    {
      slug: "sourcing-property-leads-without-scraping",
      title: "Sourcing leads from licensed data, without scraping",
      description: metaDescription(
        "Discovery reads only sources with a recorded licence, through a single outbound path that obeys robots.txt and rate limits. A guessed email address is invention, not collection, and there is no code path that builds one.",
      ),
      answer:
        "Discovery finds motivated-seller signals from sources that carry a recorded licence, and from nowhere else. Every request goes through one outbound path that checks the licence, the host allowlist, robots.txt and a rate limit before fetching, and treats a 401, 403 or 429 as an answer. A contact detail is extracted from the source or it does not exist — a guessed email address is invention, not collection, and no code path builds one.",
      topic: "data",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["price-paid-data", "epc-register", "data-protection-act", "pecr-r22"],
      attributions: ["Discovery behaviour reflects the Lode discovery engine; licensing is checked at ingestion, not at display."],
      body: [
        {
          kind: "paragraph",
          text: "The property-sourcing industry runs largely on scraping: pull data from wherever it sits, guess the gaps, and worry about the licence never. It is fast, it is cheap, and it manufactures a liability with every record — because the exposure is created at the moment data is taken, not at the moment it is shown. Discovery here is built the opposite way, and the constraint is the product.",
        },
        { kind: "heading", text: "What does 'licensed first' actually mean?" },
        {
          kind: "paragraph",
          text: "That no source is read without a recorded licence, full stop. Price Paid Data and the EPC register are read because they are published under open licences whose terms are recorded; a portal's listings are not, so they stay in the registry marked refused, with the reason written down. The licence check throws at ingestion rather than at display, because a dataset read without a licence is a problem the moment it is in hand — displaying it later is not what created the exposure.",
        },
        {
          kind: "figures",
          caption: "What the single outbound path checks before any fetch",
          rows: [
            { label: "Licence", value: "A recorded licence for this source, or no request" },
            { label: "Host allowlist", value: "A known host over HTTPS, with no credentials in the URL" },
            { label: "robots.txt", value: "Parsed and obeyed — a disallow is a disallow" },
            { label: "Rate limit", value: "Bounded, so the source is never hammered" },
            { label: "401 / 403 / 429", value: "Treated as an answer — the source has said no" },
          ],
        },
        { kind: "heading", text: "Why is there only one outbound path?" },
        {
          kind: "paragraph",
          text: "Because a second one is a hole. Every discovery request goes through a single fetcher that applies all of those checks in order, and there is deliberately no other way out to the network. A codebase with two outbound paths has one that enforces the rules and one that somebody added in a hurry, and the one added in a hurry is the one that scrapes. One path means the rules are not a policy to remember — they are the only door.",
        },
        { kind: "heading", text: "What about a contact detail that isn't published?" },
        {
          kind: "paragraph",
          text: "It does not exist. A contact detail is extracted from a source that published it, or there is no contact detail — there is no code path that assembles one from a name and a company and a common email pattern, and there must never be one. Guessing an address is not collecting data, it is manufacturing it, and manufactured contact data is both wrong often and unlawful to use. A named individual's mailbox found where it should not have been is recorded as rejected, with the reason, rather than kept.",
        },
        {
          kind: "paragraph",
          text: "The downstream rules reinforce this. Emailing a named individual without consent has no legitimate-interests route under the electronic-marketing rules, so an email address, even a correct one, does not entitle anyone to use it. Discovery surfaces a signal and a lawful route to act on it; it never invents the person at the other end.",
        },
        {
          kind: "paragraph",
          text: "And a signal is only ever a beginning. A discovered property is not a deal — it is a candidate that still has to pass Seller Protection, carry its material information, and survive customer due diligence on whoever turns out to be behind it. Discovery narrows a town to a list worth looking at from licensed data; it does not decide anything, and treating a derived signal as a decision is how a sourcing business acquires a portfolio nobody wanted for a reason.",
        },
        { kind: "heading", text: "What it changes" },
        {
          kind: "list",
          items: [
            "Every record carries a licence, so the data is usable rather than a liability in waiting.",
            "A refused source is recorded as refused, with the reason — not quietly scraped anyway.",
            "robots.txt and a 403 are treated as answers, because a source that said no has said no.",
            "A contact detail is extracted or it does not exist, so nothing rests on a guessed address.",
          ],
        },
        {
          kind: "paragraph",
          text: "Scraping is faster right up until it is not — until a licence, a regulator or a complaint turns the whole dataset into a problem. Reading only what is licensed, through one door that obeys the source, is slower to build and the only version that is still standing in a year.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Does discovery scrape listing portals?",
              answer:
                "No. A portal's listings are not licensed to this platform, so they stay in the source registry marked refused with the reason recorded. The licence check throws at ingestion, so an unlicensed source is never read in the first place.",
            },
            {
              question: "What if a property's owner email isn't published anywhere?",
              answer:
                "Then there is no email. A contact detail is extracted from a source that published it or it does not exist — no code path assembles one from a name and a pattern, because guessing an address is manufacturing data, not collecting it.",
            },
            {
              question: "Why route everything through a single fetcher?",
              answer:
                "Because a second outbound path is the one that skips the checks. One door means the licence, host, robots.txt and rate-limit checks are not a policy to remember but the only way a request can reach the network at all.",
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------ seller protection */
    {
      slug: "the-check-that-can-refuse-a-property-deal",
      title: "Seller Protection: the check that can refuse a deal",
      description: metaDescription(
        "A check that can stop a transaction outright, not warn about it. A block caps the Deal Score at 35, forces a rejection and counts the buyer as zero. Absent answers raise caution, never lower it.",
      ),
      answer:
        "Seller Protection is a set of checks that can stop a transaction outright rather than warn about it. A block caps the Deal Score at 35, forces a rejection, fails a hard criterion in every mandate, and makes the buyer count zero. The temptation in motivated-seller work is to convert a difficult situation into a discount, and that route produces complaints, unenforceable contracts and enforcement action — so the check blocks.",
      topic: "regulation",
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      fromLiveDeal: false,
      citations: ["dmcc-act", "consumer-rights-act", "estate-agents-act-s18", "unfair-trading-regs"],
      attributions: ["Behaviour reflects the Lode Seller Protection engine; a block caps the score and cannot be downgraded to a warning."],
      body: [
        {
          kind: "paragraph",
          text: "Every other feature on this platform is about doing a deal well. This one is about not doing a deal at all. Seller Protection is the check that can refuse a transaction outright — not flag it, not price it differently, refuse it — and it is the feature the business is proudest of, because it is the one that costs money to have and costs far more not to.",
        },
        { kind: "heading", text: "What does a block actually do?" },
        {
          kind: "paragraph",
          text: "It stops the deal, structurally, in four places at once. The Deal Score is capped at 35 whatever the margin says. The verdict is forced to a rejection. A hard criterion fails in every buying mandate, so no investor's filter can pick the deal up anyway. And the buyer count falls to zero, so the deal is not quietly counted as available supply. A block is not a strong warning — it is the absence of a deal, and it cannot be downgraded to a warning by anyone.",
        },
        {
          kind: "figures",
          caption: "What a block does, in four places",
          rows: [
            { label: "Deal Score", value: "Capped at 35, whatever the margin" },
            { label: "Verdict", value: "Forced to a rejection" },
            { label: "Every mandate", value: "A hard criterion fails — no filter can pick it up" },
            { label: "Buyer count", value: "Zero — it is not counted as available" },
          ],
        },
        { kind: "heading", text: "Why block rather than warn?" },
        {
          kind: "paragraph",
          text: "Because a warning is a thing a business talks itself past. The commercial pressure in motivated-seller acquisition all runs one way: a difficult situation is a reason the seller will accept less, and the entire temptation is to treat that as an opportunity. A warning next to a profitable deal loses that argument every time. A block does not have the argument — it removes the deal from the system, so there is nothing left to talk past. The downside of a wrongly blocked deal is a deal not done; the downside of a wrongly waved-through one is a complaint, an unenforceable contract and, at the far end, enforcement action under the consumer-protection and estate-agency rules.",
        },
        { kind: "heading", text: "What happens when an answer is missing?" },
        {
          kind: "paragraph",
          text: "Caution goes up, not down. A screening question with no answer is treated as a reason to be more careful, never as a quiet pass — because the failure mode of every safeguard is to read a blank as \"fine.\" An absent answer is exactly the case where the safeguard is most needed and least able to see, so the engine resolves the uncertainty towards protection rather than towards the deal.",
        },
        {
          kind: "paragraph",
          text: "Seller Protection also runs first. Before the negotiation engine computes a walk-away price, before the Red Team stresses the figures, before the Deal Score is assembled or the material information is published, the protection check has already decided whether there is a deal to price at all. A block means there is no position — not a lower one, none — and everything downstream inherits that.",
        },
        { kind: "heading", text: "What it protects, and what it costs" },
        {
          kind: "list",
          items: [
            "It protects the seller, by refusing to convert a hard situation into a cheaper purchase.",
            "It protects the buyer, from a contract that may be unenforceable and a transaction that invites a complaint.",
            "It protects the platform, from enforcement under the consumer-protection and estate-agency regimes.",
            "It costs the occasional good deal, which is the price of a safeguard that cannot be argued with — and the right price.",
          ],
        },
        {
          kind: "paragraph",
          text: "A platform that can refuse its own revenue on principle is making a claim the seller can actually rely on. That is the feature: not that the deals are cheap, but that the ones that should not happen do not.",
        },
        {
          kind: "faq",
          items: [
            {
              question: "Can a Seller Protection block be overridden for a good deal?",
              answer:
                "No. A block caps the Deal Score at 35, forces a rejection and fails a hard criterion in every mandate, and it cannot be downgraded to a warning. The whole point is that it removes the deal rather than leaving an argument to be had.",
            },
            {
              question: "What happens if a screening question is left blank?",
              answer:
                "Caution increases. An absent answer is treated as a reason to be more careful, never as a pass, because the case where the safeguard cannot see is exactly the case where it is most needed.",
            },
            {
              question: "Why would a business build something that refuses its own revenue?",
              answer:
                "Because the alternative is more expensive. A difficult transaction waved through invites complaints, unenforceable contracts and enforcement action, and the occasional good deal a block costs is far cheaper than any one of those.",
            },
          ],
        },
      ],
    },
  ];
}
