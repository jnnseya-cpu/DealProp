# Go to market — Lode

**Ship date target: 90 days. First £1 of revenue: day 34. First completion: day 76.**

This plan is constrained by two things the codebase already decided, and it is
better for both.

---

## 1. The thesis in one paragraph

Capital is not scarce. UK bridging lending runs at several billion a year and
every lender is hunting deal flow. **Qualified deals are scarce.** So Lode is a
supply-constrained marketplace, and every pound of early spend goes to deal
supply — with one hard precondition: the buy side must be pre-committed first,
because `countInterestedBuyers()` reads live mandates and **the product will
not let us tell a seller that buyers exist when they do not.** That constraint
is the moat. Every competitor's "47 buyers waiting!" is a number in a CMS.
Ours is a database query, and it returns zero until we do the work.

---

## 2. The constraint that inverts the obvious strategy

The instinct in motivated-seller acquisition is to target maximum distress.
Run the numbers the engine actually holds:

| Seller situation | Motivation | Engine verdict |
|---|---|---|
| Repossession proceedings | 96 | **Blocked** — vulnerability flag |
| Urgent cash requirement | 92 | **Blocked** — vulnerability flag |
| Mortgage arrears | 90 | **Blocked** — vulnerability flag |
| Divorce or separation | 78 | **Blocked** — vulnerability flag |
| Chain collapsed | 84 | Servable |
| Difficult tenancy | 80 | Servable |
| Property needs substantial work | 74 | Servable |
| Probate sale | 72 | Servable |
| Landlord exiting | 58 | Servable |

**The four highest-motivation segments are the four the Protection Engine
refuses.** Buying leads there would fill the pipeline with deals that cap at
score 35 and get force-rejected. Every pound spent on "we buy any house,
facing repossession?" advertising is a pound spent generating rejections.

So the target list is the *servable* high-motivation band: **probate,
inherited, landlord exit, needs-major-work, chain collapse, failed listing.**

This is not a compliance compromise. It is a better market: probate executors
are unemotional, usually live elsewhere, frequently own outright, and reach us
through professional gatekeepers who refer repeatedly. Distressed homeowners
reach us once, in crisis, through paid ads.

---

## 3. The wedge — LOCKED

**Launch city: BIRMINGHAM. Locked. No second city before three completions.**

### 3.1 Why Birmingham, decisively

| Factor | Birmingham | Why it matters |
|---|---|---|
| Auction infrastructure | Bond Wolfe HQ — the largest regional auction house by lot volume | Unsold-lot lists are a standing seller-supply channel nobody else works systematically |
| Stock age | Dominated by pre-1945 terraced and semi-detached | Refurbishment need is what excludes mortgage buyers and creates the discount |
| Price band | Bulk of transactions sit in the £150k–£280k range | Matches the bridging-funded buyer exactly; London does not |
| Investor density | Multiple monthly PIN meetings, established sourcing community | Demand side reachable face-to-face in week one |
| Founder proximity | Single-city travel budget, same-day site visits | A first completion needs someone able to stand in the property |

*Verify before spend: pull Land Registry Price Paid Data for B-postcodes over
the last 12 months and confirm the £150k–£280k band is >55% of transactions.
That is a one-hour job and it either confirms or kills the wedge.*

### 3.2 The footprint — specific postcodes, not "Birmingham"

**Target districts (inner and middle ring, terraced, high refurbishment need):**

> **B6, B8, B10, B11, B18, B19, B21, B23, B25, B44**

**Explicitly excluded at launch:**

> **B15, B17, B29 (flats), B30, B45, and all city-centre apartment stock**

### 3.3 The engine already told us where not to go

This is not a hunch. Run the seeded comparables through the Deal Director:

| Postcode | Area | OMV | Margin after tax | Score | Verdict |
|---|---|---|---|---|---|
| B23 | Erdington | £212,000 | **12.4%** | 61 | Negotiate — **works** |
| B17 | Harborne | £268,000 | 5.7% | 46 | Restructure — prime is too expensive |
| B29 | Selly Oak | £168,000 | **−2.4%** | 25 | Loses money — leasehold flat |
| B21 | Handsworth | £245,000 | 24.3% | 35 | **Blocked** — vulnerable seller |

Three targeting rules fall straight out of that table:

1. **£180k–£240k open market value.** Below it the works swallow the margin;
   above it (Harborne, £268k) the entry price leaves 5.7% and the deal has to
   be restructured.
2. **Freehold houses only.** The Selly Oak leasehold flat goes *negative* after
   tax once short lease and cladding are priced in. Do not market to flats.
3. **Skip prime.** Harborne is the nicest area on the list and the worst deal.

### 3.4 The rest of the lock

- **Situation:** probate and inherited property. Secondary: landlord exit,
  failed listing, chain collapse.
- **Buyer:** cash and bridging-funded refurbishment buyers, £150k–£300k tickets.
- **Asset:** freehold house, 2–4 bed, needing modernisation or major works.
- **Widen only after:** three *completions*. Not three listings, not three
  offers. Completions. The second city is Wolverhampton or Coventry — same
  stock profile, same auction house, no new jurisdiction pack required.

## 4. Customer segments

Five segments. Only three of them pay. Rank by who unblocks whom.

### 4.1 Deal supply — sellers (FREE, never charged)

The supply engine. Charged nothing, ever, at launch. Segments in priority order:

1. **Probate executors and beneficiaries** — reached through solicitors, not ads
2. **Accidental landlords / Section 24 exiters** — reached through letting agents and landlord associations
3. **Failed-listing vendors** — reached through expired listings and unsold auction lots
4. **Portfolio disposals** — reached direct, small volume, high value

### 4.2 Deal demand — dealmakers (PAY: £49–£999/mo)

The first revenue. Three sub-segments:

| Sub-segment | Size | Willingness to pay | Reach |
|---|---|---|---|
| Full-time sourcers/investors | Small | **High** — this replaces their spreadsheet | PIN, Property Hub, LinkedIn |
| Semi-pro landlords (3–15 units) | Large | Medium — £49 tier | Facebook groups, podcasts |
| Small developers / builders | Medium | High | Auction houses, merchants |

### 4.3 Capital supply — funders (PAY: £299–£2,500/mo)

Second revenue line, and the credibility anchor. **Recruit before sellers.**

- Bridging lenders (Roma, Hope Capital, MT Finance tier — regional, hungry)
- Private lenders and family offices (£250k–£2m to deploy)
- JV equity partners

### 4.4 Service supply — professionals (PAY: £99–£999/mo, phase 2)

Solicitors, RICS surveyors, brokers, contractors. **Not monetised in the first
90 days** — they are recruited as a service guarantee, not a revenue line.

### 4.5 Enterprise (PAY: £1k–£10k/mo, phase 3)

Property companies, lenders wanting the engine white-labelled. Do not chase
this before month 6; it will consume the whole team.

---

## 5. Suppliers, and how to source them

"Supplier" in a marketplace means four different things. All four need sourcing
before launch.

### 5.1 Capital suppliers — DO THIS FIRST

**Target: 12 signed Funding Boxes before any seller spend.**

Where they are:
- **NACFB member directory** — ~2,000 commercial finance brokers, publicly listed
- **Bridging & Commercial / Development Finance Today** — the trade press; their
  event lists are effectively a target account list
- **NACFB Expo and the Specialist Lending Solutions events** — one day, dozens
  of lenders in a room
- **LinkedIn Sales Navigator** — filter: "bridging" + "underwriter"/"BDM" +
  Midlands

How to source them — the actual approach:
1. Do **not** pitch a marketplace. Every lender has been pitched a lead-gen
   portal and they are all the same.
2. Pitch **underwriting cost reduction**. "You decline 8 of 10 enquiries. We
   send you deals that already passed a nine-component score computed after
   tax, and a nine-scenario stress test, with the criteria you'd fail listed
   before you open the file."
3. **Lead with a rejection.** Show them the Handsworth deal: 24.3% margin,
   £69,375 projected profit, blocked. A platform that refuses its most
   profitable deal is a platform that will not waste their underwriters' time.
4. Ask for a **Funding Box, not money.** Zero commitment: "tell us your mandate,
   we'll only send you deals inside it."
5. Free for the first 12. Charge from lender 13.

**Script (email, 90 words):**
> Subject: We block our highest-margin deal — here's why that's your problem solved
>
> [Name] — we run a deal engine for motivated-seller property in the Midlands.
> Every deal is appraised after tax, stress-tested against nine scenarios, and
> scored on nine components before anyone sees it. Deals that fail our seller
> protection checks never reach you at all.
> Our current highest-margin deal (24.3%, £69k) is blocked and will stay
> blocked. I'd rather show you that than a pitch deck.
> Can I take 15 minutes to set up your mandate? You'll only ever see deals
> inside it. No fee for the first twelve lenders.

### 5.2 Deal suppliers — the probate channel

**Target: 40 seller enquiries/month by day 90.**

The channel is **professional gatekeepers**, not consumers:

| Gatekeeper | Volume | How to reach | The offer |
|---|---|---|---|
| Probate solicitors | High | Law Society find-a-solicitor, filtered to Birmingham + probate | Free property options report for their client, in 48h |
| Will writers / STEP members | Medium | STEP UK directory | Same |
| House clearance firms | High | Google Maps, ~40 in Birmingham | Referral relationship; they see empty properties first |
| Estate agents (expired listings) | High | Rightmove/Zoopla withdrawn stock, contact agent | "We buy your fall-throughs" |
| Auction houses (unsold lots) | Medium | Bond Wolfe, SDL — post-auction unsold list | Direct approach to the vendor via the auctioneer |
| Letting agents (landlord exits) | High | Local branch visits | Referral fee where lawful |

**How to actually convert a probate solicitor:** they cannot recommend a buyer
(conflict, and their duty is to the estate). They *can* signpost a free
valuation-and-options service. That is what the seller journey is. The pitch is
"your client gets four costed routes and a written statement of what a buyer
would make — you get an executor who stops calling you about the house."

### 5.3 Service suppliers — the fast-close panel

**Target: 3 solicitors, 2 RICS surveyors, 2 contractors by day 60.**

Source: personal introductions from the first funders (bridging lenders know
exactly which solicitors complete fast — ask them). Selection criterion is a
committed SLA, not price: file review in 4 working hours, queries in 24.

### 5.4 Technology vendors

| Need | Options | Decision point |
|---|---|---|
| Transactional email | Postmark, Resend, SES | Day 1 — newsletter and confirmations already need it |
| KYC/AML | Sumsub, Persona, Veriff | Before first completion (HMRC requirement) |
| Property data | Sprift, PropertyData, LandInsight | Day 30 — replaces seller-estimated valuations |
| Comparable evidence | Land Registry PPD (free), Rightmove API (licensed) | Day 45 |
| Database | Neon / Supabase Postgres | Day 30 — before concurrent writes are real |
| E-signature | Docuseal (self-host), Dropbox Sign | Day 60 |

**Do not scrape.** The GoldMine engine is deliberately unwired for this reason.
Sprift or PropertyData licences cost £100–£300/mo and remove the entire legal
risk.

---

## 6. The first 100 paying customers

Sellers are free. "100 customers" = 100 paying accounts. Here is exactly where
they come from.

| # | Cohort | Source | Conversion assumption | Paying |
|---|---|---|---|---|
| 1 | Founding 12 funders | Direct outreach, NACFB + trade press | 12 free → 8 convert at £299 from month 4 | 8 |
| 2 | PIN meeting circuit | 6 Midlands meetings × ~60 attendees | 360 reached → 8% to trial → 45% paid | 13 |
| 3 | Bond Wolfe auction room | 4 auctions × ~200 attendees | Table + QR, 3% scan → 25% paid | 6 |
| 4 | Property Hub / podcast ads | 2 sponsored reads | ~12k listeners → 0.6% trial → 40% paid | 29 |
| 5 | Facebook groups (organic) | 8 UK property groups, value posts not ads | 20 posts → 400 clicks → 12% paid | 12 |
| 6 | LinkedIn founder-led | 5 posts/wk, deal teardowns | 250 profile visits/wk → 15 trials/mo | 14 |
| 7 | Weekly newsletter | Already built, double opt-in | 900 subs → 3% to paid | 8 |
| 8 | Referral (existing users) | 1 free month per referral | 90 users → 0.5 each → 25% paid | 10 |
| 9 | Auction house partnership | Co-branded "unsold lot rescue" | 40 vendors → buyers follow deals | 6 |
| | **Total** | | | **106** |

**The single highest-leverage line is #4 and #6 — content, not ads.** Property
investors do not respond to display advertising; they respond to a teardown of
a deal where someone shows their working and then says "and that's why I'd
walk away."

### The content engine that makes 4, 5, 6 and 7 work

One asset, republished five ways, weekly:

1. **Run a real deal through the engine.** Real address, real numbers.
2. **Publish the rejection.** "£69k profit. We blocked it. Here's why."
3. Cut into: LinkedIn post, YouTube short, newsletter section, Facebook value
   post, podcast talking point.

Nobody else in this market publishes the deals they turned down. It is the
cheapest possible differentiation and it is already true of the product.

---

## 7. The 30 / 60 / 90 day plan

Budget assumes a lean two-person team. Every phase has a **go/no-go gate**.

### Days 0–30 — "Make the buyer count true"

**Objective: 12 signed Funding Boxes, 25 Buy Boxes, zero seller marketing.**

| Week | Workstream | Actions | Owner | Cost |
|---|---|---|---|---|
| 1 | Legal | Start HMRC AML registration (allow 4–6 weeks). Instruct solicitor on estate-agency perimeter. PI insurance quote. | Founder | £2,000 |
| 1 | Product | Ship `/invest` + `/capital` (Buy Box / Funding Box CRUD). Ship auth. | Eng | — |
| 2 | Capital | 60 lender approaches. Target 12 mandates. | Founder | £0 |
| 2 | Product | Postgres migration. Email provider live. | Eng | £50/mo |
| 3 | Demand | LinkedIn content begins: 5 posts/wk, deal teardowns. | Founder | £0 |
| 3 | Legal | Redress scheme application. Terms of business drafted. | Solicitor | £1,500 |
| 4 | Capital | Close remaining mandates. Publish real counts. | Founder | £0 |

**GATE at day 30 — do not proceed without:**
- ≥ 10 active Funding Boxes in the database
- ≥ 20 active Buy Boxes
- HMRC AML application submitted
- `/deals` behind auth

*Rationale: the seller page tells the truth. Marketing to sellers before this
produces a page that says "no buyer currently has a mandate matching your
property." That kills the channel permanently.*

### Days 31–60 — "Turn on supply"

**Objective: 40 seller enquiries, first paid subscriptions, first offer accepted.**

| Week | Workstream | Actions | Owner | Cost |
|---|---|---|---|---|
| 5 | Supply | 40 probate solicitors approached. Target 8 referral relationships. | Founder | £400 |
| 5 | Revenue | **Turn on subscriptions.** £49/£149/£399. First £1 of revenue. | Eng | — |
| 6 | Supply | House clearance + letting agents. 30 approaches. | BD | £300 |
| 6 | Demand | Podcast sponsorship booked (Property Hub tier). | Founder | £2,500 |
| 7 | Supply | Bond Wolfe unsold-lot partnership. First auction attended. | Founder | £200 |
| 7 | Product | Data licence live (Sprift/PropertyData) — replaces seller estimates. | Eng | £250/mo |
| 8 | Ops | Fast-close panel signed: 3 solicitors, 2 surveyors. | BD | £0 |

**GATE at day 60:**
- ≥ 25 seller enquiries received
- ≥ 15 paying subscribers (≈£1,800 MRR)
- ≥ 1 offer accepted by a seller
- AML registration **granted** (if not, no completion can proceed)

### Days 61–90 — "Complete one, then prove it repeats"

**Objective: first completion, 40+ paying customers, repeatable channel identified.**

| Week | Workstream | Actions | Owner | Cost |
|---|---|---|---|---|
| 9 | Transaction | Drive deal 1 through Close Score to exchange. | Founder | — |
| 9 | Demand | PIN circuit: 3 meetings, speak if possible. | Founder | £600 |
| 10 | Revenue | Success fee live (post-AML only). 0.75%. | Founder | — |
| 10 | Content | Publish completion case study with real figures. | Founder | £0 |
| 11 | Capital | Convert founding funders to £299/mo. | Founder | — |
| 11 | Scale | Double down on whichever of channels 4/5/6 has lowest CAC. | Founder | £3,000 |
| 12 | Review | Cohort analysis. Kill the two worst channels. | Founder | — |

**GATE at day 90 — the honest test:**
- ≥ 1 completion, ≥ 2 in legals
- ≥ 40 paying customers (≈£5,000 MRR)
- CAC < £300 on at least one channel
- ≥ 30% of month-1 subscribers still paying

### Budget — itemised

Every line is a real, purchasable item at a current UK price. Figures marked
**†** are statutory or published fees that change — verify before committing.

**Legal and regulatory — £4,931**

| Item | Basis | Cost |
|---|---|---|
| HMRC AML registration † | £300 per premises + £40 per approved person × 2 | £380 |
| Redress scheme membership † | Property Redress Scheme, one branch, annual | £249 |
| ICO data protection registration † | Tier 1, annual | £52 |
| Professional indemnity insurance | £1m cover, annual premium | £850 |
| Regulatory perimeter advice | Solicitor, 8 hrs @ £275 — estate agency + financial promotion | £2,200 |
| Terms of business + seller disclosure pack | Fixed fee drafting | £1,200 |

**Technology and data — £1,113 (3 months)**

| Item | Basis | Cost |
|---|---|---|
| Hosting (Vercel Pro) | £16/mo × 3 | £48 |
| Postgres (Neon Scale) | £22/mo × 3 | £66 |
| Transactional email (Postmark 50k) | £42/mo × 3 | £126 |
| Google Workspace | 2 seats × £11/mo × 3 | £66 |
| Property data licence (PropertyData Pro) | £109/mo × 3 | £327 |
| KYC/AML verifications | ~40 checks @ £4 | £160 |
| Land Registry title downloads † | 40 titles @ £7 | £280 |
| Domain and certificates | Annual | £40 |

**Marketing and demand — £4,735**

| Item | Basis | Cost |
|---|---|---|
| Podcast sponsorship | 2 mid-roll reads @ £1,250 | £2,500 |
| LinkedIn Sales Navigator | £80/mo × 3 | £240 |
| Video editing, weekly deal teardowns | £250/mo × 2 | £500 |
| Brand assets and solicitor one-pager design | One-off | £800 |
| Print collateral | 500 one-pagers @ £0.35 | £175 |
| Direct mail to probate solicitors | 200 letters @ £0.85 | £170 |
| PIN meeting entry | 6 meetings @ £25 | £150 |
| Auction attendance materials | Stand and collateral | £200 |

**Events and travel — £1,000**

| Item | Basis | Cost |
|---|---|---|
| Birmingham travel | 12 trips @ £50 | £600 |
| NACFB Expo attendance | Ticket and travel | £150 |
| Partner hospitality | Lender and solicitor meetings | £250 |

**People — £3,000**

| Item | Basis | Cost |
|---|---|---|
| BD contractor, seller-side outreach | 2 days/week × 6 weeks @ £250/day | £3,000 |

**Totals**

| Category | Cost |
|---|---|
| Legal and regulatory | £4,931 |
| Technology and data | £1,113 |
| Marketing and demand | £4,735 |
| Events and travel | £1,000 |
| People | £3,000 |
| Subtotal | **£14,779** |
| Contingency @ 15% | £2,217 |
| **90-day total** | **£16,996** |

**Explicitly NOT in the 90-day budget:**

| Item | When | Cost |
|---|---|---|
| Marketing agency retainer | Day 91+, only after a channel works | £2,500/mo |
| Paid search / Meta | Not before product-market fit | £0 |
| FCA authorisation (credit broking) | Month 6+, if funding fees are pursued | £1,500 application + adviser fees |
| Second city launch | After 3 completions | ~£6,000 |

**Steady-state run rate from day 91: £1,850/month** (tooling £371 + data £109
+ contractor £2,000 → reduces to £1,850 once the contractor drops to 1 day/wk).

---

## 8. Pricing at launch

Ship three tiers, not five. Two of the eight revenue streams are legally gated.

| Tier | Price | Live at launch? |
|---|---|---|
| Explorer | Free | Yes |
| Investor | £49/mo | Yes |
| DealMaker | £149/mo | Yes — the intended default |
| Professional | £399/mo | Yes |
| Funder membership | £299/mo | Month 4 (free for founding 12) |
| **Deal success fee** | 0.75% | **Gated: HMRC AML + redress scheme** |
| **Funding introduction** | 0.5% | **Gated: FCA authorisation or AR status** |

`dealRevenue()` already excludes gated streams and reports what is being
forgone. Use that number in board reporting — it is the cost of the permissions
backlog, quantified.

**Anchor on the DealMaker tier.** One avoided bad deal pays for four years of
subscription. Say that in those words.

---

## 9. Customer acquisition — the maths

**Investor LTV:** £149 × 11 months average = **£1,639 gross.**
**Target CAC: ≤ £300.** Payback: 2 months.

| Channel | Est. CAC | Scalable? | Verdict |
|---|---|---|---|
| Founder-led LinkedIn | £40 | To a ceiling | **Start here** |
| Podcast sponsorship | £190 | Yes | **Scale this** |
| Newsletter → paid | £25 | Slowly | Compounds |
| PIN / events | £280 | Manual | Keep, don't scale |
| Facebook groups (organic) | £60 | No | Founder time only |
| Google Ads "property sourcing" | £450+ | Yes | **Do not start** |
| Meta ads to investors | £600+ | Yes | **Do not start** |

**Do not buy paid search in month 1.** The keywords in this market are
contested by lead-gen firms with far higher tolerance for junk leads. Content
and community win on cost by an order of magnitude at this stage.

---

## 10. Marketing partner — recommendation

**Recommended agency: [marketwaros.com](https://www.marketwaros.com/)**

I could not open the site from this environment (blocked by the network egress
proxy), so I have not verified their service list, pricing or case studies —
that verification is a task for you, not something to take on trust from this
document. What follows is the brief to hand them and the criteria to judge them
against, both of which hold regardless of what they offer.

### The brief

> Lode is a Property Deal OS. Three sides: motivated sellers (free), dealmakers
> (£49–£399/mo), capital providers (£299+/mo). Wedge: probate and inherited
> property in Birmingham. Constraint: we operate inside a regulated perimeter
> — estate agency AML, FCA financial promotion rules — so no claim about
> guaranteed funding, guaranteed sale, or returns may be made in any asset.
>
> We need, in 90 days:
> 1. A content engine producing one deal teardown per week, cut five ways.
> 2. Positioning that makes "the AI that says no" the memorable line.
> 3. Distribution into UK property investor communities — podcasts, YouTube,
>    LinkedIn — not display advertising.
> 4. Attribution we can actually read at 40 customers, not 40,000.

### How to judge them — five questions

1. **"Show me a regulated-sector client."** Property finance sits near FCA
   perimeter. An agency that has only done ecommerce will write copy that
   creates a compliance problem.
2. **"What would you *stop* us doing?"** An agency that only adds channels is
   selling hours.
3. **"How do you attribute at low volume?"** At 40 customers, multi-touch
   attribution is noise. The right answer is "we ask every customer, by hand."
4. **"Who writes the copy — and have they sat in a property investor meeting?"**
5. **"What's the 30-day exit?"** Never sign 12 months pre-product-market-fit.

### Budget guidance

Do not spend more than **£2,500/month** on agency retainer before day 90. Below
40 customers the founder's own LinkedIn will outperform any agency, because the
credibility is personal. Bring an agency in to *scale a channel that already
works*, never to find one.

---

## 11. The metrics that matter

**North star: completions.** Everything else is a leading indicator.

| Metric | Day 30 | Day 60 | Day 90 |
|---|---|---|---|
| Active Funding Boxes | 10 | 14 | 20 |
| Active Buy Boxes | 20 | 35 | 60 |
| Seller enquiries / mo | 0 | 25 | 40 |
| % enquiries with ≥1 buyer match | — | 40% | 60% |
| Paying customers | 0 | 15 | 40 |
| MRR | £0 | £1,800 | £5,000 |
| Deals in legals | 0 | 1 | 3 |
| **Completions** | 0 | 0 | 1 |
| Blended CAC | — | £350 | £300 |

**The one diagnostic nobody else tracks:** *% of seller enquiries where the
best route pays less than the seller's stated minimum.* If that is above 60%,
the wedge is wrong — we are talking to sellers whose expectations no investor
can meet, and no amount of marketing fixes it.

---

## 12. Risks and kill criteria

| Risk | Likelihood | Mitigation | Kill signal |
|---|---|---|---|
| AML registration delayed past day 60 | Medium | Apply day 1; 4–6 week lead time | No completion possible — pause seller spend |
| Funders won't commit a mandate without deal flow | **High** | Free founding cohort; lead with the blocked deal | <6 mandates by day 30 → the wedge is wrong |
| Sellers' price expectations exceed viable routes | Medium | Track the diagnostic in §11 | >60% for two months → change segment |
| Investors won't pay for analysis | Medium | Free tier proves value first | <8% trial→paid → pivot to funder-side revenue |
| Competitor copies the "we block deals" line | Low | They can copy the line; they cannot copy a code path that costs them revenue | — |

**Overall kill criterion at day 90:** zero completions *and* under 20 paying
customers *and* no channel under £400 CAC. Any two of three is a pivot; all
three is a stop.

---

## 13. The four sentences the whole plan rests on

1. Recruit capital before sellers, because the product will not let us lie
   about demand.
2. Target the servable high-motivation segments, not the distressed ones the
   engine refuses.
3. Sell judgement, not listings — publish the deals we reject.
4. One city, one situation, one buyer type, until three deals complete.
