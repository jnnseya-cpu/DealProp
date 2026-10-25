# Lode AI-OS — the operating system blueprint

A developer- and investor-grade specification for evolving Lode from a property
deal engine into an **AI Infrastructure Operating System for property deals**.

This document honours a maximalist brief without abandoning the discipline that
makes Lode legal to operate. It is written to be built from directly. It does
two things most "AI-OS" documents refuse to do: it **grounds every proposal in
code that already exists**, and it **states plainly what will not be built, and
why**, because in a regulated money business the refusals are the architecture.

Read `CLAUDE.md` and `docs/ARCHITECTURE.md` first. Nothing here overrides them.

---

## 0. The one rule that shapes everything — the autonomy boundary

Lode moves other people's money and markets their homes under UK law: FSMA 2000
s.21 (financial promotions), the Estate Agents Act 1979, the Consumer
Protection from Unfair Trading Regulations 2008, the Money Laundering
Regulations 2017, PECR 2003, and consumer-credit regulation on secured lending.
Every one of these attaches **personal, named accountability** to a decision.

Therefore the AI-OS has exactly one governing law of its own, and it is the
law §12 already encodes in `agents.ts`:

> **An agent observes, analyses, forecasts, ranks, drafts and _proposes_. A
> deterministic engine or a named human _decides_.**

This is not timidity. It is the thing that lets us ship agents at all. The
industry references the brief cites prove the point rather than contradict it:
Bloomberg and Aladdin put analytics in front of a human portfolio decision;
Stripe Radar _scores_ and a rule or a reviewer _blocks_; Palantir Foundry is a
decision-support substrate with human operators; CrowdStrike auto-contains a
host but never auto-fires an employee. None of them removes the accountable
human from the act that carries liability. Neither do we.

### What an agent may do, and may never do

| May (propose / observe) | May never (decide / act with legal or money effect) |
|---|---|
| Compute a figure from a tested engine and cite its evidence | Originate a figure a party relies on — the engine does that |
| Rank routes, opportunities, leads, offers | Clear a Seller Protection block or downgrade it to a warning |
| Draft outreach, memoranda, replies, summaries | Send a message, make an introduction, publish a promotion |
| Forecast churn, conversion, refinance windows | Approve a seller, a buyer, a payout recipient or a reveal |
| Flag anomalies, threats, defects, drift | Move money, change a price, mark a condition satisfied |
| Open a ticket, a review, a draft deployment | Merge, deploy to production or self-modify the decision engines |

The right-hand column maps one-to-one to controls that already exist:
`protection.ts` (block cannot be downgraded), `authoriseDecision()` (no shared
credential decides), `charging.ts` / `ledger.ts` (money moves once, with a key),
`reveal.ts` / `mayApproachSeller()` / `payouts.ts` (gated approvals),
`prohibitions.ts` (the register that names each control). The AI-OS extends this
surface; it does not route around it.

**"Self-healing" is redefined accordingly** (§9, §14): the platform may
automatically restart a container, fail over, roll back a bad deploy behind a
flag, scale, and open a remediation ticket — infrastructure acts with no legal
or money effect, fully audited. It may **never** auto-patch the domain engines,
auto-approve a party, or auto-move funds. Detect-and-propose is the ceiling for
anything that touches a decision.

---

## 1. Executive product vision

**What it is.** Lode is the operating system a property deal runs on from the
first call to completion. It ingests a motivated seller's situation, computes
**one coherent position** — score, routes, capital stack, regulatory route,
protection, the twelve-step workflow — and carries the deal through
negotiation, funding, the professionals and payout, inside a hard sixty-day
completion cap. Everyone who touches the deal (seller, buyer, lender,
professional, operator) works from the same source of truth, seeing only the
slice their permission grants.

**The problem it solves.** The distressed and motivated-seller market is served
today by three broken things: estate agents (wrong tool, too slow, wrong
incentive), unregulated "we buy any house" cash buyers (opaque, often
exploitative, no audit), and spreadsheets (every sourcer rebuilds the same
arithmetic and gets it wrong). Nobody computes an honest, after-tax,
protection-screened position and then proves it. Lode does, and keeps the
receipts.

**Why it is different.** Every number is computed by a deterministic engine and
published **with its reasoning, its confidence, the evidence used and the
evidence missing** (§6, §18, §65 of `CLAUDE.md`). The AI never originates a
figure. That is both the product moat and the compliance posture — it is very
hard to copy a competitor whose defensibility is "we can show our working on
every decision, under audit, forever."

**Why it can dominate.** The deal data compounds. Positions, outcomes,
completion times, funder behaviour, buyer grading and refinance windows become
a proprietary intelligence layer (§8 here, the AI Data Intelligence Layer) that
no new entrant has. The AI-OS turns that corpus into forecasting, matching and
decision-support that gets sharper with every completed deal — while the
decision itself stays accountable.

---

## 2. Market-gap deep review

| Incumbent | Does well | Fails to solve | Lode's answer (in code) |
|---|---|---|---|
| Rightmove / Zoopla (portals) | Reach, listings liquidity | No decision, no distressed-seller path, no funding, no completion | `director.ts` single position; `sellerRoutes.ts`; sixty-day cap |
| "We buy any house" cash buyers | Speed | Opacity, no audit, no protection, low-ball with no disclosure | `protection.ts` block; §47 `agentComparison` on every below-market route |
| PropTech sourcing tools (e.g. lead-gen SaaS) | Lead volume | No lawful outreach spine, no verification, no completion | `discovery/` licence-gated fetcher; `outreach.ts` eligibility; `workflow.ts` |
| Bridging/dev-finance brokers | Access to capital | Manual, no readiness scoring, no regulatory routing | `fundingReadiness.ts` 0–100; `regulatoryRoute.ts` six routes; `borrowing.ts` |
| Generic "AI agent" platforms | Demos | No domain engines, no determinism, no audit — ungovernable for money | §12 agents as observers over tested engines; closed effect set |
| Aladdin / Bloomberg (the aspiration) | Decision-support at scale, trusted | Not property, not SME-accessible, enterprise-only | Same pattern, property-native, self-service |

**The gap Lode fills better than anything available:** a *governed* agentic
system for property money. Competitors are either trustworthy-but-manual or
automated-but-ungovernable. Lode is automated analysis with governed decisions.

---

## 3. Complete user ecosystem

| User type | Exists today | Primary surface | Permission anchor (`accounts.ts can()`) |
|---|---|---|---|
| Seller | Yes | `/sell`, `/sell/[id]` | capability URL (CSPRNG), no account needed |
| Buyer / investor | Yes | `/invest`, `/opportunities`, `/account/passport` | grade + certification; never `view-seller-data` |
| Lender / funder | Yes | `/capital`, `/deals/[id]/funding` | mandate ownership; `regulatoryRoute` cleared |
| Professional (solicitor, surveyor, agent, trade) | Partial | `/partners`, `/deals/[id]/agents` | role + `can()` |
| Operator (staff) | Yes | `/operator/*` | deny-by-default ×2; `requireOperator()` |
| **Merchant / developer (BitriPay)** | **New (§7)** | `/developers`, `/account/api` | API key scope + HMAC |
| **Partner / white-label tenant** | **New (§12)** | tenant-scoped everything | tenant id + plan |
| Regulator / auditor | Implicit | read-only `/operator` export | audit trail (append-only) |
| Third-party API consumer | **New (§11)** | public API gateway | OAuth client + rate tier |

No existing user type is removed. New types are additive and plug into the same
`can()` decision point — there is one place a permission is decided, and it
stays that way.

---

## 4. AI Command Centres (per user type)

An AI Command Centre is not a new product. It is a **governed cockpit** over
each user's existing surface: a chat/brief panel plus a set of agents scoped to
exactly what that user may already see and do. It originates nothing; it
assembles context, proposes, and routes every action through the same server
checks the UI already enforces. One shared runtime (`backend/agents/service.ts`
pattern) assembles context and applies a decision a named person makes.

| Command Centre | Sees | Proposes | Executes (only via existing gated action) |
|---|---|---|---|
| **Seller** | Own deal position, routes | "Fast cash best for your stated priority: speed; here's what you give up (§47)" | Nothing — seller chooses a route; human/engine commits |
| **Buyer** | Graded opportunities (closed card shape §63) | Ranked shortlist, readiness gaps on own passport | Buy via `/api/billing/checkout` (price from server) |
| **Lender** | Own mandates, matched deals | Readiness-sorted pipeline, DSCR forecast | Record interest; introduction only if `regulatoryRoute` cleared |
| **Professional** | Assigned deals | Draft conditions plan, task list | Accept a §12 proposal (named sign-off) |
| **Operator** | Everything in scope | Triage queue, anomaly digest, revenue position | Any operator action, each still permission-checked |
| **Merchant/Dev** | Own transactions, keys, webhooks | Settlement reconciliation, failure diagnostics | Rotate keys, replay webhooks (scoped) |

**Chief of Staff, Analyst, Research, Automation, Growth, Security, Knowledge**
(the brief's seven roles) are implemented as **agent _roles_ within a Command
Centre**, not seven separate products. Each role is a prompt + tool-scope over
Lode engines and connectors, bounded by the user's `can()` grants. The LLM is
the edge that phrases and plans; the engines produce every figure (§50).

---

## 5. Core AI agents — the workforce, governed

The brief lists dozens of agents (executive, product, engineering, security,
revenue, compliance). We honour the catalogue but classify each honestly, so
the list becomes a roadmap instead of a wish. **Every agent uses the §12
contract**: trigger → observe engines → proposal with evidence → named decider.

### 5.1 The agent contract (every agent, no exceptions)

```
Agent {
  id: AgentId
  trigger(ctx): boolean            // has something to say
  observe(ctx): Evidence[]         // reads tested engines + connectors (read-only)
  propose(evidence): Proposal      // typed; effect ∈ closed set or NONE
  escalate: EscalationRule         // when a human must look
  effect?: Effect                  // ⊂ { recordReview, recordSelection, recordSignOff, adoptStandardPlan }
}
decide(proposal, actor): Result    // actor is a named person; authoriseDecision() refuses shared creds
```

No agent holds an effect outside the closed set. Adding a fifth effect is a
reviewed architectural change, not a feature toggle (§51, enforced by
`EFFECT_OWNERS` and `tests/`). This is why the workforce can grow without the
risk growing with it.

### 5.2 Catalogue and disposition

| Brief's agent | Lode disposition | Backing engine / seam | Can it ever act alone? |
|---|---|---|---|
| Onboarding | Phase 1 | intake, passport, screening | No |
| Compliance / GDPR / AML / KYC / Regulatory | **Exists + extend** | `regulatoryRoute`, `sellerDueDiligence`, `screening`, `prohibitions` | No — routes to review |
| Risk | **Exists** (§12 risk agent) | `redteam`, `protection`, `opportunityScore` | No |
| Revenue / Pricing / Monetisation | Phase 1 | `pricing`, `revenue`, `entitlements`, `ledger` | No — price from server only (§23) |
| Support / Success / Retention | Phase 2 | tickets + CLV model (§8) | No — drafts replies |
| Marketing / Growth | Phase 2 | `analytics`, `seo`, `campaign` | No — drafts; consent-gated (§10, §20) |
| Data Intelligence | Phase 1 | the Data Intelligence Layer (§8) | No — forecasts, never decides |
| Operations | **Exists** | `workflow`, `completion` | No |
| Fraud Detection | Phase 1 | `screening`, device/behaviour signals, ledger | No — scores; human/rule blocks |
| Payment | Phase 1 | `charging`, BitriPay/Stripe adapters | No — proposes reconciliation |
| API Integration | Phase 2 | connector ports (§8) | No |
| Workflow Automation | Phase 1 | `workflow`, cron endpoints | Infra only, non-legal, audited |
| Predictive Growth | Phase 2 | Decision Intelligence Engine (§8) | No |
| Admin Control | **Exists** (`/operator`) | every engine, permission-checked | No — operator decides |
| Matching, Structuring, Memorandum, Intake, Due-Diligence, Terms, Capital, Completion | **Exist** (the nine §12 agents) | per `PAF-OS.md` | No |
| **Executive agents** (CEO/COO/CFO/CTO/CMO/CRO) | **Reframed** | Not autonomous officers — these are **operator analytics dashboards with a brief** (revenue, ops, risk, growth) | No — advisory only |
| **Self-managing agents** (System Health, Bug Detection, Auto-Repair, Infra Optimisation, Release Mgmt, AI Governance) | §9 / §14 | Observability + CI/CD + flags | Infra-only automation; never the engines or money |

"Executive agents that run the company" is the one place the brief and reality
part company, and we say so in the document rather than silently shipping a
CFO-bot that could authorise spend. They become **decision-support briefs** an
accountable officer reads. That is what Aladdin and Bloomberg actually are.

---

## 6. Full platform modules — built, and the deltas

| Module | Status | Where | AI-OS delta |
|---|---|---|---|
| Landing / marketing | Built | `src/app/page.tsx` | Command-Centre entry points |
| Seller intake + routes | Built | `/sell`, `sellerRoutes.ts` | Seller Command Centre overlay |
| Free appraisal | Built | `/appraise` | — (no score; §57) |
| Deal pipeline + Deal Room | Built | `/deals`, `/deals/[id]` | Analyst + Ops agents |
| Negotiation | Built | `negotiation.ts` | price-band advisory |
| Funding | Built | `/deals/[id]/funding` | readiness forecasting |
| Agent board | Built | `/deals/[id]/agents` | the §12 nine |
| Memorandum | Built | `/deals/[id]/memorandum` | drafter edge only (§18) |
| Marketplace | Built | `/opportunities`, `/invest`, `/capital` | buyer/lender Command Centres |
| Buyer passport | Built | `/account/passport` | readiness coaching (propose) |
| Operator suite | Built | `/operator/*` | Admin Super Control Centre (§14) |
| Billing | Built | `/account/billing`, webhook | **BitriPay gateway (§7)** |
| Newsletter / outreach | Built | `/newsletter`, `/operator/outreach` | Growth agent (consent-gated) |
| Conduct register | Built | `/operator/conduct`, `prohibitions.ts` | AI Governance surface |
| **Developer centre** | **New** | `/developers`, `/account/api` | §7, §11 |
| **Data intelligence** | **New** | internal + `/operator/intelligence` | §8 |
| **Admin super control** | **Extend** | `/operator` | §14 |

Nothing is removed. Every delta is an overlay or a new module on an existing
seam.

---

## 7. BitriPay payment gateway — a first-class provider adapter

BitriPay is a payment provider you own. Lode already has the exact seam for it:
`src/backend/billing/provider.ts` is the port, `stripe.ts` is the one adapter,
and `webhook.ts` verifies inbound money over raw bytes (§27, §70). **BitriPay is
a second adapter against that same port — not a parallel money path.** This is
the single highest-value, most-buildable item in the whole brief.

### 7.1 Where it plugs in

```
pricing.ts  ──►  charging.ts  ──►  provider.ts (port)
                                     ├── stripe.ts   (existing)
                                     └── bitripay.ts  (new adapter)
ledger.ts  ◄──  /api/billing/webhook (verifyWebhook over raw bytes, claimed once)
payouts.ts ──►  provider.makePayout ── bitripay connect/settlement
```

### 7.2 Merchant / developer surface (`/developers`, `/account/api`)

| Capability | Spec |
|---|---|
| API key generation | Scoped keys (`read`, `charge`, `payout`), last-4 shown, full value once; `managedBy` per `settings/catalogue.ts` pattern |
| Sandbox vs live | Separate key prefixes (`bp_test_` / `bp_live_`); sandbox never touches `ledger` |
| Webhooks | Register endpoint + secret; **HMAC-SHA256 over raw bytes**, replay-protected by event id (mirror `webhook.ts`) |
| QR / link / wallet / card / bank / mobile-money | Each a `ChargeIntent` type; **no amount from client (§23)** — intent names a product; server prices |
| Settlement engine | Lots in `ledger.ts`; settlement = scheduled payout, held 14 days (§72) |
| Refunds / disputes | Refund = reversal; **chargeback voids the whole lot (§25)**; dispute opens an operator task |
| Commission split | Derived from `pricing.ts`, never a client field; split recorded as separate ledger movements with idempotency keys |
| Transaction monitoring | Fraud agent scores; rules/human block; all append-only audited |

### 7.3 Hard rules carried over (non-negotiable)

1. Verify signature over **raw bytes** before any parse (§27).
2. Event claimed **once** — idempotency key unique in the store (§24).
3. Allowlist event types; amount-checked against the catalogue (§27).
4. **Nothing credited from a redirect** — the browser-controlled return URL has
   no path to the ledger (§71). `/account/billing/complete` reads the ledger.
5. One file knows BitriPay's names and wire format: `bitripay.ts`. A different
   signature scheme is a change to `webhook.ts`, visible as one (§70).

### 7.4 Developer documentation & plugin logic

Auto-generated from the OpenAPI spec (§11), served at `/developers/docs`,
versioned. Plugin SDKs (JS, PHP for WordPress/WooCommerce, Python) wrap the same
REST surface; none can send an amount.

---

## 8. Third-party connector ecosystem — ports and adapters

Every connector follows Lode's proven pattern: a **port** in `src/shared` or
`src/backend` defines the contract and a **closed path** that fails safe; an
**adapter** implements a named provider; a **recorded licence/credential** gates
use (§14, §38, `screening.ts` is the reference). No connector reads or sends
without a recorded credential, and an absent provider returns an inconclusive /
refused state, never a silent success.

| Category | Why Lode needs it | Connects at | Data in/out | Provider options | Port exists? |
|---|---|---|---|---|---|
| Payments | Charge, settle, pay out | `provider.ts` | intent → receipt; webhook → ledger | **BitriPay**, Stripe, Adyen, Checkout.com, PayPal | Yes |
| Banking-as-a-Service / Open Banking | Verify accounts, payouts, AIS | `payouts.ts`, screening | account check, balances | TrueLayer, Plaid, GoCardless | New |
| KYC / KYB | Approve parties, AML | `screening.ts` | identity → outcome+ref | Persona, Sumsub, Veriff, ComplyAdvantage | **Yes (port built, no adapter)** |
| AML / sanctions / PEP | §67 seller + buyer checks | `screening.ts` | name/DOB → hit list | ComplyAdvantage, Sumsub | Yes |
| Fraud / device intel | Transaction & behaviour scoring | fraud agent | signals → score | Sift, Seon, Stripe Radar | New |
| Email | Double opt-in, outreach, receipts | newsletter transport | message → delivery event | Postmark, SendGrid, Brevo | Yes |
| SMS / WhatsApp / Push | Multi-channel notify (consent-gated) | notification engine | message → status | Twilio, MessageBird | New |
| Maps / geocoding | Postcode → area, comps context | intake | postcode → area | OS Places, Google, Mapbox | New |
| Land data | §registry signal — EPC, Price Paid, ownership | `backend/registry.ts`, `sources/epc.ts` | address → facts | EPC ODC (wired), HMLR, CH | **Partial** |
| Accounting / tax | VAT, invoices, settlement export | billing | ledger → entries | Xero, QuickBooks, HMRC MTD | New |
| CRM | Operator + partner pipeline | operator | contacts, stages | HubSpot, Salesforce | New |
| Analytics | Consented product analytics | `Analytics.tsx` only (§20) | allowlisted events | Meta Pixel, GA (gated) | Yes |
| AI model providers | The agent edges only | agent runtime | prompt → structured values | **Anthropic (default), OpenAI, Gemini/Vertex, Mistral, Cohere** | New (edge) |
| Document generation / e-signature | Memoranda, contracts, sign-off | memorandum, §12 Terms | data → PDF; envelope → signed | DocuSign, native PDF | Partial |
| Cloud storage | Document vault, exports | store/backend | files | Cloudflare R2, S3 | New |
| Auth | Sessions, MFA | `backend/auth` | credentials → session | native scrypt (built), WebAuthn add | **Yes** |
| Currency exchange | Multi-currency pricing/VAT | `money.ts`, `pricing.ts` | rate lookup | ECB, OpenExchangeRates | New |

AI model providers are deliberately listed as **edge** connectors: they phrase,
plan and extract structured values, and they never decide a score or clear a
flag (§50). Default to Anthropic Claude for the agent runtime; the port lets a
deployment swap or add providers without touching the engines.

---

## 9. Production-grade architecture

Lode is **one deployed unit**, not a microservice sprawl, and that is correct
for its stage (`output: "standalone"` + Dockerfile, §54). The AI-OS architecture
adds layers at the edges, not a rewrite.

```
┌───────────────────────── Client (React 19 / Next 16 App Router) ───────────────┐
│  Command Centres · Deal Room · Marketplace · Operator · Developer centre         │
│  (shared/ is the ONLY layer in the browser bundle — boundary test enforces §54)  │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │  server actions (each checks its own permission §29) + REST (§11)
┌───────────────▼──────────────────────────────────────────────────────────────┐
│  API gateway  ── rate limit (rateLimit.ts §76) ── auth (scrypt, MFA) ── RBAC    │
│                 ── webhook engine (raw-byte verify §27) ── audit (append-only)   │
├─────────────────────────────────────────────────────────────────────────────┤
│  AGENT ORCHESTRATION (edge)        │  DOMAIN ENGINES (deterministic, pure §50)  │
│  context assembly · LLM edge ·     │  director · dealScore · protection ·        │
│  proposal → named decide ·         │  negotiation · funding* · workflow ·        │
│  agent memory (vector + graph)     │  pricing · ledger · charging · screening    │
├─────────────────────────────────────────────────────────────────────────────┤
│  STORE (repository → postgresStore | fileStore; same contract suite §15, §55)   │
│  migrations/ (numbered, transactional §79) · field encryption AES-256-GCM §16    │
├─────────────────────────────────────────────────────────────────────────────┤
│  DATA INTELLIGENCE LAYER (§8 below) — read models, async, never in the hot path │
├─────────────────────────────────────────────────────────────────────────────┤
│  CONNECTORS (ports + adapters, licence-gated §38) · payments · KYC · land · AI  │
└─────────────────────────────────────────────────────────────────────────────┘
  Observability: health (/api/health), metrics, traces, logs (never secrets §Sec)
  Self-managing (infra only): restart · failover · rollback-behind-flag · scale
```

### 8-bis. AI Data Intelligence Layer (the brief's §8)

Built as **read models fed asynchronously from the append-only audit and the
store**, never as a second write path and never in the request hot path:

| Component | Implementation | Feeds |
|---|---|---|
| Event stream | Audit trail → outbox → stream (Kafka/Redpanda, or Postgres LISTEN/NOTIFY at current scale) | everything below |
| Data lake / warehouse | Object store + columnar (DuckDB → Snowflake/BigQuery at scale) | analytics, forecasting |
| Vector DB | Agent memory + document retrieval (pgvector → Pinecone/Weaviate at scale) | agent context |
| Knowledge graph | Deals ↔ parties ↔ properties ↔ funders ↔ outcomes | matching, research agent |
| Real-time analytics | Supply (`supply.ts`), revenue (`ledger`), ops | operator dashboards |
| Predictive engine | Conversion, completion-time, churn, refinance window | Growth/Analyst agents |
| Behavioural engine | Buyer grading, fraud signals | Fraud/Risk agents |
| Recommendation engine | Route/opportunity/offer ranking | Command Centres |
| Decision intelligence | Assembles the above into **proposals**, never decisions | all agents |

Start pragmatic (Postgres + pgvector + DuckDB) and graduate each component only
when load demands it. Do not provision Snowflake for four thousand deals.

---

## 10. Database schema — developer-ready deltas

The store contract (`src/backend/store/`) is additive-first; non-additive change
goes through `migrations/` (numbered, transactional, recorded, §79). New tables
for the AI-OS (key fields, relationships, audit shown):

```
api_clients            id, tenant_id, name, scopes[], key_hash (scrypt$…),
                       prefix (bp_test_|bp_live_), created_by, created_at, revoked_at
                       idx: (tenant_id), unique(prefix+key_hash)

webhook_endpoints      id, api_client_id→api_clients, url, secret_hash,
                       event_types[], active, created_at
webhook_deliveries     id, endpoint_id→, event_id (unique), status, attempts,
                       next_retry_at, signed_at         idx: unique(event_id)

payment_intents        id, tenant_id, product_key (→pricing, NOT an amount §23),
                       provider (bitripay|stripe|…), status, created_at
                       idx: (tenant_id, status)
ledger_lots            (EXISTS) — unchanged; settlements/refunds reference it
settlements            id, tenant_id, lot_ids[], hold_until (completion+14d §72),
                       recipient_id→payout_recipients, status
payout_recipients      (EXISTS, §73) verification{date,checker,method}, lapses

agent_runs             id, deal_id|tenant_id, agent_id, trigger_fired,
                       evidence_json, proposal_json, effect|null, created_at
agent_decisions        id, agent_run_id→, actor (named, NOT shared §32/§51),
                       outcome, decided_at        idx: (agent_run_id)
agent_memory           id, scope(user|deal|tenant), embedding vector, text,
                       source_ref, created_at     idx: ivfflat(embedding)

tenants                id, name, plan, white_label_json, created_at   (§12 WL)
intelligence_events    id, type, subject_ref, payload_json, occurred_at (read model)
security_events        id, kind, actor, risk_score, decision(allow|review|block),
                       created_at (append-only)
```

Rules that bind every table: **money as integer pence behind `Money` (§Money);
idempotency keys unique; audit append-only (§17); encryption at rest for PII
(§16); no `isPro`-style derived flags stored (§26).** Both store engines must
pass the same contract suite against a real Postgres (§55).

---

## 11. API specification (REST + webhooks)

Public API under `/api/v1`, versioned, OpenAPI-generated docs. Auth: OAuth2
client-credentials for server-to-server; scoped API keys for merchants; session
+ CSRF for first-party. Rate-limited per tier (`rateLimit.ts`, fail-open,
per-process, §76). All money endpoints idempotent.

```
POST /api/v1/payment-intents          Create a charge intent (names a product, never an amount §23)
  → 201 { id, status:"requires_action", next:{qr|link|...} }
GET  /api/v1/payment-intents/{id}      Read status (source of truth = ledger)
POST /api/v1/refunds                   { intent_id } → reversal (whole lot §25)
POST /api/v1/payouts                   { recipient_id } → held 14d; recipient must be verified §73
POST /api/v1/webhooks                  Register { url, event_types }
  — Inbound provider webhook: HMAC-SHA256 over RAW BYTES, verify-before-parse §27,
    event_id claimed once §24, type allowlisted, amount vs catalogue.

GET  /api/v1/deals/{id}/position       Full coherent position (permission-scoped; seller data gated §16)
POST /api/v1/agents/{deal}/run         Returns proposals + dormancy reasons (NO effect applied) §53
POST /api/v1/agents/decisions          { proposal_id, actor } apply effect; authoriseDecision() §51
GET  /api/v1/opportunities             Closed-shape cards only §63 (no address/situation/return)

Errors (RFC 7807): 400 validation · 401 auth · 403 permission (deny-by-default)
 · 409 idempotency/conflict · 422 engine-refused (carries reasoning) · 429 rate.
```

Every 422 carries the engine's reasoning — the API never returns a bare refusal,
mirroring §6/§18 on the UI side.

---

## 12. Monetisation model

Grounded in `pricing.ts` (the single source of every price, limit and tax
decision), `revenue.ts` (derives tiers from it), `ledger.ts`, `charging.ts`,
`entitlements.ts`. **No surface may state a price except `pricing.ts`; no client
may send an amount (§23).**

| Stream | Mechanism | Engine |
|---|---|---|
| Subscription (Starter / Pro / Operator / Enterprise) | Plan grants, entitlement derived not stored §26 | `pricing`, `entitlements` |
| Seller completion fee | One % of price achieved, on completion, signature + not under sole agency §81 | `fees.ts` |
| Transaction fees | BitriPay gateway take | `charging`, `bitripay.ts` |
| API usage | Metered calls per tier | gateway meter |
| **AI credits (ACU)** | Prepaid lots; agent runs consume; bonus lots non-refundable §24 | `ledger` |
| Marketplace | Reveal fee, gated and refundable §62 | `reveal.ts` |
| Data intelligence | Aggregate, anonymised market reports — **never a financial promotion §59, no per-deal return figures** | intelligence layer |
| White-label / licensing | Per-tenant plan | `tenants` |
| Enterprise | Custom; same engines | `pricing` |

Dynamic pricing / revenue-optimisation / CLV / churn / upsell / cross-sell
engines are **proposal engines**: they recommend a price or an offer; the price
charged still comes from `pricing.ts` on the server, and a human sets catalogue
changes. VAT fails closed outside the UK for consumers (§28). ACU metering is
counted in the ledger, never from the audit trail (§31).

---

## 13. Security, compliance and risk

The Cybersecurity Command Centre the brief asks for is largely **already the
posture**; the AI-OS formalises and extends it.

| Control | Status | Where |
|---|---|---|
| Zero-trust, deny-by-default ×2 | Built | `middleware.ts` + `requireOperator()` §13 |
| One permission decision point | Built | `accounts.ts can()` |
| Server-side authorise on every action | Built | server actions §29 |
| Password hashing with params in the hash | Built | scrypt `scrypt$N$r$p$digest` §77 |
| **MFA / WebAuthn / risk-based auth** | **Add** | `backend/auth` + device signals |
| Encryption at rest / in transit / field-level | Built | AES-256-GCM §16; TLS at edge (Caddy) |
| Capability URLs from CSPRNG | Built | seller links §13 |
| Rate limiting (fail-open, per-process) | Built | `rateLimit.ts` §76 |
| Webhook signing, raw-byte verify, replay-proof | Built | `webhook.ts` §27 |
| Audit trail append-only | Built | §17 |
| CSP, security headers (HSTS, XFO, nosniff) | Built | confirmed live on lodeprop.com |
| KYC/KYB, AML, PEP/sanctions | Port built, adapter pending | `screening.ts` §80 |
| Seller due diligence (who/may-sell/beneficial owner) | Built | `sellerDueDiligence.ts` §67 |
| Fraud: transaction + behaviour + device scoring | **Add (agent)** | fraud agent → rules/human block |
| Anti-hacking (DDoS/SQLi/XSS/CSRF/ATO/cred-stuffing/bot/API abuse) | Framework-level | parameterised store, React escaping, CSRF tokens, WAF/Cloudflare at edge, API rate tiers |
| AI governance (behaviour/instructions/permissions/policy) | Built as structure | `prohibitions.ts` register + closed effect set §69 |
| Data protection / GDPR / DSAR | Partial | audit export; add erasure workflow (respecting append-only audit of the fact) |

Secrets are never logged, never returned, never in a redirect path. The
`DATA_ENCRYPTION_KEY` cannot be rotated after live data is encrypted — a
documented operational constraint, not a bug.

---

## 14. Admin Super Control Centre

Extend `/operator` (already the deny-by-default suite) into a single cockpit
with full, permission-checked visibility and **governed** control:

- **Users / businesses / tenants** — grades, certifications, `can()` state.
- **Transactions / payments / settlements / disputes** — from the ledger, the
  only recorded path for a manual adjustment (named author, reason, ceiling §32).
- **APIs / webhooks / merchants** — keys, delivery health, replay.
- **Agents & automations** — every `agent_run` and `agent_decision`, the AI
  Governance surface: who decided what, on what evidence (§51, §53).
- **Compliance** — screening outcomes (`method` never lies §80), prohibitions
  register with live call-sites (§42, §69), outreach suppression.
- **Revenue / CLV / churn** — read models, advisory.
- **System health / logs / alerts** — observability; self-managing infra
  actions shown with their audit, each reversible.
- **Disaster recovery / business continuity** — documented runbook
  (`GO-LIVE.md` pattern): RPO/RTO, Postgres PITR backups, failover, the
  single-unit redeploy, and the rule that the file store is dev-only (§15).

Everything an operator can do remains individually permission-checked; the
cockpit is a view, not a bypass.

---

## 15. Developer build roadmap

| Phase | Theme | New modules | Connectors (adapters) | Agents | Commercial objective |
|---|---|---|---|---|---|
| **MVP (now → live)** | Deal OS live | *(all built; live at lodeprop.com)* | EPC (live), email | The nine §12 | First completed deals |
| **Phase 1 — Money + Trust** | Make revenue + compliance real | BitriPay gateway, Developer centre, Admin cockpit v2 | **BitriPay**, **KYC/AML (Sumsub/ComplyAdvantage)**, Stripe live keys, Connect payouts | Payment, Fraud, Compliance, Revenue, Onboarding, Ops, Data Intelligence | Charge, settle, pay out; pass AML; first ARR |
| **Phase 2 — Command Centres** | Agentic cockpits per user | Seller/Buyer/Lender/Operator Command Centres, AI credits | AI model edge (Anthropic default), SMS/WhatsApp, maps, HMLR | Growth, Support, Marketing, Predictive, API Integration, Research | Activation, retention, ACU revenue |
| **Phase 3 — Enterprise** | Multi-tenant + white-label | Tenants, white-label theming, SSO/SCIM, audit export | BaaS/Open Banking, CRM, accounting/tax, e-sign, R2/S3 | Executive briefs, Infra self-managing | White-label licensing, enterprise plans |
| **Phase 4 — Global scale** | Jurisdiction + scale | New `jurisdictions/`, data warehouse graduation, knowledge graph | Currency, regional KYC/payments | Full workforce, decision intelligence | Multi-market, data-intelligence revenue |

Each phase keeps the suite green: `npx tsc --noEmit`, `npx vitest run` (against a
real Postgres, §55), `npx next build`, `npm run preflight`, and the affected
routes verified to render (§Test-what-you-change).

---

## 16. Competitive advantage

1. **Governed autonomy.** Competitors are manual-but-trusted or
   automated-but-ungovernable. Lode is automated analysis with accountable
   decisions — the only posture a regulator, a funder and a seller can all
   accept. This is the moat, and it is structural, not marketing.
2. **Show-your-working by default.** Every figure carries reasoning, confidence,
   evidence used and missing. That is a product feature and an audit defence at
   once, and it is extremely hard to retrofit into a competitor.
3. **Compounding deal data.** Outcomes feed the intelligence layer; matching,
   forecasting and grading sharpen with every deal. New entrants start from
   zero corpus.
4. **One source of truth.** Score, memorandum and seller options cannot
   disagree — the single-source rule (`director.ts`) removes the contradictions
   that sink multi-screen PropTech.
5. **Provider-agnostic rails.** BitriPay first-class, but ports-and-adapters
   means payments, KYC, AI and land data are swappable — no single-vendor
   hostage situation.
6. **Lawful by construction.** The outreach spine, the reveal gates, the fee
   engine and the regulatory router make the compliant path the only path. That
   converts regulation from a cost into a barrier to entry.

---

## 17. How to read and build from this

- This document is a **map onto existing seams**, not a greenfield spec. Start
  every item by reading the cited file.
- The autonomy boundary (§0) is load-bearing. Any proposal to let an agent
  decide, move money, or self-modify the engines is out of scope by
  construction and requires a reviewed architectural decision, not a feature
  flag.
- Honour the house rules: money in integer pence; engines deterministic; LLMs
  at the edges; permissions decided in one place; audit append-only; no client
  amounts; no fake figures; no new design primitives.
- Build vertically, one finished capability at a time (§Build vertically).
  Phase 1's BitriPay adapter is the recommended first move: highest commercial
  value, cleanest existing seam, fully testable against the contract suite.

---

## 18. Communication event architecture

One event engine fans every notification out across channels — the pattern a
sibling product (VERYX) already proves. Lode adopts the shape and **rejects two
of its defaults**, because Lode contacts consumers and individual property
owners, not signed-in enterprise staff, and the law is different for that
audience.

### 18.1 The two rules that make it lawful

1. **Lawful basis per event, not a "mandatory" flag.** VERYX marks 27 notices
   as bypassing opt-outs. For Lode that is replaced by a required
   `lawfulBasis` on every catalogue event:

   | Class | Lawful basis | Opt-out behaviour | Examples |
   |---|---|---|---|
   | **Service / transactional** | Contract / legitimate interest; PECR permits to the person who transacted | Sent regardless of *marketing* preference; still stops on erasure | payment receipt, reveal confirmation, completion milestone, document request |
   | **Security / legal** | Legal obligation / vital account interest | Always delivered to the account holder; cannot be marketing-suppressed | password changed, new-device sign-in, account locked, consent request, data-export ready |
   | **Marketing** | **Recorded consent only (double opt-in, §10)** | Honours every opt-out and suppression; carries unsubscribe + sender identity | newsletter, new-opportunity digest, re-engagement |

   There is no fourth class and nothing "bypasses opt-out" — a security message
   is lawful because of its basis, not because a flag overrides the person's
   wishes. The type carries the basis, so a marketing event **cannot** be
   emitted on a service pretext (mirrors the closed-effect-set discipline of
   §12).

2. **A complaint or opt-out always wins (§44).** Suppression precedence is
   absolute for marketing and respected everywhere else: `suppressions`
   (keyed by address/mailbox, already built for outreach) is checked at the
   moment of send, after rendering, every time. A "this is spam" reply
   suppresses immediately, no threshold, no review.

### 18.2 Channel legality — this is where products get fined

| Channel | Who | Lawful without consent? | Lode disposition |
|---|---|---|---|
| **In-app inbox** | any signed-in user | yes (pull surface, not a send) | **Phase 1** — every event lands here |
| **Email** | transacting party | service/security yes; marketing needs consent | **Phase 1** — reuse newsletter/outreach transport |
| **SMS** | individual | **PECR reg. 22 — generally no** | **Phase 2, transactional-only** to the account holder's own verified number (OTP, security, payment-failed). Never marketing to an individual. |
| **Push** | device opted-in | device permission is the consent | **Phase 2** |
| **WhatsApp** | individual | opt-in + approved templates only | **Phase 3**, service templates only |

The engine refuses to place a marketing event on SMS/WhatsApp to an individual
— the same `channelFor()` / PECR logic that already governs seller outreach
(`owners.ts`, `outreach.ts`). Business recipients and consented contacts are a
separate, wider path.

### 18.3 The engine

```
domain action (deterministic engine or named decision)
   └─ emit(event, subjectRef)                      // never from an LLM; §50
        └─ resolve recipients  ── consents + suppressions per channel (18.1/18.2)
             └─ render template ── branded from identity.ts (§56); figures from engines (§59)
                  └─ dispatch   ── provider adapter (email/SMS/push), ports+adapters (§8)
                       └─ record ── delivery event → append-only audit (§17)
                            └─ in-app inbox read model (per §8 intelligence layer)
```

- **Frequency caps + quiet hours** reuse `campaign.ts` (business-hours window,
  frequency caps) so a user is never flooded and nothing marketing-class sends
  outside permitted hours.
- **Deterministic routing.** The engine decides *which channels are lawful and
  wired*; it never decides a score or clears a flag. An LLM may *draft* a
  template's prose (a §50 edge) but never sends and never alters a figure.
- **Sandbox when no provider key** (mirrors `screening.ts` §80 and billing):
  with no email/SMS provider configured, the event is recorded as
  `sandbox`/`logged`, so the whole flow is testable before keys exist —
  exactly VERYX's "recorded in sandbox so the flow is always testable".
- **Template QA**: preview the branded render and fire any event to yourself
  across its lawful channels, from an operator surface.

### 18.4 Lode's event catalogue (not VERYX's 177)

Grounded in Lode's real lifecycle and seams. Categories, with class in
brackets:

| Category | Representative events | Class |
|---|---|---|
| Identity & account | registration requested/received, email/mobile verification, verified, locked/unlocked | service / security |
| Login & security | new-device, suspicious login, password changed/reset, MFA enabled/disabled, session revoked | security (always delivered) |
| Seller journey | intake received, position ready, route selected, seller-due-diligence docs requested, material-information gap | service |
| Buyer journey | passport graded, reveal available/confirmed, opportunity matched, certification lapsing | service + (digest = marketing) |
| Funding | readiness scored, mandate matched, introduction made (regulatory-cleared), offer comparison ready | service |
| Outreach | neutral enquiry sent, reply classified, suppression added, stage-two/three consent needed | service (governed by §43/§44) |
| Billing | payment pending/successful/failed, refund processed, invoice/receipt, card expiring, chargeback opened | service (payment-failed → SMS allowed) |
| Payouts | payout held (14-day), recipient verification needed/lapsed, payout sent/failed | service / security |
| Screening & compliance | check inconclusive (no provider §80), manual check recorded, sanctions/PEP hit → operator | security / operator |
| Platform & legal | maintenance/outage, consent request, data-export ready, account-deletion requested/completed | security / legal |
| Agents (§12) | proposal raised, decision recorded, dormancy finding, human intervention required | service / operator |
| Marketing | newsletter, opportunity digest, re-engagement | **marketing (double opt-in only)** |

Each event declares: `key`, human title, `lawfulBasis`, default channels (from
the legality matrix), severity, and a template id. Mandatory service/security
events are delivered to the account holder; **nothing marketing-class is ever
auto-enrolled or sent against an opt-out** — the single rule a sibling
enterprise tool does not need and Lode cannot live without.

### 18.5 Schema delta

```
notification_events   (code catalogue — static, versioned; not a table that users write)
notifications         id, event_key, recipient_ref, channel, lawful_basis,
                      template_id, status(queued|sent|logged|sandbox|failed|suppressed),
                      dedupe_key (unique), rendered_subject, created_at, delivered_at
                      idx: unique(dedupe_key), (recipient_ref, created_at)
consents              (extend §10) recipient_ref, channel, scope(marketing|…), granted_at, source
suppressions          (EXISTS) address/mailbox keyed; checked at send (§44)
inbox_items           id, recipient_ref, notification_id→, read_at, created_at (read model)
```

Every send carries a `dedupe_key` the store holds unique, so a retried emit
cannot double-send (the §24 money discipline, applied to messages). Delivery
rows are append-only audit; the in-app inbox is a read model built from them.

---

*Every figure and example in this document is illustrative of mechanism. The
running platform computes its numbers from the engines, under audit, with their
reasoning — which is the whole point.*
