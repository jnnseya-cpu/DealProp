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
| T0 | Any of the above where a side is the **house account** | — | **£0 — we do not charge ourselves** | **Gap — see §5c** |

**The default route is free to the seller** (T1/T2/T3): the seller sells to a
cash buyer we introduce and pays nothing — the buyer, lender or flipper is our
payer. The seller only pays on T5, where they chose to have us sell *for* them.

**The house account pays nothing on any of them** (T0): where Lode's own
connected account is the buyer, flipper or lister, there is no cut to charge,
because the payer and the payee are the same party. It also holds no paid
membership — its plan entitlement is granted, not bought.

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

## 5c. The house account — Lode participating in its own market

An admin may allocate roles to an account and mark it as Lode or a connected
party (`connectedParty` in `accounts.ts`). That account can **sell, buy and
flip like any other user, free of every fee and membership.** This is Booking.com
listing its own property, or Uber Eats running a house kitchen — legitimate, and
common in a marketplace — but in property it is only legitimate under three
rules, which are compliance requirements, not options:

1. **It competes at the same level — one privilege only: price.** The house
   account passes **every gate in §4** like anyone else: it is identity- and
   funds-checked before it can reach a seller as a buyer, it sees only the
   closed-shape card until it clears reveal, and as a buyer it **never** gets
   seller confidential data (investors/funders hold no `view-seller-data`, §16 —
   and a connected buyer is still a buyer). Its *only* advantage over a real user
   is that it pays £0. No earlier sight of a deal, no queue-jump, no data edge.
   A house account that could see what others cannot is self-preferencing, and
   that is the abuse this rule exists to prevent.

2. **Its participation is always disclosed.** Wherever the house account takes
   part in a deal facing a seller, the seller is told they are dealing with the
   house, not an independent party — `CONNECTED_PARTY_DISCLOSURE` already carries
   the exact words, and it is a CPR/fair-dealing requirement. Never settable at
   self-service sign-up; only an admin marks an account connected.

3. **It is counted honestly.** A house buy-mandate must not inflate the public
   "verified buyers" supply figures a seller reads (§59, `supply.ts`). Either it
   is excluded from those counts or it is shown as the house — never passed off
   as independent demand.

**What is built:** the `connectedParty` flag, the disclosure, admin role
allocation, and the gates it must pass. **What is the gap:** the fee exemption
itself and the free membership — today a connected party is still priced like a
customer. The clean derivation (no new flag, no stored `isFree`): a
connected-party payer resolves to a £0 charge in `charging.ts`/`fees.ts`, and to
full plan entitlement in `entitlements.ts` — both *derived* from
`isConnectedParty()`, the same way entitlement is already derived rather than
stored (§26). And `supply.ts` must learn to exclude or label house mandates.

---

## 6. What is genuinely new (the gaps)

1. **Self-serve listing path (5a).** A seller takes their own property all the
   way to a live listing: attest material information, confirm/verify ownership,
   auto-list when clear. Foundation for everything else. *Chosen as the likely
   first build.*

2. **Reseller / sub-agent (T7, role).** Let a user take a *listed* property and
   market it onward for a cut. The legally heaviest piece:
   - they act as an estate agent → need their **own** AML + redress;
   - they need the **original owner's authority** to re-market;
   - they may see **only the closed-shape card**, never the seller's
     confidential data;
   - a new commission in `pricing.ts`, gated like the flipper's 15%.

3. **Reseller commission (T7, money).** Define and pin it, with its own test.

4. **Consent bridge (5b → 5a).** The mechanism that turns a positive letter
   reply into a consented, verifiable listing — reusing the `/sell` path, not a
   parallel one.

5. **House-account fee exemption + free membership (§5c).** A connected-party
   payer derives to a £0 charge and full entitlement, and `supply.ts` excludes
   or labels house mandates. Derived from the existing `connectedParty` flag —
   no new stored status, and the disclosure/gates are already built.

---

## 7. Proposed build order

Dependency-first, each shippable on its own, each with tests and the gates wired
before the money:

1. **Self-serve listing path** (gap #1) — the foundation; nothing else is a real
   marketplace without it.
2. **House-account fee exemption + free membership** (gap #5) — small and
   self-contained: derive £0 charge and full entitlement from `connectedParty`,
   and label/exclude house mandates in `supply.ts`. The disclosure and gates
   already exist, so this is the cleanest early win.
3. **Reseller commission in `pricing.ts`** (gap #3) — small, unblocks the role.
4. **Reseller / sub-agent capability** (gap #2) — authority + own AML/redress +
   closed-shape-only, built on the reveal and fee machinery that already exists.
5. **Consent bridge** (gap #4) — connect the outreach reply to the listing path.

Each step: UI → validation → server action (self-authorising) → domain logic →
store → the cut in `fees.ts`/`pricing.ts` → tests → verify the route renders.
No cut is wired before its gate.

---

## 8. What this model does **not** change

- Lode never owns the property and holds no stock. The cut is a facilitation
  fee, not a margin on inventory.
- The compliance gates in §4 are the product, not an obstacle to it.
- Letter-sourced leads stay private until the owner consents (§5b).
- Pricing lives only in `pricing.ts`; the audit trail stays append-only; seller
  data stays encrypted and behind `view-seller-data`.
- The §12 prohibitions register and the boundary/authorisation tests still hold.
- The house account's only privilege is price. It never gets a data, timing or
  queue advantage, and its participation is always disclosed to the seller.
