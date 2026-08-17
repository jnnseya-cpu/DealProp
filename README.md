# Lode — Property Deal OS

**Problems become deals. Deals find capital. Capital closes property.**

Lode is not a property portal. A portal optimises discovery: here is a house,
here is its price. Lode optimises *structuring*: here is a seller's situation —
can it become a transaction that survives tax, stress testing and completion?

It is built for the seller who says "I need a solution", not the one who wants
the highest possible price and can wait six months. That seller is not the
customer, and the product says so.

---

## Quick start

```bash
npm install
npm run seed      # writes the file-backed store to .data/
npm run dev       # http://localhost:3000
npm test          # 154 tests
npm run typecheck
```

---

## What is actually built

Four pages are live and driven entirely by the engine. What is missing is
listed honestly in [Not built yet](#not-built-yet).

| Page | Route | What it does |
|---|---|---|
| Landing | `/` | Every figure computed at render time from the seeded deal |
| Seller intake | `/sell` | Situation first, price fourth; screening feeds Seller Protection |
| Seller options | `/sell/[id]` | Routes with what the seller receives, when, and what they give up |
| Pipeline | `/deals` | Every opportunity scored after tax, blocked deals included |
| Deal Room | `/deals/[id]` | Verdict, full model, Red Team, capital stack, matched mandates |
| Newsletter | `/newsletter` | Double opt-in signup, confirm and one-click unsubscribe |

| Engine | File | What it does |
|---|---|---|
| Money primitives | `src/lib/money.ts` | Integer pence behind a branded type |
| Jurisdiction packs | `src/domain/jurisdictions/` | All country-specific law, isolated |
| Appraisal | `src/domain/economics.ts` | Full cost stack, after-tax profit, true discount |
| Seller diagnostics | `src/domain/motivation.ts` | Motivation, urgency, complexity, flexibility |
| Seller Protection | `src/domain/protection.ts` | Can **block** a deal outright |
| Red Team | `src/domain/redteam.ts` | Nine stress scenarios, tiered |
| Deal Score | `src/domain/dealScore.ts` | Nine components + verdict |
| Capital Stack | `src/domain/capitalStack.ts` | The £0-own-capital solver |
| Strategy Router | `src/domain/strategies.ts` | 14 strategies tested, most rejected |
| GoldMine | `src/domain/goldmine.ts` | Stale-listing mining, why-unsold diagnosis |
| Matching | `src/domain/matching.ts` | Buy Box / Funding Box, explainable |
| Close | `src/domain/completion.ts` | Close Score, blockers, critical path |
| Revenue | `src/domain/revenue.ts` | Monetisation, permission-gated |
| Deal Director | `src/domain/director.ts` | Runs everything, returns one position |
| Seller intake | `src/domain/intake.ts` | Seller answers → engine inputs, with Truth Engine checks |
| Seller routes | `src/domain/sellerRoutes.ts` | Inverts the engine: what the *seller* receives |
| Working deal | `src/domain/workingDeal.ts` | Prices an enquiry that has no agreed price yet |
| Newsletter | `src/domain/newsletter.ts` | Consent gating, weekly idempotency, issue composition |
| Email transport | `src/lib/email.ts` | Provider-agnostic, fails closed when unconfigured |

---

## The five decisions that matter

### 1. Money is integer pence, never floats

`src/lib/money.ts` exposes a branded `Money` type. At transaction scale a
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

Nothing outside `src/domain/jurisdictions/` may hardcode SDLT, "solicitor", or
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

## Not built yet

Deliberately out of scope for this slice, in rough priority order:

- **Buy Box and Funding Box UIs** (`/invest`, `/capital`). Matching works and
  is shown from the deal side, but a funder cannot yet create their own
  mandate. This is the last of the three marketplaces.
- **Investment Memorandum.** A print-ready pack from the same briefing.
- **GoldMine data sourcing.** The scoring engine is complete and consumes a
  `ListingSignal` interface. No adapter is written, because the major portals
  prohibit scraping in their terms and property data carries licensing and
  data-protection obligations. Connecting a source is a legal decision that
  must precede the code. See `docs/REGULATORY.md`.
- **Persistence beyond JSON.** `src/store/repository.ts` is a narrow interface
  over a file. It serialises writes and writes atomically via rename, which is
  adequate for a single-process dev server and is not a database.
- **Authentication, accounts, payments.** None exist.
- **Actual AI.** The "agents" are deterministic scoring and rules. This is a
  feature, not a gap: the financial engine must be reproducible and testable.
  LLMs belong at the edges — parsing a seller's narrative into a structured
  situation, drafting the memorandum, summarising a title register — not in the
  arithmetic that decides whether someone loses their house deposit.

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
