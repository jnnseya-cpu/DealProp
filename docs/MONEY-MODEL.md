# How Lode makes money — every case

Where every pound comes from, who pays it, and when it is collectable. Taken
from the fee engine, not from a pitch: every figure here is stated once in
`pricing.ts`, charged through `fees.ts` / `reveal.ts` / `charging.ts`, and gated
so nothing bills ahead of the work. Figures are current as of this document;
the catalogue is the source of truth if the two ever differ.

---

## 0. The one rule behind all of it

A fee is only **collectable** when four things are true (`fees.ts`):

1. **Permission** recorded — HMRC estate-agency AML, a redress scheme, and FCA
   credit-broking, held and evidenced through `HELD_PERMISSIONS`.
2. **Stage** — the deal has reached the point the fee falls due at.
3. **Disclosure** — the seller was told, where they are a party to the fee.
4. **A named person** raises it — never the shared operator password.

And one switch sits above all of it: **no card is charged until a live Stripe
account is configured.** Today `createCharge()` fails closed, so every amount
below is *modelled and gated*, not yet banked. Two configuration steps convert
the model into cash:

- record the permissions in `HELD_PERMISSIONS`, and
- connect live **Stripe** (+ **Stripe Connect** for payouts).

Until then each charge is computed and refused at the last step, by design.

---

## 1. Recurring money — monthly, predictable, no permission needed

Subscriptions are the base, non-deal income. The `buyer-subscription` and
funder plans carry no permission dependency, so they are the two things that can
be sold the day Stripe is connected.

| Plan | Price / month |
|---|---|
| Buyer — Explorer | £0 |
| Buyer — Scout | £39 |
| Buyer — Acquisition | £129 |
| Buyer — Professional | £399 |
| Buyer — Business | £1,500 |
| Lender — Private | £299 |
| Lender — Professional | £999 |
| Lender — Institutional | £2,500 |

**Where / when:** `/account/billing` checkout, billed monthly.

---

## 2. Pay-as-you-go — one-off, on use

**Analysis credits (ACUs):** £10 / 100 · £45 / 500 · £160 / 2,000 · £650 / 10,000.
**Prepaid top-ups:** £25 · £100 (+£5 bonus) · £500 (+£50 bonus). A bonus is a
separate non-refundable lot.

**Opportunity reveal fee** — a buyer pays to *open* an opportunity (the
introduction itself):

| Opportunity class | Reveal fee |
|---|---|
| Standard residential | £39 |
| Owner-verified motivated seller | £99 |
| Vacant / refurbishment | £149 |
| HMO or small mixed-use | £199 |
| Small development | £349 |
| Commercial | £495 |
| Land | £750 |
| Portfolio disposal | £1,250 |

**When:** the moment the buyer opens it. **Gate (`quoteReveal`):** a confirmed
sale, your estate-agency permissions held, a grade-A/B buyer (identity *and*
funds checked), material information Part A answered, seller due diligence done,
and the property not already openly advertised. Refundable under the published
guarantee. A fee-exempt / house account opens for £0.

---

## 3. Transaction cuts — by case, on completion

The seller's default route is **free to the seller**: they sell to a cash buyer
we introduce and pay nothing, because the buyer and lender are the payers. The
seller pays only where they choose to have us sell *for* them (Case B).

### Case A — Seller sells to a cash buyer we introduce (free/default)
Seller pays **nothing**. You earn from the buyer and the lender:

| Fee | Amount | Payer | Due at |
|---|---|---|---|
| Deal packaging | £199 (fixed) | Buyer | qualified |
| Deal success fee | 0.75% of price | Buyer | completion |
| Sourcing fee | 1.5%, min £3,000, cap £25,000 | Buyer (investor) | completion |
| Funding introduction | 0.5% of the facility drawn | Lender | funded / completion |

*Worked example — £200,000 purchase, £150,000 facility:*
£199 + £1,500 + £3,000 (the floor) + £750 ≈ **£5,449**, all buyer/lender.

### Case B — Seller instructs us to sell *for* them (agency)
Seller pays the **seller success fee: 0.60% of the price achieved, minimum
£1,250, capped £7,500**, on completion, and **nothing if the property does not
sell**. Needs their signature and that they are not still instructed under sole
agency / sole selling rights (or they would pay twice for one completion).
Buyer-side fees in Case A can still apply alongside.

### Case C — Buyer
Monthly plan + a reveal fee per opportunity opened + (on a deal they complete)
packaging + deal success + sourcing. Plan monthly, reveal on open, the rest on
completion.

### Case D — Lender
Funding introduction **0.5% of the facility** on funded/completion, plus their
monthly plan.

### Case E — Flipper, source & assign
You take **15% of the flipper's assignment margin**, on completion of the
assignment — a share of their profit, never of the property price. Gated on the
flipper's own verified HMRC AML + redress. *£20,000 margin → £3,000.*

### Case F — Flipper, buy & resell
Two deals: buyer-side fees on their purchase, then a fresh Case A / Case B on
their resale.

### Case G — Reseller / sub-agent
You take **20% of the reseller's own fee** on the onward sale, on completion —
again a share of their fee, never the price. Gated on the owner's recorded
authority and the reseller's own verified AML + redress. A raiseable/voidable
ledger line. *£8,000 fee → £1,600.*

### Case H — Agent / auctioneer (partner)
Free to join and list — the supply side carries no fee to be here. You earn a
**revenue share only where the platform wins them completed work** — auctioneer
**10%** of the agreed share.

### Case I — Provider marketplace (ancillary, on a completed booking/referral)
| Provider | Commission |
|---|---|
| Conveyancer | £200 per instruction |
| Surveyor / valuer / removals | 10% of their fee |
| EPC assessor | £17.50 per booking |
| Photography & floor plans | 12.5% of the booking |
| Refurbishment contractor | 6.5% of the contract |
| Property manager | 8% of the first month's fee |
| Letting agent | £150 per referral |
| Mortgage / bridging broker | 20% of the broker's fee (authorised introducer) |
| Insurance | 15% (authorised affiliate) |
| Utilities & broadband | 20% affiliate |

### Case J — House / fee-exempt accounts
£0. Lode's own or an admin-comped account competes at the same level as anyone,
pays no fee and no membership — its only privilege is price.

---

## 4. When the cash actually moves

**In:**
- Subscriptions — monthly.
- Reveals and credits — immediately, on purchase.
- Transaction cuts — on **completion** (packaging earlier, at *qualified*;
  funding introduction at drawdown). Each is refused until its gate clears.

**Out (payouts to flippers / partners):**
- Held **14 days** — the buyer's own refund window — and blocked entirely while
  any reversal is outstanding. A wrong payment out is unrecoverable, so money
  leaves once and late rather than early. The recipient must be a verified
  account before anything is sent.

---

## 5. To switch it on

Everything above is built, priced and gated. It becomes collectable the moment
both of these are configured:

1. **Record the permissions** — HMRC AML + a redress scheme (+ FCA credit-broking
   for the funding introduction) in `HELD_PERMISSIONS`.
2. **Connect live Stripe + Stripe Connect.**

With both in place, the buyer/lender cuts, the seller agency fee, the 15%
assignment and the 20% reseller cut all become collectable on the stages above —
no code change required.
