# Day-one charging — what we take now, what waits for a permission

> **Purpose.** A one-page map of what Lode intends to charge from launch versus
> what is deliberately switched off until the matching authorisation is held.
> Prepared for review by a regulatory solicitor — **this is not legal advice**,
> it is our reading of the perimeter, and the asks for confirmation are at the
> end. `docs/REGULATORY.md` has the longer detail.
>
> The split below is not aspirational: the revenue engine (`revenue.ts`
> `dealRevenue()`) **excludes any stream whose permission is not recorded as
> held**, so the "waits" column cannot be charged by mistake.

Prepared 2026-10-24, for a go-live of 2026-10-25.

---

## A. Charge from day one — no authorisation required

These are software subscriptions, usage credits, and own-account activity. None
is a regulated activity on our reading.

| Stream | Payer | Price | Why no permission |
|---|---|---|---|
| **Buyer membership** (recurring) | Investors / dealmakers | Explorer £0 · Investor £39 · Acquisition £129 · Professional £399 · Business £1,500 / mo | Sale of software access. No transaction linkage, no advice on a controlled investment. |
| **Capital-provider membership** (recurring) | Lenders / funds | Private lender £299 · Professional £999 · Institutional £2,500 / mo | As above — access to matched deal flow, not an introduction for a fee. |
| **Analysis credits** (usage) | Buyers / professionals | Packs £10 / £45 / £160 / £650; prepaid top-ups from £25 | Metered use of our own computation. Not advice; figures are tools, not personal recommendations. |
| **Enterprise / API licensing** (recurring) | Firms / funds / lenders | Negotiated | White-labelled software. |

**Baseline registrations that are NOT optional** (not "regulators to avoid" —
mandatory before we trade at all):

- **Registered company** — Companies Act 2006 s.82 trading disclosures.
- **ICO registration** — we process personal and special-category data
  (sellers' reported health/capacity). Processing it unregistered is an offence.

---

## B. Built, but switched off until the permission is held

The engine refuses each of these until the named permission is recorded in
`HELD_PERMISSIONS`. There is **no lawful workaround** — the only alternatives
are to not charge it yet, or to operate under an authorised principal (see C).

| Stream | Payer | Price | Permission required | Basis |
|---|---|---|---|---|
| **Opportunity reveal** | Buyer | £39–£1,250 by type | `estate-agency-aml` + `redress-scheme` | Charging to be introduced to a seller is estate agency work whichever way money flows. |
| **Seller success fee** | Seller | 0.6% of price achieved, floor £1,250, cap £7,500 (managed: 1%, floor £2,500), on completion only | `estate-agency-aml` + `redress-scheme` | Selling a property for a fee is estate agency work. Fee must be disclosed before the seller is bound. |
| **Deal / buyer success fee** | Buyer | On completion | `estate-agency-aml` + `redress-scheme` | Introducing a seller to a buyer for a fee. |
| **Sourcing fee** | Investor | ~1–2% of purchase price, floored and capped, on completion | `estate-agency-aml` + `redress-scheme` | Estate agency work covers acting for a client who wishes to acquire, not only to dispose. |
| **Deal packaging** | Buyer | Per pack | `estate-agency-aml` | Preparing the pack; charged whether or not it completes, so described accurately at point of sale. |
| **Funding introduction** | Lender / broker | Per introduction | `credit-broking` (FCA) | Introducing borrowers to lenders for a fee is a regulated activity. |
| **Professional marketplace referral fees** | Solicitors / surveyors / etc. | Recurring + referral | `professional-referrals` | Referral fees to/from regulated professionals carry disclosure obligations. |

**Lead times** (why to start now): HMRC AML supervision ~4–6 weeks; redress
scheme days; FCA authorisation / AR appointment weeks. Until AML + redress are
granted, **charge section A only** — the engine enforces this.

---

## C. The legitimate accelerators (lawful, faster than full authorisation)

- **Appointed Representative (AR):** carry on credit broking and/or financial
  promotions under an **authorised principal firm's** permissions, instead of
  obtaining our own FCA authorisation.
- **s.21 approver:** have an FCA-authorised firm **approve** each financial
  promotion we publish.
- **Investor-facing exemptions:** certified **high-net-worth** and
  **sophisticated investor** routes — prescribed statements, signed **before**
  the promotion is made, never after.

---

## D. The lines we are relying on (please confirm)

1. **Subscriptions, credits and own-account purchase sit outside the regulated
   perimeter** — correct?
2. **Our analysis tools are not "advice"** on a controlled investment, because
   they output computed figures, not personal recommendations — correct?
3. **No figure that describes an investor's return** (yield, margin, return on
   cash) appears on any public or investor-facing page unless approved as a
   financial promotion by an authorised person. A minimum/guaranteed return
   (e.g. "8%") would be a promotion and a performance statement — we treat it as
   off-limits until approved. **Confirm our handling.**
4. **Every transaction fee in section B is withheld** until the matching
   permission is recorded — confirm the mapping (estate-agency-aml + redress for
   introductions and seller/sourcing fees; FCA/AR for funding introductions).
5. **AR vs direct authorisation** — which do you recommend for the credit-broking
   and financial-promotion elements, and can you act as, or introduce, a
   principal / s.21 approver?
6. **Seller fee mechanics** — 0.6% on completion, disclosed before the seller is
   bound (Estate Agents Act 1979 s.18), not chargeable where the seller is still
   under sole agency / sole selling rights elsewhere — confirm sufficient.

---

## E. Primary sources this rests on

- Estate Agents Act 1979 — **s.1** (what estate agency work is; covers acquiring
  as well as disposing), **s.18** (fee disclosure before the client is bound).
- Money Laundering Regulations 2017 — AML supervision for estate agency
  business.
- FSMA 2000 — **s.21** (financial promotion restriction); Financial Promotion
  Order 2005 (controlled investments; HNW / sophisticated exemptions); Regulated
  Activities Order 2001 (credit broking).
- DMCC Act 2024, Part 4 — misleading actions and omissions in consumer-facing
  material.
- Companies Act 2006 s.82; Data Protection Act 2018 / UK GDPR (ICO).

*Not legal advice. Figures are our catalogue (`pricing.ts`); the regulatory
reading is ours and needs your confirmation before we rely on it.*
