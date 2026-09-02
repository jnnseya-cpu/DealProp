# Lode — Property Deal OS

**Problems become deals. Deals find capital. Capital closes property.**

Lode is not a property portal. A portal optimises discovery: here is a house,
here is its price. Lode optimises *structuring*: here is a seller's situation —
can it become a transaction that survives tax, stress testing and completion?

It is built for the seller who says "I need a solution", not the one who wants
the highest possible price and can wait six months. That seller is not the
customer, and the product says so.

---

## Going live

`docs/GO-LIVE.md` is the runbook, and `npm run preflight` is the gate. It
checks configuration rather than assuming it — secret strength, HTTPS origin,
Postgres reachability, whether an administrator account exists, whether email is
half-configured — and exits non-zero on anything blocking, so it belongs in the
deploy pipeline rather than in a document nobody reads.

`/api/health` returns 200 with the store reachable and 503 when it is not, for
the platform's health check. It is unauthenticated and therefore deliberately
uninformative: no version, no hostnames, no error text.

## Quick start

```bash
npm install
npm run seed      # writes the file-backed store to .data/
npm run dev       # http://localhost:3000
npm test          # 772 tests
npm run typecheck
npm run preflight # is this safe to put in front of the public?
```

---

## What is actually built

Every page is live and driven entirely by the engine. What is missing is
listed honestly in [Not built yet](#not-built-yet).

| Page | Route | What it does |
|---|---|---|
| Landing | `/` | Five audience doors, the positioning, the launch focus; every figure computed at render time |
| Free appraisal | `/appraise` | True discount, walk-away price and Red Team. No account, nothing stored |
| Agents and capital | `/partners` | Referral route, what a funder is shown, what we are not supervised for |
| Seller intake | `/sell` | Situation first, price fourth; screening feeds Seller Protection |
| Seller options | `/sell/[id]` | Routes with what the seller receives, when, and what they give up |
| Pipeline | `/deals` | Every opportunity scored after tax, blocked deals included |
| Deal Room | `/deals/[id]` | Verdict, full model, Red Team, capital stack, matched mandates |
| Memorandum | `/deals/[id]/memorandum` | Print-ready pack from the same briefing, with the promotion notice |
| Funding | `/deals/[id]/funding` | Readiness, true cost, net advance, ratios, offers, evidence |
| Negotiation | `/deals/[id]/negotiation` | Opening, target, walk-away and floor, computed from the engine |
| Agents | `/deals/[id]/agents` | The nine agents, what each proposes, and who has to decide |
| Fees | `/deals/[id]/fees` | What may be invoiced, what is blocking the rest, and raising it |
| Opportunities | `/opportunities` | The marketplace, ranked by what can be established rather than by discount |
| Opportunity | `/opportunities/[id]` | Category, score, evidence used and missing, the reveal, the refund claim |
| Passport | `/account/passport` | Identity, funds and conveyancer — the gate on reaching a seller |
| Material information | `/deals/[id]/material` | Parts A, B and C; Part A unanswered stops the property being marketed |
| Seller checks | `/deals/[id]/seller-checks` | Identity, screening, authority to sell, beneficial owners, risk assessment |
| Conduct | `/operator/conduct` | The twelve prohibitions and the control enforcing each one |
| Discovery | `/operator/discovery` | Run discovery, review candidates, approve or suppress |
| Outreach | `/operator/outreach` | Draft, approve, send; suppression list |
| Opt out | `/outreach/opt-out` | One click, no account, no confirmation step |
| Data room | `/dataroom/[token]` | One funder's expiring, watermarked view of one deal |
| Your billing | `/account/billing` | Plan, balance, top up, change plan |
| Blog | `/blog` | Posts written by the agent from real engine output |
| Post | `/blog/[slug]` | Auto-linked glossary terms, related posts, JSON-LD |
| Topic hub | `/blog/topic/[topic]` | Six hubs, each linking its posts and definitions |
| Glossary | `/glossary`, `/glossary/[slug]` | Definition pages, linked from every mention |
| Newsletter | `/newsletter` | Double opt-in signup, confirm and one-click unsubscribe |
| Buy Boxes | `/invest` | Investor mandates, each shown against the deals it matches |
| Funding Boxes | `/capital` | Capital mandates, each shown against the deals it funds |
| Sign in | `/operator` | Named account, or the shared password as bootstrap |
| Accounts | `/operator/accounts` | Create, disable, see certification status |
| Audit trail | `/operator/audit` | Append-only: who saw what, and when |
| Blog performance | `/operator/blog` | Opens per post and the SEO audit, worst first |
| Billing | `/operator/billing` | Plans, balances, refundable cash, dispute costs, adjustments |
| Certification | `/account/certify` | Investor self-certification under the FPO |
| Offline | `/offline` | Service-worker fallback; deliberately shows no figures |

| Engine | File | What it does |
|---|---|---|
| Money primitives | `src/shared/money.ts` | Integer pence behind a branded type |
| Jurisdiction packs | `src/shared/domain/jurisdictions/` | All country-specific law, isolated |
| Appraisal | `src/shared/domain/economics.ts` | Full cost stack, after-tax profit, true discount |
| Seller diagnostics | `src/shared/domain/motivation.ts` | Motivation, urgency, complexity, flexibility |
| Seller Protection | `src/shared/domain/protection.ts` | Can **block** a deal outright |
| Red Team | `src/shared/domain/redteam.ts` | Nine stress scenarios, tiered |
| Deal Score | `src/shared/domain/dealScore.ts` | Nine components + verdict |
| Capital Stack | `src/shared/domain/capitalStack.ts` | The £0-own-capital solver |
| Strategy Router | `src/shared/domain/strategies.ts` | 14 strategies tested, most rejected |
| GoldMine | `src/shared/domain/goldmine.ts` | Stale-listing mining, why-unsold diagnosis |
| Matching | `src/shared/domain/matching.ts` | Buy Box / Funding Box, explainable |
| Close | `src/shared/domain/completion.ts` | Close Score, blockers, critical path |
| Revenue | `src/shared/domain/revenue.ts` | Monetisation, permission-gated |
| Deal Director | `src/shared/domain/director.ts` | Runs everything, returns one position |
| Seller intake | `src/shared/domain/intake.ts` | Seller answers → engine inputs, with Truth Engine checks |
| Seller routes | `src/shared/domain/sellerRoutes.ts` | Inverts the engine: what the *seller* receives |
| Working deal | `src/shared/domain/workingDeal.ts` | Prices an enquiry that has no agreed price yet |
| Newsletter | `src/shared/domain/newsletter.ts` | Consent gating, weekly idempotency, issue composition |
| Trade partners | `src/shared/domain/partners.ts` | Who does the works, why, and the disclosure |
| Analytics gate | `src/shared/domain/analytics.ts` | Which routes and events a pixel may ever see |
| SEO audit | `src/shared/domain/seo.ts` | Scores every post against what this codebase controls |
| Negotiation | `src/shared/domain/negotiation.ts` | The price band, and the number that says stop |
| Appraisal request | `src/shared/domain/appraisalRequest.ts` | A stranger's figures into engine inputs, with every default declared |
| Supply | `src/shared/domain/supply.ts` | How many deals, where and how often — counted, never claimed |
| Permissions | `src/shared/domain/permissions.ts` | One catalogue, evidenced. A bare key grants nothing |
| Fees | `src/shared/domain/fees.ts` | What may actually be invoiced now, and what is stopping the rest |
| Company identity | `src/shared/domain/identity.ts` | The statutory disclosures, read from configuration and never invented |
| Agents | `src/shared/domain/agents.ts` | Nine triggers, nine outputs, and the four things accepting one can do |
| Owner lookup | `src/backend/discovery/owners.ts` | Who owns one title, and how they may lawfully be approached |
| Borrowing | `src/shared/domain/borrowing.ts` | Total cost of a facility, and what actually arrives on the day |
| Funding metrics | `src/shared/domain/fundingMetrics.ts` | LTV, LTGDV, LTC, funding gap, exit headroom, refinance cover |
| Finance readiness | `src/shared/domain/fundingReadiness.ts` | Is this pack ready for a funder, and what is missing |
| Regulatory routing | `src/shared/domain/regulatoryRoute.ts` | Which perimeter an introduction falls under, and whether it may proceed |
| Outreach | `src/shared/domain/outreach.ts` | Whether contacting a funder would be lawful, before anything is drafted |
| Catalogue | `src/shared/domain/pricing.ts` | Every price, plan limit and tax decision, in one place |
| Entitlements | `src/shared/domain/entitlements.ts` | What a plan grants, and exactly when it stops |
| Ledger | `src/shared/domain/ledger.ts` | Prepaid balance: lots, spend, refund, chargeback, expiry |
| Charge gate | `src/shared/domain/charging.ts` | Whether a charge may happen, and for how much |
| Email transport | `src/backend/email.ts` | Provider-agnostic, fails closed when unconfigured |
| Store | `src/backend/store/` | One interface, two engines: Postgres or a JSON file |

---

## Where each layer runs

One application, one database. `src/backend`, `src/shared` and `src/app` are a
source split, not a deployment split — they compile into a single Next.js
server, and the split governs what may import what.

| Source | Runs | In the browser bundle? |
|---|---|---|
| `src/shared` | Both sides | **Yes** — the only layer that is. Pure, no Node APIs, no `process.env` |
| `src/backend` | Server only | **Never** — store, credentials, email, discovery, outreach, agents |
| `src/app` | Server by default | Only `"use client"` files, none of which may import `@backend/` |
| `src/middleware.ts` | The edge, ahead of every matched request | No |

The last column is a security boundary rather than a tidiness preference. A
client component importing `@backend/` would ship the store, the `pg` driver and
every `process.env` read it touches to the visitor — and the build would
succeed. `tests/boundaries.test.ts` fails instead.

`docs/GO-LIVE.md` has the deployment itself: Vercel with the crons in
`vercel.json`, or the `Dockerfile` and `output: "standalone"` anywhere else.

---

## Deal flow, stated rather than implied

An investor's first question is not what the appraisal engine does. It is how
many deals, where, and how often — because an appraisal engine with nothing
behind it is a spreadsheet with better manners. The landing page answered none
of the three, and the figures it *did* show ("verified buyers: 1") were read
from the seed fixtures on a page whose own claim is that every number is
computed.

`supply.ts` computes the answer from the platform's own records and the answer
is allowed to be small. A live count of four is more persuasive than silence: a
reader who cannot find a number assumes the worst one, and a figure that moves
when the platform moves is the only kind worth believing. With an empty store it
says so — *"There is nothing here to match a mandate against, and saying
otherwise would be the first thing you found out was untrue."*

Three things it will not do:

- **Count a blocked deal as available.** Seller Protection stopping a deal is
  the point of the engine; a supply figure that quietly included them would be
  the one number on the page that was a lie.
- **Quote a rate before there is history for one.** Two deals entered on the
  same afternoon are not "one every zero days", they are a seeding. Below eight
  records, or with no span between the first and the last, it says it is too
  early instead.
- **Report any return, yield or margin.** A public statement that opportunities
  are available at a given return is an inducement to engage in investment
  activity, and under FSMA s.21 only an authorised person may communicate or
  approve one. Counts, coverage and cadence are facts about the business; the
  economics stay behind investor categorisation, where `can()` already puts
  them. There is a test asserting none of those words can appear in the output.

The worked example on the landing page is now labelled as one. It had a green
dot and the word "Live" beside a seeded probate deal, which is the single claim
on that page a reader could check and catch.

---

## The look

Three self-hosted typefaces, loaded by `next/font` at build time so there is no
runtime request to Google, nothing third-party to disclose and nothing for the
CSP to allow: **Instrument Sans** for the interface, **Newsreader** for prose
and headlines, **IBM Plex Mono** for references and codes. The stack before
them was `ui-serif` and `ui-sans-serif`, which resolve to whatever the visitor's
operating system happens to ship — a financial document that renders in a
different typeface on every machine is not a designed document, it is a default
one, and it reads as such.

The rest of the system is in `src/app/globals.css`, and four rules carry most of
it:

- **Surfaces are opaque and layered**, with a visible 1px edge, rather than an
  alpha wash over black. Depth comes from a few solid steps and an edge; a page
  of translucent rectangles has no hierarchy at all.
- **Geometry is close to square** — the radius scale is overridden so
  `rounded-2xl` is 10px. Nothing is a pill except a dot or a progress bar.
- **Density is the default.** Body is 15px and most of the interface is 12–14px,
  because most of this product is dense financial information. A headline earns
  its size by being rare.
- **Colour means something.** The accent is used for figures and verdicts, not
  for decoration; a notice is a 2px rule down the left edge rather than a tinted
  box; and every section label is the same quiet grey, because a gold label on
  every panel is a background colour that spells words.

Tabular data is a table. The pipeline was four cards a thousand pixels wide with
the reference at one end and the score at the other — the two figures a reader
compares, placed as far apart as the screen allows. It is now a table with
right-aligned tabular numerals, and it collapses to reference, property and
score on a phone.

---

## The five decisions that matter

### 1. Money is integer pence, never floats

`src/shared/money.ts` exposes a branded `Money` type. At transaction scale a
half-penny drift compounds into visible disagreement between the deal model,
the memorandum and the completion statement. "The numbers don't tie" destroys
credibility faster than a bad deal does.

### 2. The Deal Score is computed after tax

A pre-tax appraisal overstates every deal, and overstates marginal ones most —
exactly where the decision matters. `profitTax` sits on the jurisdiction pack
alongside transfer tax, and `appraise()` returns `profit` already net of it.
Every score, verdict and match reads the after-tax figure.

The engine also reports **true discount**: total money deployed against open
market value. A property bought 19% "below market" that costs 19% of value to
transact and repair is not a discount, and the engine says so with a negative
number.

### 3. Seller Protection can block, not just warn

The commercial temptation in motivated-seller acquisition is to convert
distress into discount. That route produces complaints, unenforceable contracts
and enforcement action. So protection is not advisory here:

- a `block` caps the Deal Score at 35 and forces a `reject` verdict
- a blocked deal fails a **hard** criterion in every Buy Box and Funding Box
- `countInterestedBuyers` returns zero for it

Blocks fire on capacity concerns, reported third-party pressure, an elderly
seller combined with a large discount, and discounts beyond the review
threshold. Missing safeguards raise caution rather than passing silently:
absent evidence is treated as a reason to be *more* careful, never less.

### 4. Jurisdiction packs isolate the law

Nothing outside `src/shared/domain/jurisdictions/` may hardcode SDLT, "solicitor", or
any other England-shaped assumption. England/NI and Scotland are implemented
with genuinely independent tax tables — LBTT bands differ, the Additional
Dwelling Supplement is 8% against SDLT's 5%, and Scotland has no non-resident
surcharge. A test asserts the two produce different numbers at the same price,
so the abstraction cannot rot into a fiction.

Every pack carries an `asOf` date and citations. **Rate tables are dated
snapshots and will go stale.** The tests in `tests/tax.test.ts` pin them
deliberately: a silent rate change is the most dangerous failure mode in the
system, because every downstream number stays plausible.

`US-GEN` is an explicit placeholder that models no real state, and Wales is
flagged as not deal-ready because Land Transaction Tax is not yet implemented.
Both are excluded from `isDealReady()`.

### 5. Everything explains itself

Each Deal Score component carries a `rationale` string. Each match returns the
criteria it met *and* missed. Each rejected strategy says why. A score a lender
cannot interrogate is worth nothing to them, and a "92% match" that turns out
to breach a hard mandate limit destroys credibility with the users who are
hardest to acquire.

---

## Three engines worth reading

**Strategy Router** (`strategies.ts`) tests 14 structure/exit combinations
against one property. The rejections are the product: an investor told "cash
purchase fails because the seller's minimum exceeds any viable ceiling, but an
assisted sale clears both" has learned something reusable. Structures whose
cash-flow shape differs from an ordinary purchase — options, lease options,
assisted sales — are marked `approximate` rather than silently mispriced.

**Red Team** (`redteam.ts`) runs nine fixed scenarios. They are tiered:
*single-factor* stresses move one variable, and losing money in one means the
deal depends on a single assumption holding — that caps the score. *Compound*
scenarios stack several severe moves; the most extreme is built to be nearly
unpassable, so failing only that is normal and is weighted proportionately.
Scoring both identically flattens every deal into one band and tells users
nothing.

**Capital Stack** (`capitalStack.ts`) assembles third-party money so an
originator with no cash can transact. It enforces the honest framing: the
capital does not disappear, someone provides every pound and prices it. If
nothing is left for the originator after every provider takes their return, the
solver says so rather than inventing a structure.

---

## Weekly newsletter

`/newsletter` collects subscribers by **double opt-in**: an address is stored
as `pending` and is not mailable until the owner clicks the emailed link.
`/api/cron/newsletter` sends the weekly issue and is meant to be driven by a
scheduler — `vercel.json` points at 08:00 Monday.

Four properties are enforced by tests rather than by convention:

- **Only confirmed addresses are ever mailed.** `mailableSubscribers()` is the
  single selection path, and pending, unsubscribed and bounced are all excluded.
- **A send cannot happen twice.** Recipients are chosen by ISO week and stamped
  once sent, so a scheduler firing twice, a retry, or a manual re-run after a
  partial failure will not mail anyone the same issue again.
- **Every issue carries a working unsubscribe** and the sender's identity. This
  is a legal requirement, not a nicety.
- **The endpoint fails closed.** No `CRON_SECRET` means it returns 503 rather
  than running; no email credentials means the transport logs instead of
  sending. A half-configured deployment must not mail real people.

Sellers who submit an enquiry are **never** enrolled. Telling us about a
property is not consent to be marketed at, and those sellers are in probate,
repossession and financial distress.

Configuration lives in `.env.example`. No credentials are in this repository.

## Installable app and splash screens

The app installs to a home screen and launches standalone with a branded splash.

### Running to the edges without running under them

`viewport-fit=cover` and a translucent status bar are what let the app fill a
phone screen — and, with nothing else done, they are also why the header sits
under the notch and the last row of a table sits under the home indicator. That
is the giveaway that an installed app is a website in a shell, and it is fixed
in `globals.css`: `.app-header` grows into `env(safe-area-inset-top)` so its own
background fills the cutout, `.app-safe-bottom` and `main` clear the home
indicator, and the body takes the left and right insets for landscape. The
insets are zero in a browser tab and on any device without a cutout, so none of
it is conditional.

Three other defaults are right for a document and wrong for an application, and
are changed on touch inputs only: the grey flash on tap, rubber-banding the
whole app past its own background, and iOS enlarging text on rotation. Touch
targets grow by padding — never by setting `display`, which is how the first
attempt silently deleted Tailwind's `flex` from every link on the site.

The two platforms do the splash completely differently, and both are covered:

- **Android and desktop Chrome** generate the splash from `app/manifest.ts`
  alone — `background_color` fills the screen and the largest icon is centred on
  it. There is no splash image to supply, which is why `background_color` must
  equal the app's own background or the launch flashes one colour and repaints
  another.
- **iOS ignores the manifest splash entirely** and matches an
  `apple-touch-startup-image` by exact media query. A device with no matching
  entry shows a blank white screen on launch, which reads as a crash. 22 images
  cover 11 device families in both orientations.

`src/shared/pwa.ts` is the single source for the device table, icon set and
colours; the asset generator and the document head both read it, so a device
cannot be listed in one and missing from the other. Tests assert every declared
image exists on disk and every media query is unique.

```bash
npm run pwa:assets   # regenerate all icons and splash images
```

Assets are generated from markup by the Chromium that Playwright already
provides, so there is no image-processing dependency and no hand-exported
binaries to drift from the brand. The splash is deliberately a flat field: the
app's radial hero glow made the same set 9.1 MB, because a smooth gradient
across 2732px is millions of near-identical colours that PNG cannot compress.
Flat, the whole set is 690 kB.

The service worker is intentionally minimal — it makes the app installable and
serves an offline fallback, and caches nothing data-bearing. Every page renders
live figures, and a cache-first worker would serve yesterday's Deal Score as
though it were current.

## Go-to-market plan

`docs/GO-TO-MARKET.md` is the operating plan: Birmingham locked as the launch
city with a named postcode footprint, the 30/60/90 day phases with a go/no-go
gate on each, the first 100 paying customers by channel, and a 90-day budget
itemised to £16,996.

```bash
npm run docs:pdf     # renders docs/GO-TO-MARKET.pdf from the markdown
```

The markdown is the source; the PDF is generated from it by the same Chromium
Playwright already provides, so the downloadable document cannot drift from the
one in the repository. Tests in `tests/gtmPdf.test.ts` assert every table in the
source reaches the output and that no markdown survives unconverted.

## Not built yet

Deliberately out of scope for this slice, in rough priority order:

- **Portal listing data.** Still refused, permanently and by code — see
  [Where the data comes from](#where-the-data-comes-from). The signals GoldMine
  wanted from listings now come from open sources instead.
- **A payment provider.** Everything behind one is built and tested — catalogue,
  ledger, entitlements, the verified webhook, the enforcement points — but
  nothing takes a card. What remains is mapping one provider's payload into the
  event shape `/api/billing/webhook` already handles, and a checkout page. See
  [The money side](#the-money-side).
- **Reconciliation against the provider.** The ledger is the record of what this
  platform believes; comparing it to what the provider believes is a job that
  does not exist yet, and a divergence would currently go unnoticed.
- **Dunning email.** A failed payment reduces entitlement correctly and tells
  nobody.
- **A checkout page.** `authorisePurchase()` and `coolingOff()` are the seam a
  checkout will call and are unreachable until one exists. They are tested but
  not yet wired, which is stated here rather than left to be discovered.
- **Stopping one person opening several accounts.** One trial per account is
  enforced; one trial per *person* is not, and nothing in an application can do
  it. That belongs at the provider, which can see the card, and to requiring a
  payment method before a trial starts.
- **Rate limiting.** Nothing throttles sign-in or the webhook. Card-testing and
  credential-stuffing are unaddressed.
- **A built container image.** The `Dockerfile` is written against a standalone
  build that was produced and served successfully, but no image has been built —
  there was no Docker daemon available. Build it once before relying on it.
- **Schema migrations.** The schema creates itself on first connection and is
  additive only. The moment a column has to change shape rather than be added,
  that stops being true and this becomes a real migration step.
- **Seats.** `seats` is in the catalogue and enforced nowhere, because there is
  no team feature to enforce it against.
- **Server-side conversions.** Meta's Conversions API and GA4 Measurement
  Protocol are not wired up. Browser-side events only, so an ad blocker means no
  event.
- **Actual AI.** The "agents" are deterministic scoring and rules. This is a
  feature, not a gap: the financial engine must be reproducible and testable.
  LLMs belong at the edges — parsing a seller's narrative into a structured
  situation, drafting the memorandum, summarising a title register — not in the
  arithmetic that decides whether someone loses their house deposit. See
  [The nine agents](#the-nine-agents) for what an agent is here instead.
- **A nine-role model and tenant isolation.** Four roles, not the
  specification's nine, and one tenant. The agent board says "Manager signs
  off" because that is the judgement being asked for; the person doing it holds
  an operator or administrator account.

---

## Where the data comes from

GoldMine was blocked on the wrong question. The obvious input — portal listings
— is the one input nobody may lawfully take: the portals prohibit scraping and
use needs a commercial agreement or a licensed reseller. The answer is not a
cleverer scraper, it is **different data**. The UK publishes, under open
licences, most of what actually predicts a motivated sale.

| Source | Licence | What it gives |
|---|---|---|
| HM Land Registry Price Paid Data | Open Government Licence, free | Every registered sale since 1995 → years since last sale, arm's-length medians |
| EPC register | Open, free with registration | **Floor area**, rating, lodgement date |
| Land Registry corporate ownership | Open, registration | Corporate and overseas landlords |
| Companies House | Open Government Licence, free | An owner in liquidation or dissolution |
| Portal listings | **None** | Refused. `assertSourceUsable()` throws. |

`src/shared/domain/sources.ts` is the gate, and it works the way `dealRevenue()` does:
a source with no recorded licence cannot be read, and a licence that permits
internal analysis does not permit redistribution. Portal listings are *in* the
registry, with no licence and a written reason, because a source that is simply
absent looks like an oversight while one that is present and refused is a
decision somebody made. A seller's own account of their situation is likewise
marked internal-analysis only: someone describing a divorce to get help selling
has not agreed to that reaching an investor pack.

`src/shared/domain/registrySignal.ts` scores owner motivation from those records
instead of from listing behaviour:

- **An EPC lodged with no sale following.** An EPC is a legal precondition of
  marketing, so one lodged eighteen months ago with nothing registered since is
  a sale that was prepared and did not complete. This replaces relist counts.
- **A rating below the letting standard.** Where the jurisdiction has one, the
  owner must spend money or stop letting — a decision with a statutory deadline.
  MEES lives on the England pack; Scotland and Northern Ireland deliberately do
  not have it, and a test asserts the signal stays silent there.
- **Years since last sale**, because accumulated equity is what makes a discount
  affordable to a seller rather than impossible.
- **Floor area**, so comparison is £/sqm rather than bedroom count. A three-bed
  terrace can be 70sqm or 110sqm and the difference is the entire margin.

Every field is optional and absent means unknown. `confidenceBps` is reported
next to the score and `missing` names what would improve it, because a high
score built on two fields is not the same as one built on six.

**Not yet verified live.** Parsing is covered by fixture tests built from the
published field definitions, but no request has been made to either endpoint
from the build environment — outbound network access is blocked there. Run
`fetchPricePaid()` and `fetchCertificates()` against the real services before
relying on them.

## The blog

`/blog` is written by an agent from deals that exist, using the figures the
engine produced. A property blog that invents "typical returns of 20%" is doing
the thing this product exists to refuse, and a post whose numbers disagree with
the Deal Room is worse than no post.

**The figures are computed; the prose has a seam.** `runDealDirector()` returns
the numbers and the agent formats them — nothing in `src/backend/blog` decides a
score, a verdict or a tax figure. `Drafter` is the edge where a language model
belongs. The default implementation composes from the briefing's own
explanations, which are already written to be read: every score component
carries a rationale, every rejected strategy carries a reason. **It needs no API
key and no network.** Wire `BLOG_MODEL_API_URL` and a model writes the sentences
instead — and the figures block is appended *after* the model returns, so it
cannot change a number.

The posts worth reading are the rejections. The blocked Handsworth deal has a
24.3% margin and £69,375 of projected profit, and it is published as a refusal
with the reasoning attached, because anybody can publish a deal that worked.

**Links are computed, not typed.** Internal linking is most of what on-page SEO
is and the part that rots fastest by hand. Every glossary term a body mentions
is linked to its definition on first use, every post links to the others sharing
its vocabulary, each definition lists the posts that use it, and each topic hub
links both. One post carries 22 internal links and not one of them is a
hardcoded href — a renamed slug cannot leave a dead link behind.

Also shipped: canonical URLs, OpenGraph, `Article`, `BreadcrumbList`, `FAQPage`
and `DefinedTerm` structured data, a generated `sitemap.xml`, and a `robots.txt`
that **disallows every operator surface** — those carry seller screening answers,
and keeping them out of the index is the third layer behind middleware and the
per-page guard, not a substitute for either.

The corpus degrades rather than failing: with the store unreachable the
evergreen posts still serve, because a public page has no business 500ing
because the deal database is down.

## Persistence

`DATABASE_URL` decides the engine, and nothing else does:

- **set** &rarr; Postgres. Records are stored whole as JSONB keyed by id rather
  than shredded into columns: the domain types are already the schema, they are
  exhaustively tested, and a parallel column layout would be a second
  definition free to drift from the first. `Money` is an integer count of pence
  and survives JSON exactly, where a numeric column invites a float. Every
  read-modify-write runs in a transaction with `FOR UPDATE`.
- **unset** &rarr; the JSON file. Zero configuration and correct for a
  single-process dev server. It is **wrong on serverless hosting**, where each
  instance has its own ephemeral filesystem and two requests can land on
  different instances that never see each other's writes.

One contract test suite runs against both engines, because the claim that
storage can be swapped without touching engine code only stays true if both
implementations are held to the same behaviours. It runs Postgres when
`TEST_DATABASE_URL` is set and reports a skip when it is not, rather than
passing quietly having tested one engine.

```bash
npm test          # 772 tests, Postgres suite skipped
npm run test:pg   # 228 tests, both engines
```

## Who can see what

The pipeline and the Deal Room carry what sellers told us in confidence:
reported financial distress, third-party pressure, age band, and health or
capacity concerns. Health and capacity data is special-category personal data
under UK GDPR Article 9. Those pages were reachable by anyone who knew a URL,
and enquiry URLs were derived from the postcode, the locality and the number of
enquiries already stored — all guessable. Both are fixed:

- `src/middleware.ts` gates `/deals`, `/invest` and `/capital` **by default**.
  A new operator route is protected by existing under those paths, not by
  someone remembering to guard it.
- **Every operator page also checks for itself.** Next.js has shipped more than
  one middleware-bypass advisory — CVE-2025-29927 let a crafted
  `x-middleware-subrequest` header skip middleware entirely — so `requireOperator()`
  is the second lock behind the gate. One `await` per page, and the data behind
  it no longer depends on a single point of failure in somebody else's
  framework.
- Without `OPERATOR_SECRET` those pages return **503 and render nothing**. The
  same fail-closed rule as the cron endpoint: an unconfigured deployment must
  not default to open.
- The session cookie is an HMAC of a fixed message under the secret, never the
  secret itself, so a stolen cookie cannot be replayed as the password and
  rotating the secret invalidates every session with no stored state to clear.
- A seller's own result page is a **capability link**: 32 bytes from a CSPRNG,
  the same standard as the newsletter confirm link. It carries only their data.

### Accounts, and the thing that actually gates deal material

The shared password is now the bootstrap rather than the whole story. It creates
the first account and covers a solo operator on day one; everything else should
be done as a named person, because a shared password has nobody for the audit
trail to name.

**Sending a deal pack to a private investor is a financial promotion** under
FSMA s.21. That does not require FCA authorisation to solve — it requires the
investor to certify which exemption they fall under, which is a form, a record
and an annual renewal:

| Category | Basis | May be sent deal material |
|---|---|---|
| Certified high net worth individual | FPO art. 48 | Yes |
| Self-certified sophisticated investor | FPO art. 50A | Yes |
| Certified sophisticated investor | FPO art. 50 | Yes — but the certificate is signed by an authorised firm, not by us |
| Investment professional | FPO art. 19 | Yes |
| Restricted investor | COBS 4.7.10R | **No** — that exemption is not written for this |
| Nothing held or lapsed | — | **No** |

`can()` in `src/shared/domain/accounts.ts` is the only place that decision is made.
Four properties are enforced by tests:

- **An expired certification is no certification.** Twelve months from
  signature, then it must be given again. A lapsed statement does not degrade
  gracefully; sending on the strength of one is as unlawful as sending to
  somebody who never certified.
- **Investors and funders never hold `view-seller-data`,** at any point, with
  any certification. A funder needs the deal, not the seller's reported health
  concerns.
- **The exact words signed are stored,** with the criteria ticked and the date.
  The question asked later is "what did they certify?", and a record holding
  only the category cannot answer it.
- **Thresholds are a dated snapshot with `requiresVerification: true`,** treated
  exactly like the SDLT bands. They were raised in 2023 and the change was then
  announced for reversal; nobody should disapply s.21 on the strength of a
  figure in a repository.

The audit trail is append-only — the store exposes `appendAudit` and no update
or delete — and records sign-ins, failures, denials, certifications, and every
view of seller data or deal material. Access taken with the shared password
appears with no name against it, which is the argument for giving people their
own accounts.

## Measurement

Meta Pixel and Google Tag are both wired in, and both are gated four ways in
`src/app/components/Analytics.tsx`. All four must hold before a single request
leaves the browser:

1. **An ID is configured.** No `NEXT_PUBLIC_META_PIXEL_ID` or
   `NEXT_PUBLIC_GA_MEASUREMENT_ID` and the script is never rendered.
2. **The visitor has agreed.** Both vendors set non-essential cookies, so PECR
   reg. 6 requires consent before they load, not after. The banner offers
   Accept and Decline with equal weight; anything other than an explicit
   `granted` is treated as a refusal, including a tampered cookie.
3. **The route is on the allowlist.** Deny by default, in
   `src/shared/domain/analytics.ts`. `/`, `/sell`, `/blog`, `/glossary`,
   `/newsletter` and `/offline` are trackable. The pipeline, the Deal Room, the
   memorandum, `/sell/[id]`, every operator surface and every API route are not,
   and a route nobody has classified is untracked until somebody decides
   otherwise.
4. **The event is known and its properties survive sanitising.**

The exclusions are the part that matters. Those pages carry what sellers told
us in confidence — reported financial distress, third-party pressure, age band,
health and capacity concerns, which are special-category data under UK GDPR
Art. 9 — and a pixel sends the page URL, title and referrer with every event. A
seller's result page is a capability URL, so the URL *is* the credential. The
check is re-run on every navigation, not only at mount: moving from the blog
into the Deal Room must stop the pixel, not merely fail to restart it.

Events carry counts and stages, never content: the step number of the intake
form but never the seller's situation, a public blog slug but never an address
or a postcode. `sanitiseProperties()` is the second gate and drops anything
resembling an email address, a UK postcode, a capability token or a record
number. Sign-in, investor certification and partner clicks are absent from the
vocabulary entirely — they happen only on excluded routes, so an event for them
could never fire; they are in the audit trail instead, which is where a
conversion involving a named person belongs.

Never load a tag from anywhere else, and never through Tag Manager. The
allowlist can only govern scripts this code loads; a container can add one
later, on any page, from a console. `npm run preflight` blocks on a `GTM-` ID
for that reason.

### Opens, counted here rather than there

A pixel reports to Meta and Google and to nobody else. Reading it back means
opening someone else's dashboard, it stops entirely for the large fraction of
readers who decline the banner or run an ad blocker, and it cannot be shown on
an operator page beside the post it describes.

So blog posts are also counted on this server. `POST /api/blog/view` increments
one number per slug — no IP address, no user agent, no identifier, no per-view
row — which is why it needs no consent under PECR reg. 6 and keeps counting when
both vendors are blocked. The slug is checked against the real corpus before
anything is written, and an unknown slug gets the same response as a malformed
body so the endpoint cannot be used to enumerate what exists.

The counter is not deduplicated per visitor, deliberately: doing that would mean
writing to the reader's device, which needs consent to answer a question a plain
count already answers. It measures page opens, and that is what the dashboard
calls it.

### The SEO score

`src/shared/domain/seo.ts` audits every post against ten checks — title and
description length against what Google actually renders, URL shape, body length,
section headings, internal links, glossary coverage, whether anything links to
the page, and rich-result eligibility. Each check returns a finding in figures
and, where it fails, what to do about it; the score is derived from the findings
rather than the other way round.

Checks with a floor and a target grade in between, so a post with four internal
links and one with none are not reported identically — the point is to know what
to fix first.

It is **not** a ranking prediction, and nothing in it can see a backlink, a
competitor or a search volume. It checks what is inside this codebase, which is
the part that can actually be changed. `/operator/blog` shows it beside the open
count, worst post first.

---

## The money side

Nothing charges anybody yet — there is no payment provider wired in, and that is
[still true](#not-built-yet). What exists is everything that sits *behind* one,
which is where a platform actually loses money. The provider is the easy part.

### Nothing takes a price from the caller

A purchase request has no amount field. Not a validated one — none:

```ts
type PurchaseRequest =
  | { kind: "plan"; planId: PlanId }
  | { kind: "topup"; packId: string }
```

The price comes from `pricing.ts` on the server. There is nothing to set to zero
and nothing for a tampered form to override, which is structural rather than
checked, and a check is only ever as good as the person who remembered to write
it.

### The webhook is the highest-value target on the platform

It is unauthenticated by necessity — the provider has no account here — and what
it says is treated as proof that money arrived. Five things stand between it and
somebody awarding themselves a subscription and unlimited balance:

1. **The signature is verified over the raw bytes**, before the body is parsed.
2. **The event id is claimed once**, atomically, in the store.
3. **The event type is on an allowlist**; anything else is recorded and ignored.
4. **The amount is recomputed from the catalogue and compared.** Underpayment
   and overpayment both fulfil nothing — an overpayment usually means the
   confirmation belongs to a different charge.
5. **Subscription changes apply only if newer** than what is recorded. A late
   `renewed` landing after a `canceled` would otherwise switch access back on.

Verified against a running server: unsigned, forged, replayed and
signed-then-altered deliveries are all refused with nothing written; a genuine
payment credits once; a redelivery of it changes nothing; and a *different event
id describing the same payment* also changes nothing, because the idempotency
key is the payment rather than the delivery.

Without `BILLING_WEBHOOK_SECRET` every confirmation is refused. Nothing can be
sold, which is the safe direction.

### Prepaid balance cannot be double-spent or cashed out

Balance is denominated in pence rather than in a unit called a credit, which
removes the buy-low-spend-high arbitrage entirely.

- **Spending is an allocation against specific lots**, all or nothing, with the
  read and the write in one atomic operation. Twenty-five simultaneous £1 spends
  against a £10 balance succeed exactly ten times — tested against both storage
  engines, and Postgres additionally refuses a negative remaining at the column.
- **A bonus is a separate lot with no cash behind it**, so it can never come back
  out as cash. Refunds are proportional to money actually received and rounded
  down.
- **Spending order is soonest-expiry first, granted before purchased.** Spending
  the paid balance first would let somebody consume the free part and withdraw
  the paid part.
- **A reversal takes back a share of the payment, not a share of each lot.** A
  dispute takes everything; a partial refund takes the same proportion of
  everything that payment granted, bonus included. Whatever it reaches beyond
  what is still unspent becomes a visible debt and spending stops, rather than
  being clamped to zero and quietly absorbed. Dispute fees are recorded
  separately — winning does not give them back, so they are our cost and not a
  debt to pursue.
- **Lots expire** — twelve months on money paid, three on balance given away —
  and expiry is written to the ledger, never silently.

The ledger is append-only, like the audit trail, and every movement carries an
idempotency key the store holds unique.

### Access stops when paying stops

Entitlement is **derived, never stored**. There is no `isPro` column for a stale
write to leave true; the plan, the status and the dates are the facts and the
answer is computed from them every time. Which closes, specifically:

| Leak | What happens instead |
|---|---|
| Cancelled, access left on | Runs to the end of the period already paid for, then stops from the date alone — nothing has to run |
| Period lapsed, no renewal event | Falls to the free plan rather than trusting a stale `active` |
| Payment failed, access continues | Seven-day grace: keeps what exists, grants nothing new — no memoranda, no credits |
| Trial takes the whole library | Trial unlocks features but caps memoranda at one and grants no balance |
| Downgrade keeps ten mandates on a three-mandate plan | `withinPlan()` covers the oldest and stops counting the rest; nothing is deleted |
| Chargeback, then carry on using it | Account suspended, and no ordinary renewal event lifts that |
| Cancel the trial, start another | One trial per account, recorded on the account so restarting does not reset it |
| Subscribe once, take every memorandum | Metered per period; overage charged to balance |
| Downgrade, keep the extra mandates | Excess stops counting and stops being shown to sellers |

Mandate limits are enforced in the server actions, which now check their own
permission and ownership. A server action is its own POST endpoint — the page's
guard does not cover it.

### The two tax rules that cost real money

VAT under-collected is paid out of margin, so both directions fail safe.
Consumer-facing prices are stated tax-**inclusive** (what a consumer sees is what
they pay); business prices exclusive. Sales to consumers outside the UK are
**refused** rather than charged a guessed rate — that needs a One Stop Shop or
local registration, and charging UK VAT to a French consumer means remitting to
the wrong state while still owing the right one.

The other is the Consumer Contracts Regulations cancellation right. Without the
customer's express agreement to immediate supply *and* their acknowledgement that
this ends the right, a consumer can use the service for thirteen days and still
be owed the whole fee back. `coolingOff()` returns `full` in that case and
`pro-rata` where the agreement was taken — it is the difference between those two
on every cancellation in the first fortnight.

### The product itself is metered

The memorandum is the artefact that leaves the building permanently, so it is
the one thing worth subscribing for a single month to take. A plan that lists
twenty and counts none of them sells the whole library for one month of the
cheapest plan that includes them — after which the customer cancels and the
value never comes back.

`meter()` runs before anything renders, in this order: already paid for this
period, then included in the plan, then chargeable to the prepaid balance, then
no. Reopening a memorandum already taken in the period is free, which is what a
customer expects and what stops a cap becoming a trap. Going past the allowance
charges the balance rather than refusing, because refusing caps revenue at the
plan price and turns the heaviest users away.

Uses are counted in the **ledger**, not from the audit trail. The audit write is
best-effort and swallows its failures by design, so counting from it would mean
a logging blip silently handing out an uncapped allowance.

Staff are never metered. Ten simultaneous requests against an allowance of three
succeed exactly three times.

### Housekeeping that has to actually run

`POST /api/cron/billing`, nightly, authenticated on `CRON_SECRET` and failing
closed without it. It expires lapsed balance and writes an entry for each lot.

Expiry existed as a date on every lot before this and nothing acted on it, which
made the disclosed twelve-month limit a comment. A liability that never lapses is
carried indefinitely and redeemed years later against costs that have since
risen.

### Moving money by hand, on the record

Without a recorded path, a goodwill credit gets made at a database prompt: no
author, no reason, no audit line, indistinguishable from somebody crediting
themselves. So `/operator/billing` has one, and it is narrow — named
administrators only (never the shared password, which has nobody behind it to be
an author), a required reason, a ceiling per adjustment so a slipped decimal is a
small mistake, and both an audit entry and a ledger entry.

Balance granted this way is a **grant, never a purchase**. It has no cash behind
it, so it can never be refunded out as cash.

Debts can be written off the same way. The original entry stays exactly where it
is — the ledger records that the debt happened and that it was forgiven, not that
it never existed.

### Charging something we are not allowed to charge

Several revenue streams need a permission this platform does not yet hold.
`authorisePurchase()` refuses them at the point of sale, not just in the model:
an unauthorised credit-broking fee is unenforceable, so it is money delivered
against, taken, and then given back with a penalty on top. Only subscriptions and
prepaid usage have no permission dependency, which is why they are the only two
things sellable today.

---

## Funding an acquisition

`docs/PAF-OS.md` maps the Priority Acquisition Funding specification against
what exists, section by section, including what does not.

### The number that fails deals

A facility is not a cash sum. Where interest is retained the lender deducts the
whole term's interest at drawdown, and fees usually go the same way. On a seeded
deal the platform reports it plainly:

> The facility is £154,400 but £13,303 is deducted at drawdown, so £141,097
> reaches the completion account.

A sponsor who planned the completion statement around £154,400 is short with the
clock running. `netAdvance()` computes it, and `cashRequired()` derives the
sponsor's cash from the net advance rather than the face value of the debt —
which is the difference between a funding plan that works and one that fails on
the day.

### Comparing lenders on the total, not the rate

The comparable figure is interest **plus** arrangement fee **plus** broker fee
**plus** valuation and legal costs **plus** exit fee, over the actual term. A
cheaper rate carrying a two per cent broker fee is dearer than a higher rate
carrying none over nine months, and `compareOffers()` says so in those terms.
The broker fee was missing from the cost stack until this was built, so every
comparison before it understated one lender against another.

### The ratios a funder decides on

LTV against the price and against the valuation are reported separately, because
the difference is exactly where a deal gets talked into looking fundable. Also
LTGDV, LTC, the funding gap against cash **committed with evidence**, exit
headroom, and refinance debt service cover — which is rendered as a multiple,
never a percentage, because a cover of 0.53× shown as "52.6%" reads as
comfortable when it means unfundable.

### Finance readiness

0–100 across eight weighted components: legal and title 15, valuation 15,
capital stack 15, exit 15, planning 10, borrower and identity 10, costs and
programme 10, evidence quality 10.

Scored against evidence **recorded**, never against the absence of a problem. A
title with nothing recorded scores zero, not full marks — the most expensive way
to discover a pack is incomplete is for a lender to discover it first, having
already charged for a valuation. It is triage, not approval, and the page says
so above the number.

### Whether an introduction may be made at all

`classifyRoute()` returns one of six routes and every uncertainty routes to
review rather than to permitted. The test that overrides everything else: a loan
secured on a dwelling the borrower or a relative occupies is a regulated
mortgage contract whatever purpose anybody has declared. An unauthorised
introduction is not merely a compliance problem — the agreement is unenforceable
and the fee unrecoverable, on top of any penalty.

### Contacting funders

The specification asks for an agent that discovers and writes to funders. The
half that governs contact is built; the half that scrapes is not, deliberately.

Sending works, through the same transport the newsletter uses. Composing,
approving and sending are three separate actions because they are three separate
decisions, and collapsing them is how a system emails somebody nobody meant to
email. `outreachEligibility()` returns one of `SEND_ALLOWED`, `DRAFT_ONLY`,
`CONSENT_REQUIRED`, `COMPLIANCE_APPROVAL_REQUIRED`,
`PROMOTION_APPROVAL_REQUIRED` or `DO_NOT_CONTACT`, and **everything is re-checked
at the moment of sending** — a recipient can opt out in the minutes between
approval and delivery, and the check that matters is the later one. Opt-outs and warning-list matches end the question before
anything else is weighed. An address a model inferred is never sent to. An
unknown recipient type is treated as an individual, not as a company — getting
that the other way round is how a lawful B2B campaign becomes an unlawful one.

A stage-one enquiry is anonymous and checked for it: no postcode, no street, no
mention of the seller's circumstances, no projected return, sender identified,
opt-out present. "Remove me" is matched by rule before any classification runs,
so no model's confidence can decide otherwise.

### The discovery connectors

Built, and gated six ways. Every outbound request passes: a recorded licence
(checked before any traffic is generated), an allowlisted host bound to the
source, HTTPS with no credentials in the URL, robots.txt fetched and obeyed,
per-host rate limiting at the publisher's crawl-delay or our two-second floor
whichever is slower, and a 401, 403 or 429 treated as an answer — no retry, no
alternative route.

Companies House and the FCA Register are read through their official APIs, not
scraped. Both need a key issued against accepted terms, and that acceptance is
the licence, so without the key nothing is read. A funder's own site is read
under its own robots.txt and bound to the verified domain, so a link or a
redirect cannot walk the fetch onto somebody else's site.

**Extraction has no inference path.** The only constructor of a discovered fact
takes the exact substring found in the document, so `firstname.lastname@domain`
cannot be produced at all. A named individual's published mailbox is found and
deliberately *not* taken — outreach goes to a business channel, not to a person
who has never been told why we have their address — and the reason is shown to
the reviewer rather than the address being silently dropped.

Every candidate is quarantined at `/operator/discovery` until a named person
approves it, and only a fully `VERIFIED` candidate can be approved. A name that
disagrees with the register becomes `CONFLICTING` rather than one value winning,
because that mismatch is the signature of a cloned firm. Suppression survives a
rerun and is not something an approval overrides.

Nothing crawls. No source is licensed for harvesting the web for firms, so a run
takes organisations an operator names and verifies each. LinkedIn scraping and
pattern-guessed addresses are refused permanently with the reason recorded.

### The three stages, and why each is separate

**Stage one** asks anonymously whether an organisation looks at this shape of
transaction: a facility band, a region, a term. No address, no price, nothing
about the seller.

**Stage two** names the property. That is a disclosure of the seller's business
to a third party, so it needs the deal owner's consent — recorded, scoped and
dated — *and* a positive reply to stage one on record. A funder is not dropped
into a named transaction because somebody is in a hurry, and stage one's
approval does not carry: the teaser needs its own.

**Stage three** opens the pack, through a capability URL that expires after
fourteen days, is revocable, counts every opening, and carries the recipient's
name and the time it was produced on the page. A copy that circulates says who
it was given to. Consenting to a named teaser is not consenting to the full
pack — that needs its own scope.

### Pacing, caps and complaints

`POST /api/cron/outreach` sends what a person approved, twice a weekday, and
only inside business hours. Asked to run at 10:00 on a Sunday it answers:

> Outside business hours — it is 10:00 on day 7. Queued rather than sent.
> nextOpenAt: 2026-08-31T09:00:00.000Z

Caps are three messages to one address ever and five to one domain a fortnight,
so an organisation is not written to department by department. Every message is
re-checked against eligibility and the suppression list at the moment it goes,
so nothing can outrun an opt-out.

`POST /api/outreach/events` takes the provider's delivery events. A **complaint**
— somebody pressing "this is spam" — suppresses immediately, with no threshold
and no review, because there is no version of that signal that means write
again. A hard bounce suppresses too: continuing to send to an address that does
not exist damages the sending domain for everything that shares it, including
the newsletter real subscribers asked for.

---

## Finding an owner, and agreeing a price

Property sourcing means three things: find the property, find who owns it, agree
a price. The first is GoldMine and the licensed data sources. These are the other
two.

### The number that says stop

The hard part of a negotiation is not the words. It is knowing, before the
conversation starts, the highest price at which the deal still works — and then
not going past it. A negotiator without that number concedes under pressure,
because every individual concession looks small.

`negotiationBand()` computes four positions from the same engine that scores the
deal:

| | |
|---|---|
| **Opening** | 22% below market, or lower if the deal needs it, always leaving room below the ceiling |
| **Target** | Where it is expected to settle |
| **Walk-away** | `maxViablePrice()` at the required margin. A ceiling, never a target |
| **Floor** | 65% of market. Below this an offer is not a position, it is looking for somebody who has not taken advice |

`respondTo()` handles a counter deterministically: it **accepts** a workable
number rather than grinding — a seller who has named a price that works is not
somebody to squeeze — moves at most halfway towards them, and never past the
ceiling however high they ask. Margin is not lost in one bad decision; it is lost
in six small ones that each looked reasonable.

Building it caught two things by running it:

- The opening offer originally landed **on** the walk-away whenever the discount
  the buyer wanted was smaller than the discount the deal needed. Opening at your
  maximum leaves nowhere to go except backwards. There is now a fixed margin of
  room, and a test that fails if it closes.
- On a real seeded deal the engine reported a ceiling of £198,839 beside a best
  alternative of £283,300 — and drew no conclusion. It now leads with *"they can
  do better elsewhere"*: offering less than somebody can plainly get is not a
  negotiation, it is hoping they do not know.

### Seller Protection runs first, and can end it

Where `protection.blocked` is true there is **no position at all** — not a
cautious one. On the seeded pipeline one deal returns exactly that:

> Seller Protection blocks this deal, so there is no price to negotiate. Clear
> the flags or walk away; do not approach the seller with an offer in the
> meantime.

### What the seller is told, with the offer

Every offer carries `contextFor()`: the discount in pounds and per cent, what
they get for it, and the sentence most of this industry leaves out —

> Selling through an agent would very likely get you more money and take longer.
> You should take independent advice before accepting.

An offer below market value is defensible only if the seller can see what they
are being paid for. One presented without that is asking somebody to accept less
without telling them they are.

### Finding the owner

`land-registry-title` is licensed for **internal analysis only** and bought one
title at a time. `lookupOwner()` refuses without a deal id and a named requester,
before reading anything — a register bought with no transaction behind it is
collection rather than conveyancing, and only the record tells them apart. There
is deliberately no function that takes a postcode and returns owners.

Nothing is guessed. A register with no address for service yields a proprietor
without one, rather than one inferred from the property address — the two are
frequently different, and writing to the wrong one tells a stranger about
somebody else's house.

### Writing to them

The letter channel runs through the same spine as everything else — draft,
eligibility gate, named approval, suppression, opt-out — with the rules that
actually differ.

The eligibility engine is now **channel-aware**, because PECR governs
*electronic* mail. Emailing a named individual without consent is unlawful;
writing to them is not. A gate that refused individuals regardless of channel
got the law wrong in the safe direction, which sounds harmless until it means
the only lawful route to a homeowner is the one the platform will not take.

A letter to an individual is allowed only once three things have **actually been
done** — MPS screening, a privacy notice, and a recorded legitimate-interests
assessment. Legitimate interests is a test to be applied, not asserted, and the
gate holds the letter until each is ticked. They are stored on the message,
because the check runs again immediately before sending and a re-check that
cannot see the screening can never pass it.

With no print provider configured a letter is rendered and **queued for post** —
not "sent". Somebody prints it, posts it, and marks it posted with their name.
A letter nobody posted stays visibly unposted.

Suppression works by postal key as well as by mailbox, against one list, so an
opt-out given by letter also stops the emails. And `classifyReply()` now knows
how somebody replying to *post* phrases it — "stop writing", "no more letters",
"take me off" — because a pattern that only knew the email wording missed the
postal opt-out entirely.

`channelFor()` decides which channel applies:

- **A company** — email, sender identified, opt-out offered.
- **A named individual** — **letter**. Unsolicited electronic marketing to an
  individual needs consent under PECR reg. 22 and there is no workaround. The
  letter needs MPS screening, a privacy notice saying where the address came
  from, and a suppression check immediately before sending.
- **No address on the register** — no approach at all.

---

## The nine agents

Specification §12 asks for nine AI agents. What is built is nine *agents* in a
narrower sense than the phrase usually carries, and the narrowing is the design
rather than a shortfall.

An agent here is three things: a **trigger** saying when it has something to
say, an **observer** that runs engines which already exist, and a **proposal**
that a named person has to decide on. There is no model in the loop, no
autonomy, and no path from a proposal to an action. They are on the board at
`/deals/[id]/agents`.

| Agent | Fires when | Says |
|---|---|---|
| Intake | A deal is created or evidence is recorded | What in the record contradicts something else in it |
| Structuring | The deal can be appraised | Where the stack does not close, and which route ranks above the one modelled |
| Risk | Any change to the deal | Which stresses wipe out the profit, and by how much |
| Matching | The route permits an introduction and protection is clear | Eligible funders, ranked, with the criteria each met |
| Memorandum | The pack scores as fundable | That it is ready to sign off, or which phrase in it is an unlawful promotion |
| Terms | An offer is recorded | Offers normalised to one basis and compared on total cost |
| Due-Diligence | A person has selected terms | The conditions plan, and a chaser for whoever is holding one up |
| Completion | Evidence is expiring or the path is blocked | The close forecast, and what stands in its way |
| Exit Watch | The deal is funded or completed | Cover below covenant, an exit that will not repay, a hold outrunning the facility |

### What no agent can do, and why that is structural

§12 ends with a list: an agent may not impersonate a professional, bind a party,
accept terms, certify investor status, waive conditions or move funds. Writing
that down is easy and worth nothing. It is enforced in three places instead.

**A closed set of effects.** Accepting a proposal can record a review, a
selection or a sign-off, or adopt the standard conditions plan. The type holds
no fourth kind of thing, so no agent can propose one that moves money, alters
terms, marks a condition satisfied or writes a certification.

**Effect ownership.** The one effect that writes anything belongs to one agent,
checked when the proposal is constructed. Any other agent reaching for it throws
— there is a test that walks all nine and asserts exactly that.

**A named decider.** The shared operator password is refused. Every one of these
controls is somebody stating a judgement, and a shared credential has nobody
behind it to have stated it. Sign in as yourself, and say why: the reason is
required, because everything here is read later by somebody who was not in the
room.

The one writing effect adopts the standard plan with every condition at *not
started*. It cannot set a status, which is what stops it becoming the first way
round the four-eyes control on clearing a condition.

### The chain is real

The agents are wired to each other through decisions, not through a scheduler.
The Due-Diligence Agent is dormant — visibly, with the reason on the board —
until a person accepts a Terms Agent proposal, because conditions are the
conditions of a particular offer. The Completion Agent has nothing to forecast
against until a conditions plan exists. The Matching Agent goes silent the
moment Seller Protection blocks the deal or the regulatory route is
unclassified, and says which.

Dormancy is shown as prominently as a finding. An agent that is quiet because
the deal is clean and an agent that is quiet because it has never been reached
look identical from the outside, and only the second one is a problem.

Every proposal carries where it came from, what it assumed, how confident it is
in the sense of *how much of this is recorded rather than modelled*, and the
version of the logic that produced it. No proposal states a number it computed
itself; each one read it from the appraisal, the readiness report, the close
report or the offer comparison.

---

## Regulatory position

Read `docs/REGULATORY.md` before charging anyone anything.

Summary: introducing sellers to buyers is estate agency work in the UK and
requires HMRC AML supervision and redress scheme membership. Introducing
borrowers to lenders for a fee can be regulated credit broking. Raising money
from private individuals engages the financial promotion restriction. The
revenue engine encodes this — `dealRevenue()` excludes any stream whose
required permission is not recorded as held, and reports the excluded amount
separately, so the gap between "what this deal could earn" and "what we may
lawfully charge today" stays visible instead of being assumed away.

Figures produced anywhere in this system are screening estimates, not advice.
Tax estimates always carry `requiresProfessionalReview: true`.
