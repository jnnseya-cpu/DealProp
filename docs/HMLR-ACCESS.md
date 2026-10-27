# HM Land Registry access — what to request, and why

This is the one credential that turns a prepared-but-unsold lead into a
contactable owner. The code is already built and tested against a fixture
(`src/backend/discovery/owners.ts`, `lookupOwner`); what is missing is a live
reader for the title register. This document says exactly what to ask HM Land
Registry (HMLR) for, the lawful basis to state, what it costs, and how it wires
in.

> Fees, product names and endpoints at HMLR change. Treat every figure and
> product name here as "confirm on GOV.UK / with HMLR before you rely on it".

---

## 1. What we actually need

For one property we have decided to pursue, we need its **title register**, which
states:

- the **registered proprietor(s)** — the owner's name; and
- the **address for service** — where the owner has told HMLR to send things,
  which is frequently *not* the property itself.

That is all. We do **not** need, and must never ask for, a bulk dataset of
who-owns-what by postcode. Harvesting the register to build a marketing list is a
different activity in law from looking up a property you are buying — it
processes personal data about thousands of people who have not been told, for a
purpose they would not expect, and it fails the legitimate-interests balance that
a single purposeful lookup passes. The code enforces this: there is no function
that takes a postcode and returns owners, every lookup carries a deal id, a
purpose and a named requester, and one with no deal behind it is refused.

So we are asking HMLR for **per-title official copies, on demand** — exactly what
a conveyancer orders on every purchase.

---

## 2. Two routes — start manual, automate later

### Route A — Manual, works today, zero integration
GOV.UK **"Search for land and property information"** (the Find Property
Information service, `search-property-information.service.gov.uk`).

- Search by address → title number → order the **title register** (and title
  plan). Roughly **£3 per title** online, pay as you go.
- Returns the registered proprietor and the address for service.
- Use this now, by hand, for the handful of leads the engine scores well. It
  needs no agreement and no code. It is the right first step: it proves the
  economics (you only buy a title once you have decided to pursue it) before any
  integration spend.

### Route B — Automated (feeds `lookupOwner` and the sweep)
HM Land Registry **Business Gateway** — the business-to-business channel HMLR
provides for ordering official copies and running searches programmatically
(the same rails conveyancers' case-management systems use). This is the route
that lets the platform fetch a register from inside a deal.

- Needs a **Business Gateway account**, which means a **Variable Direct Debit
  (VDD) account** with HMLR to settle the per-transaction fees, and acceptance of
  the Business Gateway / portal-access terms.
- Provides the two operations we need: **Search by Property Description** (address
  → title number) and **Official Copy of the Register** (title number → the
  proprietorship register).
- HMLR has also been publishing newer REST APIs; when you apply, ask which
  current product gives programmatic official copies, because the exact
  endpoint/credential is simply what we configure once granted (see §5).

---

## 3. What to request from HMLR (the application)

Ask for:

1. **A Business Gateway account** (or HMLR's current equivalent for programmatic
   official copies), billed via a **Variable Direct Debit account**.
2. Access to these services:
   - **Search by Property Description** — resolve a property address to its
     title number.
   - **Official Copy of Register (OC1)** — return the register for a title
     number, including the **proprietorship register** (proprietor name +
     address for service).
3. Separately, the **free bulk datasets for corporate ownership** under the Open
   Government Licence (see §4): **CCOD** (UK companies) and **OCOD** (overseas
   companies). These are not personal data, so they come in bulk, and a company
   can lawfully be emailed as a business — handled already by `channelFor()`.

State the use case plainly, because HMLR will assess it:

> We are a property acquisition business. We look up a title **only** for a
> specific property we are actively pursuing or whose seller has approached us —
> one title at a time, each attributed to a live deal and a named member of
> staff. We are not building, and our software cannot build, a bulk register of
> owners by area. Contact with an individual proprietor is by **letter only**,
> under a recorded legitimate-interests assessment, screened against the Mailing
> Preference Service, with a privacy notice stating where the address came from
> and how to object.

Include a **volume estimate** (titles per month — keep it honest and modest; it
tracks scored leads, not the raw list) and a short **data-handling note** (who
can trigger a lookup, that each is logged with its reason, how long register
data is retained).

---

## 4. The lawful basis, in one paragraph you can quote

The register is a **public register**: under the Land Registration Act 2002 s.66
anyone may inspect and take copies of a registered title, which is why a
per-title official copy is lawful and ordinary. The registered proprietor of an
individually-owned home is still **personal data**, so HMLR provides it
**per title, for a reason** — not in bulk for individuals. Bulk ownership data
exists only for **companies and overseas entities** (CCOD/OCOD, free under the
Open Government Licence) precisely because those are not individuals. Our
legitimate-interests basis is a **single, purposeful lookup tied to a
transaction**, and the balancing test turns on exactly that — which is why the
deal id and the named requester are mandatory in the code, not decoration.

---

## 5. How it wires in once granted (for whoever holds the keys)

`lookupOwner(request, reader)` already does everything except the network call:
it checks the licence, the title-number shape, the deal id and the requester,
then hands the title number to a `reader` and parses the result. Going live is
one small adapter plus credentials — the same shape as the EPC and Price Paid
adapters:

1. **New adapter** `src/backend/sources/landRegistryTitle.ts`, modelled on
   `epc.ts`: read credentials from the environment at call time, pin the HMLR
   host, refuse to follow a redirect (the request carries a credential), bound
   the timeout, and return the register in the shape `parseProprietors()` expects:
   ```json
   { "proprietors": [
       { "name": "…", "addressForService": "…", "companyNumber": "…?" }
   ] }
   ```
   (map whatever HMLR returns onto those three fields; omit an address rather
   than guessing one — `channelFor()` returns `none` for an individual with no
   address, by design).
2. **Record the licence** for source key `land-registry-title` so
   `assertSourceUsable()` stops refusing.
3. **Environment** (names illustrative; set to match HMLR's scheme): endpoint URL
   plus the Business Gateway key/certificate. Nothing is hard-coded; the adapter
   reads them like `EPC_API_TOKEN`.
4. **Address → title number**: wire the Search-by-Property-Description call so a
   lead's address can be resolved to a title before the official copy is ordered.

No change is needed to `lookupOwner`, `parseProprietors` or `channelFor` — they
are written and tested. The adapter is the only new code.

---

## 6. Economics and cadence

- A per-title official copy is a **small per-transaction fee** (~£3 order of
  magnitude; confirm). So the rule is: **look up a title only after the engine
  has scored the lead worth pursuing.** The 465 leads a sweep saves are not 465
  lookups — you buy a register when you decide to act, not before. The
  appraise-first flow already built (Start a deal → score → seller-checks) is
  what keeps this cheap.
- CCOD/OCOD (company/overseas owners) are **free** under the OGL and can be
  refreshed in bulk, so corporate-owned titles cost nothing to resolve and can be
  approached as businesses.

---

## 7. Where to apply

- **Manual route:** GOV.UK → "Search for land and property information".
- **Business Gateway:** GOV.UK → search "HM Land Registry Business Gateway";
  it links the portal-access agreement and the Variable Direct Debit account
  setup. HMLR's business support can confirm the current programmatic-official-
  copy product and its onboarding.
- Ask specifically: *which current HMLR product gives a programmatic Official
  Copy of the Register and a Search by Property Description, and what are the
  onboarding steps and per-transaction fees?*

---

## 8. What not to do

- **Do not** buy "resident"/owner lists by postcode from third-party data
  brokers. That is the bulk-harvesting the code and the law both refuse, whatever
  a vendor calls it.
- **Do not** guess an owner's address from the property address. The address for
  service is recorded separately *because* it is often different; guessing tells
  a stranger about someone else's property.
- **Do not** email an individual proprietor. PECR reg. 22 has no workaround; the
  lawful channel to a homeowner is a letter. (`channelFor()` enforces this.)
