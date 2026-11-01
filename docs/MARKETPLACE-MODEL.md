# The marketplace model — Lode as a third party

> "We will be like Uber Eats or Booking.com — a third party, getting our cut."

This maps that model onto what the platform actually is today, names every
role, every transaction, every cut and every gate, says what already exists and
what does not, and proposes a build order. It is a plan to agree on, not a
description of finished work: the "status" column is honest about which is which.

The one rule that makes Lode different from Uber Eats, and that every section
below obeys: **a food order carries no regulatory duty; a property introduction
does.** Booking.com's cut is just a cut. Lode's cut is only *lawful* and only
*collectable* when the per-deal gates are met. Those gates are not friction we
can trim to grow — they are the cost of being the middleman in property. The
engine already enforces this (`fees.ts`), and nothing here relaxes it.

---

## 1. The shape in one line

A property enters the **public marketplace** (once it is lawful to list), any
platform participant acts on it **in their role**, the two sides transact
**directly**, and Lode takes a **cut** on the facilitated deal — never owning,
never holding the property.

```
          PUBLIC MARKETPLACE  (/opportunities — closed-shape cards)
                 ▲                                   │
      lists once │ lawful                            │ acts on it
                 │                                    ▼
   ┌─────────────┴───────────┐        ┌──────────────────────────────┐
   │ SUPPLY                  │        │ DEMAND / INTERMEDIARIES        │
   │  • Seller (own home)    │        │  • Buyer (to keep or let)      │
   │  • Agent/auctioneer      │        │  • Flipper (assign, or buy &  │
   │    (own stock)          │        │    resell)                     │
   │  • Flipper (resells     │        │  • Reseller/sub-agent  [NEW]  │
   │    what they bought)    │        │  • Lender (funds the buyer)    │
   └─────────────────────────┘        └──────────────────────────────┘
                 │                                    │
                 └───────────────┬────────────────────┘
                                 ▼
                      LODE takes a CUT per deal
                   (only when the gates below are met)
```

---

## 2. Roles — who the participants are

Source of truth: `src/shared/domain/accounts.ts` (`Role`, `ROLE_LABELS`,
`SELF_SERVICE_ROLES`). All five already exist and are self-service.

| Role | Code key | What they do | Status |
|---|---|---|---|
| Seller | `seller` | Lists their own property; sells to a buyer we introduce | **Built** |
| Buyer | `investor` | Browses, buys to keep/let/refurbish | **Built** |
| Lender | `funder` | Funds a buyer's purchase | **Built** |
| Agent / auctioneer | `partner` | Lists their own stock (expired listings, unsold lots) | **Built** |
| Flipper | `investor`+`seller` | Sources & assigns, **or** buys & resells | **Built** |
| Reseller / sub-agent | — | Takes a *listed* property and markets it onward for a cut | **Gap — new** |
| House / Lode-acting | admin-allocated, `connectedParty` | Sells, buys and flips like anyone — **but free of every fee** | **Partly built** (see §5c) |

A person is not limited to one role (`accountRoles()` unions them, capped at
`MAX_ACCOUNT_ROLES`). A flipper is literally buyer + seller on one account. An
**admin** can allocate roles to an account (`adminAllocatableRoles()`), and mark
it as Lode or a connected party (`connectedParty`) — that is how the house
account is made.

---

## 3. Transactions — every way a deal happens, and Lode's cut

Cuts are defined once in `src/shared/domain/pricing.ts` and charged once in
`src/shared/domain/fees.ts`. Nothing else may state an amount.

| # | Transaction | Who pays Lode | The cut | Status |
|---|---|---|---|---|
| T1 | Buyer buys a listed property | Buyer | Sourcing fee + deal success fee | **Built** |
| T2 | Buyer's purchase is funded | Lender | Funding introduction | **Built** |
| T3 | Flipper sources & **assigns** a deal on | Flipper | 15% of the assignment margin | **Built** |
| T4 | Flipper **buys & resells** (becomes owner, re-lists) | — / Buyer of the resale | Treated as a new T1 on the resale | **Built** (as two deals) |
| T5 | Seller instructs Lode to **sell for them** (agency) | Seller | Seller success fee (0.60%, £1,250–£7,500) | **Built** |
| T6 | Agent/auctioneer lists & the platform wins them work | Partner | Provider commission (auctioneer 10%) | **Built** |
| T7 | **Reseller** takes a listed property and sells onward | Reseller + buyer | Reseller commission | **Gap — undefined** |
| T0 | Any of the above where a side is a **fee-exempt account** (house, or admin-comped) | — | **£0** | **Gap — see §5c** |

**The default route is free to the seller** (T1/T2/T3): the seller sells to a
cash buyer we introduce and pays nothing — the buyer, lender or flipper is our
payer. The seller only pays on T5, where they chose to have us sell *for* them.

**A fee-exempt account pays nothing on any of them** (T0): a house account (the
payer and payee are the same party) or an account an admin has comped. No cut,
and no paid membership — its plan entitlement is granted, not bought. The grant
and its controls are §5c.

---

## 4. The gates — the cost of the cut

Every facilitated deal must pass these before Lode's cut is lawful or
collectable. This is the Uber-Eats-vs-property difference, made concrete.

| Gate | What it requires | Enforced by | Status |
|---|---|---|---|
| Seller consent + ownership | The lister owns it (or is authorised) and consents to market | `sellerDueDiligence.ts` (§67), intake consent | **Built** |
| Material information | Part A answered, or the property cannot be marketed at all | `materialInformation.ts` (§66) | **Built** |
| Seller Protection | A vulnerable/distressed seller pauses the deal; it is never listed | `protection.ts` (§3, §59) | **Built** |
| Buyer is real | Identity **and** funds checked; only grade A/B may reach a seller | `mayApproachSeller()` (§64) | **Built** |
| Closed-shape listing | The public card carries no address, situation or return figure | `opportunityCard()` (§63) | **Built** |
| Reveal | Confirmed sale, our permissions held, not openly advertised, graded buyer | `reveal.ts` / `quoteReveal()` (§62) | **Built** |
| Lode's permissions | Estate-agency AML (HMRC) + redress; credit-broking (FCA) for T2 | `permissions.ts` → `fees.ts` | **Built** (evidence via `HELD_PERMISSIONS`) |
| Flipper's permissions | The flipper's **own** AML + redress, for T3 | `fees.ts` `sourcerComplianceProblem()` | **Built** |
| No double-charge | Seller not already tied under sole agency/selling rights (T5) | `fees.ts` `bindsSellerElsewhere()` | **Built** |
| Connected-party disclosure | If Lode/a connected party acts as principal, the seller is told | `accounts.ts` `CONNECTED_PARTY_DISCLOSURE` | **Built** |

**Deriving "listable":** `workflow.ts` (§68) walks the steps forward and stops
at the first gap, so "is this property ready to be public?" is a computed
answer, not a flag someone sets.

---

## 5. How a property enters the marketplace

There are two sources, and they are **not** equivalent.

### 5a. A seller submits it (`/sell`)
Consented from the first second. Becomes a public listing once §66/§67 clear
and Seller Protection does not block. **Gap:** today the clearing steps are
operator actions; a true marketplace needs them self-serve (see build order #1).

### 5b. A letter-sourced lead (homeowner / probate / insolvency)
**Never auto-public.** These people did not ask to be listed; we reached them
from public records under legitimate interest as a private 1-to-1 approach.
A letter is a knock on the door, not a shop window.

```
  Public record → private letter → owner REPLIES & CONSENTS
       → ownership verified → THEN it may become a listing (5a path)
```

Putting a non-responding, non-consenting distressed owner's property on a public
board would destroy the lawful basis and breach data protection — forbidden by
§59 and the discovery/outreach quarantine (`/operator/discovery`,
`/operator/outreach`). **This is the single hardest constraint in the model and
is not negotiable.**

---

## 5c. Fee-exempt accounts — and the house account

An admin can make an account **fee-free**: it sells, buys and flips like anyone
else but pays no cut and no membership. There are two cases, and they carry
different rules. Both still compete **at the same level** — a fee-exempt account
passes **every gate in §4** like everyone (identity- and funds-checked before it
can reach a seller, closed-shape card until reveal, no seller data as a buyer per
§16). Its *only* privilege is price: no earlier sight of a deal, no queue-jump,
no data edge. An account that could see what others cannot is self-preferencing,
and that is the abuse these rules exist to prevent.

### The grant itself (both cases)
Fee-exemption is an **admin-only, evidenced grant** — never self-service, never a
bare boolean. It records who granted it, when, why, and optionally an expiry, is
written to the append-only audit trail (the shape of a manual money movement,
§32), and is revocable. It is a real economic privilege — a fee-free buyer keeps
what a paying buyer hands Lode as a cut, so in a competitive bid it can net more —
so it is deliberate, bounded and recorded, not a quiet switch.

### Case A — an ordinary third party, comped
A genuinely independent account the admin chooses not to charge (a launch
partner, a VIP). The seller is **not** dealing with the house, so there is **no
connected-party disclosure** — the buyer is independent and only Lode's own
economics change. The controls that matter are internal: the audited grant above
and the same-level fairness rule.

### Case B — the house account (Lode or a connected party)
The admin also marks it `connectedParty`. Everything in Case A applies, **plus**:

1. **Always disclosed to the seller.** Wherever it faces a seller, the seller is
   told they are dealing with the house, not an independent party
   (`CONNECTED_PARTY_DISCLOSURE`). This is the difference from Case A.
2. **Counted honestly.** A house buy-mandate must not inflate the public
   "verified buyers" figure a seller reads (§59, `supply.ts`) — excluded, or
   shown as the house.

**✅ Built.** `FeeExemption` + `isFeeExempt()` in `accounts.ts` (connected party
OR a current admin grant), derived not stored (§26). A fee-exempt account
derives the full entitlement free (`backend/billing/entitlement.ts`) and opens
opportunities for £0 (`backend/billing/reveal.ts`); `publicBuyBoxes()` leaves the
house out of the seller-facing "verified buyers" count. The grant is admin-only,
reasoned, optionally time-boxed, audited and revocable (`setFeeExemption`,
`FeeExemptionForm`). The disclosure and the same-level gates are unchanged.

---

## 6. The gaps — all closed

1. **Self-serve listing path (5a). ✅ Built.** A seller provides the material
   information (§66) themselves through their capability link
   (`recordSellerMaterial`, `sell/[id]/ListingSection.tsx`). The honest half:
   identity and ownership (§67) stay a Lode check — a seller cannot clear their
   own AML — so the listing goes live only once that check and Lode's permissions
   are also in place. `quoteReveal` enforces the rest unchanged.

2. **Reseller / sub-agent (T7, role). ✅ Core built.** `reseller.ts` `mayResell`
   refuses unless the owner has authorised it (`ResaleConsent`, set by the owner
   on `sell/[id]`) **and** the reseller holds their own verified AML + redress
   (reusing `sourcerComplianceProblem`); it takes and returns no seller data, so
   a reseller works from the closed-shape card. A reseller takes a consented
   listing on from the opportunity page (`takeOnListingAction`, `ResellerPanel`),
   and Lode's 20% is a computed, gated per-deal cut (`resellerInvoice`) shown on
   the Fees page.

3. **Reseller commission (T7, money). ✅ Built.** `resellerCommission` / 20% of
   the reseller's fee in `pricing.ts`, pinned by test.

4. **Consent bridge (5b → 5a). ✅ Built.** `outreachConsent.ts`
   `awaitingOwnerConsent` makes the §5b state explicit; a sourced lead is listed
   only on the owner's reply recorded as an owner confirmation, and an
   agent confirmation on a cold lead is refused. Reuses the confirmation
   machinery, not a parallel path.

5. **Fee-exemption (§5c). ✅ Built.** An admin-only, evidenced, audited, revocable
   grant (who/when/why/expiry) that **any** account may receive; a fee-exempt
   account — by grant or `isConnectedParty()` — derives the full entitlement free
   and opens opportunities for £0, and `publicBuyBoxes()` leaves the house out of
   the seller-facing buyer count. See §5c.

---

## 7. Build order — complete

Every gap is built, in dependency order, each shipped with tests and its gate
wired before the money: self-serve listing → reseller commission → reseller
capability → consent bridge → fee-exemption → reseller acting surface + cut.

The pattern held throughout: UI → validation → server action (self-authorising)
→ domain logic → store → the cut in `fees.ts`/`pricing.ts` → tests → verify the
route renders. No cut was wired before its gate.

One honest boundary remains by design, not omission: seller identity and
ownership (§67) stay a Lode check — a seller cannot clear their own AML — so a
self-served listing still waits on that check and Lode's permissions before it
goes live. That is the law, not a gap.

---

## 8. What this model does **not** change

- Lode never owns the property and holds no stock. The cut is a facilitation
  fee, not a margin on inventory.
- The compliance gates in §4 are the product, not an obstacle to it.
- Letter-sourced leads stay private until the owner consents (§5b).
- Pricing lives only in `pricing.ts`; the audit trail stays append-only; seller
  data stays encrypted and behind `view-seller-data`.
- The §12 prohibitions register and the boundary/authorisation tests still hold.
- A fee-exempt account's only privilege is price — never a data, timing or queue
  advantage. The grant is admin-only and audited. The house account's
  participation is additionally always disclosed to the seller.
