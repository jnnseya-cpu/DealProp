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
npm test          # 458 tests
npm run typecheck
npm run preflight # is this safe to put in front of the public?
```

---

## What is actually built

Every page is live and driven entirely by the engine. What is missing is
listed honestly in [Not built yet](#not-built-yet).

| Page | Route | What it does |
|---|---|---|
| Landing | `/` | Every figure computed at render time from the seeded deal |
| Seller intake | `/sell` | Situation first, price fourth; screening feeds Seller Protection |
| Seller options | `/sell/[id]` | Routes with what the seller receives, when, and what they give up |
| Pipeline | `/deals` | Every opportunity scored after tax, blocked deals included |
| Deal Room | `/deals/[id]` | Verdict, full model, Red Team, capital stack, matched mandates |
| Memorandum | `/deals/[id]/memorandum` | Print-ready pack from the same briefing, with the promotion notice |
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
| Billing | `/operator/billing` | Every account's plan, balance and ledger position |
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
| Catalogue | `src/shared/domain/pricing.ts` | Every price, plan limit and tax decision, in one place |
| Entitlements | `src/shared/domain/entitlements.ts` | What a plan grants, and exactly when it stops |
| Ledger | `src/shared/domain/ledger.ts` | Prepaid balance: lots, spend, refund, chargeback, expiry |
| Charge gate | `src/shared/domain/charging.ts` | Whether a charge may happen, and for how much |
| Email transport | `src/backend/email.ts` | Provider-agnostic, fails closed when unconfigured |
| Store | `src/backend/store/` | One interface, two engines: Postgres or a JSON file |

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

The two platforms do this completely differently, and both are covered:

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
- **Server-side conversions.** Meta's Conversions API and GA4 Measurement
  Protocol are not wired up. Browser-side events only, so an ad blocker means no
  event.
- **Actual AI.** The "agents" are deterministic scoring and rules. This is a
  feature, not a gap: the financial engine must be reproducible and testable.
  LLMs belong at the edges — parsing a seller's narrative into a structured
  situation, drafting the memorandum, summarising a title register — not in the
  arithmetic that decides whether someone loses their house deposit.

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
npm test          # 458 tests, Postgres suite skipped
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
- **A chargeback voids the whole lot, spent or not.** What was already consumed
  becomes a visible debt and spending stops, rather than being clamped to zero
  and quietly absorbed.
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

### Charging something we are not allowed to charge

Several revenue streams need a permission this platform does not yet hold.
`authorisePurchase()` refuses them at the point of sale, not just in the model:
an unauthorised credit-broking fee is unenforceable, so it is money delivered
against, taken, and then given back with a penalty on top. Only subscriptions and
prepaid usage have no permission dependency, which is why they are the only two
things sellable today.

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
