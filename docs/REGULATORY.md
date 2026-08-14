# Regulatory architecture

This document exists because the business model determines the regulatory
perimeter, not the other way round. Several revenue streams in this product are
only lawful with permissions that take months to obtain, and one of them —
charging a fee to introduce a seller to a buyer — is the single most obvious
way to monetise the platform.

**This is not legal advice.** It is an engineering note recording which rules
the code assumes, so that a qualified adviser can check the assumptions rather
than reverse-engineer them from the source.

---

## 1. Why this is encoded, not documented

Compliance written only in a document drifts from the code within weeks. So the
constraints live in the type system and the tests:

| Constraint | Where it is enforced |
|---|---|
| Structures unlawful in a jurisdiction cannot be recommended | `JurisdictionPack.structureStatus` → `not-supported` zeroes the Strategy Router fit and caps the Deal Score at 20 |
| Revenue requiring a permission cannot be modelled without it | `dealRevenue()` excludes the stream and reports it as forgone |
| Tax figures cannot be presented as authoritative | `ProfitTaxAssessment.requiresProfessionalReview` is typed as the literal `true` — it cannot be set to `false` |
| Exploitative deals cannot reach capital | `assessSellerProtection()` → `blocked` fails a hard criterion in all matching |
| Unverified jurisdictions cannot be used for live deals | `isDealReady()` excludes them; the Director surfaces a gating action |

---

## 2. UK activities the platform touches

### Estate agency work — HMRC supervision

Introducing a person who wants to sell an interest in land to a person who
wants to acquire one is estate agency work. It brings:

- registration for anti-money-laundering supervision with HMRC
- risk-based customer due diligence on **both** parties
- membership of an approved redress scheme
- obligations under consumer protection rules, including disclosure of material
  information

The consumer protection point is the one most often missed and most damaging.
A consumer seller must be told material information — including the platform's
remuneration and the buyer's intended profit. Omitting it can be an unfair
commercial practice. `assessSellerProtection()` therefore emits these as
mandatory `requiredDisclosures` on **every** deal, not only flagged ones.

### Credit broking and mortgage arranging — FCA

Introducing borrowers to lenders for a fee can be a regulated activity.
Lending to a company for a business purpose against investment property is
usually outside the consumer regime, but:

- security over a property the borrower occupies pushes it toward regulation
- the *introduction* can be regulated even where the *loan* is not
- unauthorised regulated activity makes agreements unenforceable and is a
  criminal offence

The `funding-introduction` revenue stream is gated on this permission.

### Financial promotions — FCA

An invitation or inducement to engage in investment activity must be made or
approved by an authorised person, or fall in an exemption. **A deal pack sent
to a private investor is a financial promotion.** This is the constraint most
likely to be breached accidentally by a platform that automates deal
distribution, because the automation is the point.

Practical consequences the design must respect:

- investors must be categorised (high net worth, sophisticated, professional)
  before receiving deal material
- the Deal Room cannot be openly accessible
- "17 verified capital mandates match this deal" shown to an *originator* is
  fine; blasting the deal to those 17 without categorisation is not

### Collective investment schemes

Pooling money from several passive investors into property can create a
collective investment scheme, which cannot be operated without authorisation.
The distinguishing factor is day-to-day control: genuine joint control by all
participants points away from a scheme; passive investors handing money to an
operator point toward one. This is fact-specific and the `jv-equity` and
`private-money-purchase` rulings mark it `regulated` in every UK pack.

---

## 3. Seller protection: the commercial argument

The ethical case is obvious. The commercial case is stronger and less often
made:

1. **Contracts survive.** A transaction agreed by a seller who lacked capacity,
   was pressured, or was denied material information is vulnerable to being set
   aside. The platform's revenue depends on completion, not exchange.
2. **Funders diligence the origination.** Institutional capital will ask how
   sellers were sourced. "We block deals that look exploitative and evidence
   independent advice" is a fundable answer.
3. **The failure mode is existential.** One well-documented case of an elderly
   seller losing significant equity through the platform ends it.

So the engine blocks on:

- reported capacity or health concerns
- reported third-party pressure (a coercion indicator)
- a seller aged 80+ combined with a substantial discount
- discounts beyond the review threshold
- absent independent legal advice where a substantial discount is involved

Blocks require human review to clear. They are not dismissible by the buyer.

**Deliberate design choice:** absent screening answers are treated as unknown
and push toward caution. A form left blank must never be safer than a form
answered honestly.

---

## 4. GoldMine data sourcing

The GoldMine engine consumes a `ListingSignal` interface and takes no position
on where the data came from. This is deliberate, because the sourcing question
is legal before it is technical:

- the major UK portals prohibit scraping in their terms of use
- property data carries licensing terms; some public registers restrict bulk
  reuse
- identifying "owners who may have a problem" from personal data engages data
  protection law, including lawful basis and transparency obligations

The distinction the engine holds, and which any adapter must preserve: it scores
**market friction** — time on market, reductions, relistings, multiple agents,
vacancy — not **personal distress**. Signals of a person's financial or medical
circumstances are excluded from the Seller Pressure Score. Using them for
targeting is the line between deal sourcing and predation, and it is also the
line where data protection enforcement begins.

**Before writing an adapter:** obtain a licensed data source or explicit
permission. Do not scrape.

---

## 5. Tax

The engine estimates transfer tax and profit tax so that deals are never
appraised pre-tax. It is not a tax adviser and does not pretend to be:

- SDLT company flat rate is applied as a worst case; the reliefs commonly
  available to property rental businesses and developers are *not* assumed
- corporation tax marginal relief is interpolated, not computed exactly;
  associated companies are not modelled
- an individual's buy-refurbish-sell is treated as trading (income tax), not as
  a capital gain — a distinction worth roughly 16 percentage points, which the
  caveats state explicitly
- finance cost restriction for individual landlords is not modelled
- VAT, ATED, inheritance tax and profit extraction are not modelled at all

Every assessment returns `requiresProfessionalReview: true` and a list of
caveats, and the Deal Director surfaces a gating action requiring adviser
confirmation before exchange.

---

## 6. Sequencing

The order below is the one the business model implies. Doing it in a different
order means either delaying revenue or earning it unlawfully.

**Before any deal completes**
- HMRC AML registration and a working CDD process
- redress scheme membership
- seller disclosure pack wired into the intake flow
- professional indemnity insurance

**Before charging a success or packaging fee**
- the above, plus written terms that describe the service accurately
- confirmation of how the fee is characterised in each jurisdiction

**Before distributing deals to private investors**
- investor categorisation
- financial promotion approval route (authorised person or appointed
  representative arrangement)
- scheme perimeter advice on the JV structures offered

**Before charging funding introduction fees**
- FCA authorisation or appointed representative status for credit broking

**Before a second jurisdiction goes live**
- a verified pack with dated rate tables and local counsel sign-off
- `isDealReady()` updated only once that is genuinely true

---

## 7. Maintenance

Rate tables go stale every Budget. `tests/tax.test.ts` pins them so the change
is loud rather than silent. When rates change:

1. update the band tables in the pack
2. update `asOf`
3. update the failing tests with the new expected figures
4. confirm no deal in the store was appraised on the old basis and presented as
   current

A silent rate change is the most dangerous failure mode in this system, because
every downstream number remains plausible.
