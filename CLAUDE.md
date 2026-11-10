# Operating directive — Lode

Standing rules for any agent working in this repository. These are not
suggestions. Read this file and `docs/ARCHITECTURE.md` before changing code.

**Priority: UNDERSTAND → INSPECT → REUSE → PLAN → IMPLEMENT → VERIFY → STABILISE → MOVE FORWARD.**

Core equation: maximum forward progress + minimum rework + zero unnecessary
repetition + zero regressions + production-grade stability.

---

## Part 1 — Platform memory

Answer "what already exists?" from here, not by re-deriving it.

### Architecture

| Layer | Where | Rule |
|---|---|---|
| Frontend | `src/app` | Renders. **Never computes a figure.** Next requires this path. |
| Shared UI | `src/app/components/chrome.tsx` | Mark, header, verdict vocabulary, score colours |
| Backend | `src/backend` | Server only: `store/`, `auth/`, `sources/`, email, audit. |
| Store | `src/backend/store/` | `repository` picks the engine; `postgresStore` or `fileStore`. No domain logic. |
| Domain | `src/domain` | Pure, framework-free, fully tested |
| Money | `src/shared/money.ts` | Integer pence, branded types. Depends on nothing. |
| Formatting | `src/shared/format.ts` | Pure. Imported by domain — **no Tailwind here.** |

Stack: Next.js 15 (App Router, server components), React 19, TypeScript strict,
Tailwind v4, Vitest. No auth, no database, no payments, no external APIs.

**Dependency rule:** arrows point downward only. `src/domain` imports nothing
from `src/app` or `src/store`.

**Single-source rule:** `runDealDirector()` returns one coherent position and
the page renders it. This is why the score, the memorandum and the
seller-facing options cannot disagree.

### Built and working — do not rebuild

`src/shared/domain/` (37 files): `types`, `newsletter`, `economics`, `motivation`, `protection`,
`redteam`, `dealScore`, `capitalStack`, `strategies`, `goldmine`, `matching`,
`completion`, `revenue`, `director`, `intake`, `sellerRoutes`, `workingDeal`,
`partners`, `sources`, `registrySignal`, `accounts`, `blog`, `analytics`, `seo`,
`pricing`, `entitlements`, `ledger`, `charging`, `borrowing`, `fundingMetrics`,
`negotiation`, `campaign`, `offers`, `agents`, `appraisalRequest`, `identity`,
`supply`, `permissions`, `fees`,
`fundingReadiness`, `regulatoryRoute`, `outreach`, `inventory`, `reveal`,
`passport`, `opportunityScore`, `prohibitions`, `materialInformation`, `sellerDueDiligence`, `workflow`, `payouts`, `portfolio`, `screening`,
`qualification`, `intakeConversation`, `reservation`, `agentRun`, `dealTransition`, `operatorTask`, `marketWatch`, `dealHunt`,
`comparableBundle`, `dealHuntRun`, `dealHuntBrief`, `dealHuntHandoff`, `evidenceClaim`,
`decisionOutput`, `decisionSnapshot`, `comparison`, `watchCursor`, `floorplan`, `auction`,
`sourcerWalkthrough`, `propertyResolution`, `sendReconciliation`.

`src/shared/domain/trend/` (Trend Intelligence, spec-adapted into this stack):
`scoring`, `brief`, `sources`, `action`.

`src/shared/domain/jurisdictions/`: `types`, `index`, `profitTax`, `gb-eng`, `gb-sct`,
`us-gen` (GB-NIR and GB-WLS derive from gb-eng in `index`; both US-GEN and
GB-WLS are excluded from `isDealReady`).

Pages: `/` landing, `/appraise` free no-signup appraisal, `/partners` agents,
professionals and capital, `/sell` intake, `/sell/[id]` seller options, `/deals`
pipeline, `/deals/[id]` Deal Room, `/deals/[id]/agents` agent board,
`/deals/[id]/memorandum` print pack, `/sell/chat` (+ `/[id]`) conversational
intake, `/operator/intake` (+ `/[id]`) the seller-chat review queue,
`/invest` Buy Boxes, `/capital` Funding Boxes, `/opportunities` (+ `/[id]`) the
marketplace, `/account/passport` buyer readiness, `/operator/conduct` the
prohibitions register, `/operator/agents` the agent-run Control Room,
`/newsletter` (+ confirm, unsubscribe), `/operator`
sign-in.
Access control: `src/middleware.ts` gates `/deals`, `/invest`, `/capital`,
`/account` behind either credential and fails closed without `OPERATOR_SECRET`.
`src/app/operator/guard.ts` is the per-page lock; `src/shared/domain/accounts.ts`
`can()` is the only place a permission decision is made.
API: `/api/cron/newsletter` weekly send, secret-protected and idempotent.
PWA: installable, `src/shared/pwa.ts` is the single source for devices/icons/colours,
and a test pins those colours to the `globals.css` tokens — a splash that
disagrees with the app by a shade looks like a crash and restart. Safe-area
insets are consumed by `.app-header` and `.app-safe-bottom` in `globals.css`;
without them the installed app runs under the notch and the home indicator,
which is the giveaway that it is a website in a shell.
Assets regenerate with `npm run pwa:assets` — never hand-edit `public/`.
Go-live: `docs/GO-LIVE.md` is the runbook; `npm run preflight` is the gate and
exits non-zero on blockers, `npm run verify` runs the whole sequence, and
`.github/workflows/ci.yml` runs it on every push with a Postgres service.
`/api/health` is the platform health check. One deployed unit, not three:
`shared` runs on both sides and is the only layer in the browser bundle,
`backend` is server-only and a client component importing it fails
`tests/boundaries.test.ts`. `output: "standalone"` plus the `Dockerfile` covers
any host that is not Vercel; only `NEXT_PUBLIC_*` may be a build argument.
Go-to-market: `docs/GO-TO-MARKET.md` is the source; `npm run docs:pdf`
renders `docs/GO-TO-MARKET.pdf` — never edit the PDF by hand.
Money: `pricing.ts` owns every price, plan limit and tax decision — nothing else
may state one, and `revenue.ts` derives its published tiers from it.
`ledger.ts` holds prepaid balance as lots; `entitlements.ts` derives what a plan
grants; `charging.ts` decides whether a charge may happen. `/api/billing/webhook`
is the only inbound money path and fails closed without `BILLING_WEBHOOK_SECRET`.
`/operator/billing` shows every account's position, computed from the ledger, and
is the only recorded path for a manual adjustment. `meter()` in
`src/backend/billing/meter.ts` charges the memorandum per period;
`/api/cron/billing` expires lapsed balance nightly.
Funding: `docs/PAF-OS.md` maps the Priority Acquisition Funding specification
against what exists. `borrowing.ts` gives the true cost of a facility and the net
advance; `fundingMetrics.ts` the ratios a funder decides on; `fundingReadiness.ts`
the 0-100 pack score; `regulatoryRoute.ts` whether an introduction may be made;
`outreach.ts` whether contacting somebody would be lawful. Surfaced at
`/deals/[id]/funding`. Discovery lives in `src/backend/discovery/`: `robots.ts`
parses and obeys robots.txt, `fetcher.ts` is the ONLY outbound path and gates
every request, `extract.ts` has no inference path, `connectors.ts` reads the
three licensed sources. Price Paid is read two ways: `sources/pricePaid.ts`
`fetchSales()` prefers the bulk store and falls back to the Land Registry
linked-data endpoint per postcode (that endpoint is far sparser than the
published file, so an unloaded area returns almost nothing); the dense set is
loaded by `scripts/load-price-paid.ts` (`npm run load:price-paid <file>`), which
streams the Open Government Licence bulk CSV, keeps the launch region
(`sources/pricePaidBulk.ts` `DEFAULT_LOAD_AREAS` = B/CV/DY/WS/WV), and upserts
into the store by transaction id (`savePricePaidSales`/`listPricePaidSales`,
both engines). Candidates are quarantined at `/operator/discovery`; outreach is drafted,
approved and sent at `/operator/outreach` through the newsletter's transport,
re-checked against the suppression list at the moment of sending. Replies arrive
at `POST /api/outreach/reply`, delivery events at `POST /api/outreach/events`;
`/outreach/opt-out` is one click and needs no account. `campaign.ts` holds the
business-hours window and the frequency caps; `POST /api/cron/outreach` sends
what was approved. Stages two and three are in `src/backend/outreach/stages.ts`
and open at `/dataroom/[token]`. Customers buy at `/account/billing` through
`POST /api/billing/checkout` and `src/backend/billing/provider.ts`.
Agents: §12's nine agents are in `agents.ts` — a trigger, an observer over the
existing engines, and a proposal a named person decides on. No model, no
autonomy. `runAgents()` returns a proposal or a dormancy reason for each of the
nine; `src/backend/agents/service.ts` assembles the context and applies a
decision; `/deals/[id]/agents` is the board. The §12 prohibitions are structural
— four effects and no fifth, `EFFECT_OWNERS` gives the one writing effect to one
agent, and `authoriseDecision()` refuses the shared operator password. Accepting
a Terms proposal is what wakes the Due-Diligence Agent.

Intake assistant: §12's conversational first contact. `qualification.ts`
`reviewQualification()` is the deterministic gate — the LLM proposes facts, a
draft and an action; this drops any fact citing a message id we do not hold,
coerces the action to a known enum, scans the draft for a prohibited claim or
an injection, and sets `safeToAutoReply` only for a clean ask/answer. The model
seam is `backend/intakeAssistant.ts` (`qualifyIntake`), which fails closed to
human review on no key, an error, or non-JSON. `backend/intake/service.ts`
advances a conversation: it appends the assistant's reply ONLY when the gate
says safe, otherwise the conversation is `needs-review` and nothing is said to
the seller. Public surface `/sell/chat`, review queue `/operator/intake`
(`view-seller-data`, a named operator replies/closes). Stored as
`intakeConversation`s; message text is sealed at rest like `seller.narrative`.
A06 lives here too: an enquiry has no established buyer, so `sell`/`sourcing`
set `DealInputs.buyerProfileUnknown` and the appraisal is `taxPending` with
worst-case transfer tax (never understated).

Agent-run ledger: `agentRun.ts` is the pure durable record (spec §20.5) every
agent execution maps into — the live analysis runtime, the intake qualification
seam and the deterministic observers — with one lifecycle state machine whose
transitions are guarded so a finished run is never silently rewritten and a
newer run supersedes an older one but cannot touch one that already ended. The
store persists it append-and-upsert in both engines (`agent_runs`), read by
subject. Two producers record runs today: the intake qualification seam (every
seller turn) and the live analysis runtime (`/deals/[id]/analysis`); the
operator Control Room reads the ledger at `/operator/agents` (`view-audit-log`).
AG05: the intake conversation carries a `rev` (input version); a qualification
run writes back by compare-and-swap, and if a newer turn landed while it was in
flight the write is refused, the run is `supersede()`d in the ledger and the
reply is re-run over the current state — a stale result never overwrites newer
state and no turn is lost. The run is left open through `advance` and closed by
the caller (to its outcome, or superseded), because a run is not "succeeded"
until its result was actually applied.
Kill switch (§20.8): `agentControls.ts` + the `AGENTS_PAUSED` env (read by
`backend/agentControls.ts`) pause the model-backed agents — "all" or a list of
kinds. A paused kind does not call the model: the live analysis runtime refuses
without charging, intake holds the seller for a person, and the would-be run is
recorded `cancelled` with reason `agents-paused`, so the pause is visible in the
ledger and shown on `/operator/agents` rather than silent. Env-driven and
surfaced read-only, the same posture as every other runtime toggle (there is no
writable settings store); deterministic observers are never pauseable.
AG09/§20.11: the live runtime captures the provider's token usage per turn and
enforces a per-run token budget (`RUNTIME_MAX_INPUT_TOKENS`/`_OUTPUT_TOKENS`),
stopping before the next provider call once spent — a bounded stop recorded
`awaiting-human` with `token-budget-exhausted`, distinct from the step-limit
stop. The run records `modelCalls`/`inputTokens`/`outputTokens`, shown on the
Control Room. §20.12: a run that ends `awaiting-human`/`awaiting-data` sits on
the operator queue until a named person acknowledges it — `acknowledgeRun()`
records who/when/note (first acknowledgement stands; only a waiting run can be
acknowledged), `acknowledgeAgentRun()` is the backend decision (named account +
reason, shared password refused, audited `agent-run-acknowledged`), and the
Control Room's "waiting" count is `needsAttention` (waiting and not yet
acknowledged). No work queue, no tenant dimension (single-tenant) — only what a
real producer can fill, never empty forward-compatibility.

Market Watch + Deal Hunt foundation: `marketWatch.ts` is the pure listing
price/status *history* model (distinct from `listingData.ts`, which is a signal
*snapshot*) — `ListingObservationRecord`s, `deriveEvents()` (price moves and
status transitions, deterministic), and `matchReturnedAndReduced()`, the §3
matcher both features sit on: did a property return to market from under-offer/
sold-STC within the window and is it still below the last *ordinary asking*
price before it went under offer (POA/guide are not a baseline; a cut before
under-offer or a later rise does not count; confirmed fall-through needs source
evidence, else reason-unverified and a strict query excludes it). `dealHunt.ts`
is the §2 criteria contract + `validateCriteria()` (geography and price ceiling
required, defaults applied visibly, contradictions blocked) + `withinPriceCeiling`.
Pure and provider-independent — the matcher and fixtures first, per the Deal Hunt
build order. Licensed ingestion is provider-gated (fixture adapter for dev).

Deal Hunt + Independent Engine (now built end to end, provider-gated): on the §3
matcher sit the persistence and workflow. `comparableBundle.ts` assembles sold
(via `comparables.ts`) and rental evidence — advertised vs agreed kept entirely
separate, normalised to £/month, widen-once, thin flags, dedup; no feed →
rent_unavailable. `dealHuntRun.ts` holds DealHuntQuery (immutable revisions),
DealHuntRun (lifecycle; terminal is terminal) and DealHuntResult (the §3
eligibility proof + provenance + stale), with `rankResults` (§3.6). The
deterministic worker `backend/dealHunt/worker.ts` (`evaluateHunt` + `runDealHuntJob`)
runs the matcher, filters by ceiling/type/beds, merges one property on two feeds
(DH09), excludes ambiguous identity (DH05), ranks, caps, enriches and persists —
`EMPTY_SOURCES` by default so a clean core returns an explicit zero-match
boundary (IND01/IND02), `DEAL_HUNT_FIXTURES=1` enables a staff-pilot set. A
listing-feed outage is a retryable failure; a comparable outage is partial (DH11).
`dealHuntBrief.ts` deterministically interprets a brief into editable filters
(DH01/DH02/DH14 — injected instructions change nothing). `backend/dealHunt/service.ts`
+ `/operator/hunts` (staff pilot console) + `/operator/hunts/[id]` run and show
hunts; `dealHuntHandoff.ts` carries a result into an appraisal draft — idempotent
(DH15), entitlement re-checked at transfer (DH13), stale/unavailable flagged
(DH07). `evidenceClaim.ts` is the sourced-assertion spine (four confidence
classes; a missing fact is recorded as missing). `decisionOutput.ts` is the §3
four-field output + headroom (IND09); `decisionSnapshot.ts` the versioned,
permission- and gate-rechecked, expiring, revocable (IND14) snapshot;
`comparison.ts` Compare-and-Decide across ≤4 under one shared assumption set with
overrides visible (IND08); `watchCursor.ts` saved watches that alert once per
watch/property/episode (IND13). `floorplan.ts` keeps an unscaled plan a
hypothesis with no fabricated dimensions (IND10); `auction.ts` keeps a lot's
availability unverified until confirmed and counts only confirmed charges (IND11).
Every one of these is reachable from the running app with a live producer (no
inert engines): the worker produces EvidenceClaims (missing facts recorded as
missing; a changed value supersedes via a new revision) and the §3 decision is
rendered per result; "Save decision snapshot", "Compare selected" (→ ComparisonRun
+ `/operator/hunts/compare/[id]`), "Watch this search" and "Run now" (→ watch
alerts) are all live controls; `/operator/specialist` records and assesses
floorplan hypotheses and auction lots. Store entities (both engines, contract-
tested): DealHuntQuery/Run/Result, ComparableBundle, EvidenceClaim,
DecisionSnapshot, ComparisonRun, WatchCursor, LayoutHypothesis, AuctionLot.
Both surfaces are built from one set of shared views (`components/hunt/`) and one
read path (`backend/dealHunt/read.ts loadHuntDetail`) so they cannot drift: the
operator console (`/operator/hunts`) and the investor surface (`/invest/hunts`
+ `/[id]` + `/compare/[id]`), the latter page-guarded by
`requireMandateManagement` and scoped to the investor's own account (a hunt it
does not own is notFound unless it manages all mandates). The shared actions
admit operator or investor, attribute to the named account, and validate their
redirect `base` to an allowlist. Data is gated at the SOURCE, never the UI: with
no licensed feed the matcher returns a zero-match with its coverage boundary, and
`DEAL_HUNT_FIXTURES=1` drives a synthetic pilot set — a deployment decision, not a
half-built screen.

Operator worklist (§9/A03): `operatorTask.ts` is the pure record — a follow-up
a named person owns (`openTask`/`resolveTask`, first resolution stands, dedupe
key is subject+type). `backend/tasks.ts` `raiseTask()` is idempotent on that key
(a recipient replying twice opens one task, not a pile) and `resolveOperatorTask()`
is a named person taking it off the queue, audited `operator-task-resolved`.
Persisted both engines (`operator_tasks`). The producer today is an inbound
outreach reply (`handleReply` raises one when a genuine reply — not an opt-out —
stops the automated sends), read and resolved at `/operator/tasks`. NOT an
automated marketing nurture sequence: decision #10 and §9 forbid auto-enrolling
sellers, so this is the operator follow-up half of §9, not a scheduler that
writes to people.

Deal lifecycle (§10): `dealTransition.ts` is the pure guard on recording a
`DealStatus` change — status is a fact the workflow derives from (decision #68),
and this refuses to record one the evidence does not support. Ordering
(new → qualified → in-market → funded → completed; withdraw from any live
status; completed/withdrawn terminal) plus per-step evidence gates derived from
the same `WorkflowFacts` (`dealWorkflowFacts` in `backend/workflow.ts`, shared
with `positionOf`). `transitionDeal()` is the one guarded path status changes
after creation: it writes `status` (and `completedAt`, atomically, on
completion) and audits `deal-transitioned`. A16: completion needs a conveyancer
instructed and a date, so "mark it done" cannot record `completed` — and the
completion fee (`fees.ts` dueAt) stays unraisable — on a deal that has not
completed. Surfaced on the Deal Room (`AdvanceDeal`, a named operator, #29).

Flipper/sourcer reservation: a property is "taken" by paying to reveal it.
`reservation.ts` is the pure lock — up to `FLIPPER_SLOTS` (5) holders share one
pool, each hold lasting `FLIPPER_HOLD_DAYS` (14); a holder's accepted offer
(deal funded/completed) locks every other holder out; investors/buyers are a
separate channel, never blocked by holds and open until the buying stage
(a conveyancer instructed, `evidence.solicitorInstructed`). `isHolderKind()`
names who counts toward the pool: a flipper (a buyer on a refurbishment mandate,
`revealerKindFor` reads their active Buy Boxes) and a sourcer (a reseller/
sub-agent with recorded `sourcerCompliance`) both hold; an investor never does.
`RevealRecord.revealerKind` records which a reveal was, so it counts (or not) as
a hold. Enforced as a reveal blocker in `billing/reveal.ts` on the
single-opportunity path (`quoteRevealForDeal` → `openOpportunity`); the browse
list skips it for cost, since the charge is single-deal. A reveal that the lock
refuses is not charged (decision #62). Not count-atomic — the soft five-slot cap
can briefly over-allocate under a race; the hard, stage-driven lock cannot.
Sourcer/flipper walkthrough: `sourcerWalkthrough.ts` hangs the operational and
compliance half of a deal on the same twelve `workflow.ts` stages — the actions,
scripts and obligations (AML/redress, EAA s.18, PECR, CDD timing, SDLT) a sourcer
follows from first sighting to getting paid, plus the one-time prerequisites and
the off-path exceptions. Pure and figure-free: it states method and obligation,
every number stays the engine's (`jurisdictions`, `negotiation`, `director`,
`fees`). `sourcerWalkthrough(position)` projects a deal's live `workflowPosition`
into done/current/upcoming — reached because the evidence exists, never ticked.
Surfaced account-facing at `/account/playbook` (AccountNav "Playbook"), live for
every deal the account holds as a sourcer or flipper (its holder reveals), with
the one-time readiness and the full stage reference shown regardless.

Acquisition: `negotiation.ts` computes the price band — opening, target,
walk-away, floor — and `respondTo()` never counters past the ceiling. Seller
Protection runs first and a block means no position at all. Owners come from
`src/backend/discovery/owners.ts`: one title at a time, licensed, refused without
a deal id and a named requester; `channelFor()` sends an individual to post
because PECR reg. 22 has no workaround. The letter channel runs through the same
outreach spine: `outreach.ts` eligibility is channel-aware, `outreach/letter.ts`
posts through a provider or queues for printing, and suppression matches by
`postalKey()` as well as by mailbox. Surfaced at `/deals/[id]/negotiation`.
Analytics: Meta Pixel and Google Tag load from `src/app/components/Analytics.tsx`
only, gated on a configured ID, granted consent, an allowlisted route and a known
event. `src/shared/domain/analytics.ts` decides where and what; `src/shared/consent.ts`
decides whether; `src/shared/eventQueue.ts` holds events until the vendor scripts
exist. Blog opens are counted independently at `POST /api/blog/view` and shown
with the SEO audit (`src/shared/domain/seo.ts`) at `/operator/blog`.

Trend Intelligence (the §-numbered "Trend Intelligence AI" spec, adapted into
this TypeScript stack rather than the spec's separate Python service —
keyless, deterministic core first). `trend/scoring.ts` is §5: `detectMovement`
(lift/robust-z, count+anomaly gates, demand = clamp(50+10z,0,100)), the weighted
opportunity score, the independently-computed confidence with the single-source-
family cap at 69, and the decision gate (archive/watch/brief/auto). Scores stay
full precision — the gate is taken on 86.25/83.5, never rounded (TI-03) — and a
veto (out-of-market, unsupported claim, restricted topic, unavailable inventory,
illegal targeting, missing readiness) blocks the brief without lowering the
number. `trend/brief.ts` is the §6/Appendix-A Growth Brief: a closed object,
hand-rolled validation strict both ways (a missing required field fails and so
does an unexpected extra one), and `resolveEffectiveBrief` falls back to baseline
on an expired/out-of-scope/wrong-channel brief, so a cached brief never
authorises a stale write (TI-05). `trend/sources.ts` is the §3 registry: access
paths (public_keyless/host_mediated/file_import — keyless or unavailable, never
prompted for a key, TI-20/TI-22), replay/conflict reconciliation on a unique
tenant-scoped source-version key (TI-01), and syndication-collapsed independent-
family counting (TI-04). `trend/action.ts` is §18 write safety: typed allowlisted
actions (TI-06), approval bound to the canonical payload hash + target revision
(an edit breaks the binding), derived idempotency keys (TI-09), the execution
re-guard and rollback-matches-applied-revision (TI-05/TI-08). Surfaced
deterministically at `/operator/trends` (view-audit-log): the producer in
`backend/trend/service.ts` runs the engine over an installation's observations
and yields scored opportunities and validated Growth Brief drafts — EMPTY by
default (honest coverage boundary), `TREND_FIXTURES=1` for a clearly-synthetic
staff pilot, the same posture as Deal Hunt. No model is called. Still to build:
the /v1 API surface + persistence (RLS/multi-tenant is a decision, not yet taken),
the native owned-surface renderer + measurement, experiments and the commercial
control plane.

1867 tests in `tests/` (≈1960 with a live Postgres running both store engines). All pass. Build succeeds. All routes return 200.

### Decisions already made — respect them

1. **Money is integer pence behind a branded type.** Never floats.
2. **Deal Score is computed AFTER profit tax.** Never expose a pre-tax score.
3. **Seller Protection can block.** A block caps the score at 35, forces
   `reject`, and fails a hard criterion in every match. Never downgrade a block
   to a warning.
4. **All country-specific law lives in `jurisdictions/`.** Nothing outside may
   hardcode SDLT, "solicitor", or any England-shaped assumption.
5. **Unknown jurisdiction ruling defaults to `not-supported`**, never
   `permitted`.
6. **Every score, match and rejection carries its reasoning.** No bare numbers.
7. **Red Team stresses are tiered** (`single` vs `compound`). Only
   single-factor losses cap the score.
8. **Absent screening answers mean more caution, never less.**
9. **Revenue streams are permission-gated.** `dealRevenue()` excludes any
   stream whose permission is not held.
10. **Marketing email requires recorded consent.** Double opt-in only; never
    enrol sellers; every message carries unsubscribe and sender identity; the
    cron endpoint fails closed without `CRON_SECRET`.
11. **PWA splash is flat, not gradient.** A smooth gradient at 2732px cannot be
    PNG-compressed and made the asset set 9.1MB instead of 690kB.
12. **The service worker caches nothing data-bearing.** Pages render live
    figures; a cache-first worker would serve a stale Deal Score as current.
13. **Operator surfaces are deny-by-default, twice.** The gate lives in
    middleware and every operator page also calls `requireOperator()`, because
    Next has shipped middleware-bypass advisories more than once. It fails
    closed without `OPERATOR_SECRET`. Seller
    links are capability URLs from a CSPRNG — never derived from guessable
    facts about the property.
14. **No data source may be read without a recorded licence.**
    `assertSourceUsable()` throws at ingestion, not at display — the exposure is
    created by taking the data. Portal listings stay in the registry, refused,
    with the reason written down. Never scrape.
15. **`DATABASE_URL` decides the store, nothing else.** Set means Postgres;
    unset means the JSON file, which is a development convenience and is wrong
    on any host that runs more than one instance. Both engines pass the same
    contract suite.
16. **Deal material needs a current certification, never just a login.**
    `can()` decides; twelve months and it lapses. Investors and funders never
    hold `view-seller-data` at any point.
17. **The audit trail is append-only.** No update, no delete, anywhere.
18. **Blog figures come from the engine, links are computed.** The drafter is
    the only LLM seam and it never touches a number. No hardcoded internal
    hrefs — a renamed slug must not be able to leave a dead link.
19. **`robots.txt` disallows every operator surface.** Third layer behind the
    middleware gate and the per-page guard, never a substitute for either.
20. **No pixel may see a page carrying seller data.** The route allowlist in
    `analytics.ts` is deny-by-default and is re-checked on every navigation.
    Never load a tag outside `Analytics.tsx` and never through Tag Manager —
    the allowlist cannot govern a script it did not load. Events carry counts
    and stages, never the seller's situation, address or postcode.
21. **Blog opens are counted on our own server, not by a pixel.** A count per
    slug and nothing else — no identifier, no per-view row — so it needs no
    consent and survives an ad blocker. Never add a visitor identifier to it,
    and never deduplicate it with device storage.
22. **The SEO score is an audit, not a prediction.** It checks only what this
    codebase controls. Never add a check that claims to know a ranking, a
    backlink or a search volume.
23. **No purchase request carries an amount.** A request names a plan or a pack;
    the price comes from `pricing.ts` on the server. Never add an amount,
    quantity or price field to anything a client sends — a validated amount is
    only as good as the validation, and the failure is silent and total.
24. **Prepaid balance is money, and moves at most once.** Every movement carries
    an idempotency key the store holds unique; spending is an atomic all-or-
    nothing allocation across lots. Never decrement a balance column. A bonus is
    a separate non-refundable lot, so it can never be cashed out.
25. **A chargeback voids the whole lot, spent or not**, and the shortfall shows
    as a debt that blocks spending. Never clamp a reversed position to zero.
26. **Entitlement is derived, never stored.** No `isPro` flag anywhere. Compute
    from the plan, the status and the dates on every request, against a date
    passed in.
27. **The billing webhook is verified over raw bytes, claimed once, allowlisted
    by type, and amount-checked against the catalogue.** All four, always. Never
    parse before verifying — a signature over re-serialised JSON verifies
    nothing.
28. **Under-collecting VAT is our loss, so tax fails closed.** Consumer sales
    outside the UK are refused rather than charged a guessed rate. Never
    "default to UK VAT" for a foreign consumer.
29. **Server actions check their own permission.** They are POST endpoints of
    their own; the page guard does not cover them and the middleware matcher is
    one layer.
30. **A control that nothing calls is not a control.** Before claiming something
    is closed, check it has a live call site. The catalogue, ledger and
    entitlements were all correct and inert for a commit — the memorandum cap,
    metered spending, period allowances and expiry each existed and enforced
    nothing.
31. **Metered use is counted in the ledger, never from the audit trail.** The
    audit write is best-effort and swallows failures by design, so a logging
    blip would hand out an uncapped allowance.
32. **A manual money movement has a named author, a reason and a ceiling.**
    Never the shared operator password — there is nobody behind it to be the
    author. Balance granted by hand is a grant, never a purchase, so it can
    never be refunded out as cash.
33. **A reversal's share is computed per payment, not per lot.** A bonus lot has
    no cash behind it; deciding the share from it alone wiped whole bonuses on
    partial refunds.
34. **A facility is not a cash sum.** Where interest is retained it is deducted
    at drawdown. Derive the sponsor's cash from `netAdvance()`, never from the
    face value of the debt.
35. **Readiness scores recorded evidence, never the absence of a problem.** A
    title with nothing recorded scores zero, not full marks.
36. **Regulatory uncertainty routes to review, never to permitted.** A loan
    secured on a dwelling the borrower occupies is regulated whatever purpose
    was declared.
37. **Nothing is sent to an address a model produced**, and an unknown recipient
    type is treated as an individual. Opt-outs end the question.
38. **Discovery is a licensing question first.** No connector for a source with
    no recorded licence. Guessed email addresses are invention, not collection.
39. **Every discovery request goes through `Fetcher`.** Licence, host allowlist,
    HTTPS without credentials, robots.txt, rate limit, and a 401/403/429 treated
    as an answer. Never add a second outbound path.
40. **A contact detail is extracted or it does not exist.** There is no code
    path that builds one from parts, and there must never be one. A named
    individual's mailbox is recorded as rejected, with the reason, not taken.
41. **Only a VERIFIED candidate may be approved, by a named person.**
    Suppression survives a rerun; approval never overrides it.
42. **Every specification must be reachable from the running app.** A gate with
    no call site stops nothing and a score computed from data nobody can enter
    always says the same thing. Before claiming a spec clause is satisfied,
    follow it from a page or an endpoint to the code.
43. **Each outreach stage discloses more, so each is gated separately.** Stage
    two needs the deal owner's recorded consent and a positive reply; stage
    three needs its own consent scope and a sent teaser. Approval never carries
    forward.
44. **A complaint suppresses immediately, with no threshold and no review.**
    There is no version of "this is spam" that means write again.
45. **The walk-away price is computed, never chosen.** `respondTo()` may accept,
    counter halfway, hold or walk — and must never counter above
    `maxViablePrice()`. An opening offer must leave room below the ceiling; one
    that lands on it has nowhere to go.
46. **An owner lookup carries a deal id, a purpose and a named requester.** There
    is no function taking a postcode and returning owners, and there must never
    be one. A register with no address for service yields no address.
47. **An offer below market value always ships with what the seller gives up for
    it**, including that an agent would likely get them more. Never present the
    price alone.
48. **PECR governs electronic mail, so the gate is channel-aware.** Emailing a
    named individual without consent is unlawful; writing to them is not. A
    letter needs MPS screening, a privacy notice and a recorded
    legitimate-interests assessment, stored on the message so the pre-send
    re-check can see them.
49. **A letter is queued for post, never "sent".** With no print provider it
    waits for a person to print and post it and mark it so, by name.
50. **Engines are deterministic.** LLMs belong at the edges proposing
    structured values — never deciding a score or clearing a flag.
51. **An agent proposes; a named person decides.** Accepting a proposal can
    record a review, a selection or a sign-off, or adopt the standard conditions
    plan at "not started" — there is no fifth effect and there must never be
    one. The shared operator password is refused, because every one of these is
    somebody stating a judgement and a shared credential has nobody behind it.
52. **A request names a proposal, never an effect.** The agents re-run on the
    server and the effect is read from the proposal found in that run. A client
    that could name its own effect could adopt a plan by asking politely.
53. **Dormancy is a finding.** An agent with nothing to say says why. Quiet
    because the deal is clean and quiet because it was never reached look
    identical otherwise, and only the second is a problem.
54. **Nothing server-side may reach the browser bundle.** A client component
    importing `@backend/` ships the store, the driver and every secret it reads
    to the visitor, and the build succeeds. The boundary test is the only thing
    that fails.
55. **The Postgres engine is the one that runs in production, so it is tested
    against a real Postgres.** Two money bugs lived in it invisibly because the
    suite was skipped without `TEST_DATABASE_URL`: `ON CONFLICT` is illegal on a
    table carrying a rule, and `FOR UPDATE` cannot lock rows that do not exist
    yet. The file store passed both, which is the worst possible combination.
56. **Company identity is configuration, never a literal.** `identity.ts` reads
    it from the environment and the footer prints only what is recorded. A
    placeholder company number is not a missing disclosure, it is a false one,
    and `checkIdentity()` in the preflight blocks the release while the
    statutory ones are unset.
57. **The free appraisal is buyer-side arithmetic and returns no Deal Score.**
    Scoring runs Seller Protection and the motivation diagnostics, which need
    answers about a person nobody has spoken to. It is also never a trackable
    route: the deal is in the query string and both vendors read `location.href`
    themselves.
58. **Never set `display` in a touch-target rule.** The first attempt forced
    `inline-flex` onto every link and excluded the layout-bearing ones with
    `display: revert`, which reverts to the user-agent value and silently
    deleted Tailwind's `flex` from every `a.flex` on the site. Padding grows a
    target without touching layout.
59. **Supply is counted, never claimed, and a small number is stated.** The
    landing page's "verified buyers" came from the seed constants on a page
    whose comment says every figure is computed. `supply.ts` reads the store; a
    blocked deal is never counted as available; a cadence is withheld until
    there is history for one; and no return, yield or margin appears in a public
    supply statement, because that would be a financial promotion under FSMA
    s.21. A worked example is labelled as one — it said "Live" beside a fixture.
60. **A permission is evidenced or it is not held.** `HELD_PERMISSIONS` takes
    `key:evidence` pairs and drives the regulatory router, the revenue model,
    the charge gate and the fee engine from one catalogue. A bare key grants
    nothing and blocks the preflight — the revenue model was previously switched
    off by an unreachable default rather than by a decision.
61. **Stock is three kinds and they are not equivalent.** `inventory.ts` carries
    the category with the opportunity, and `categoryDefect()` catches a label
    claiming more than is recorded — in both directions, because under-claiming
    prices the work wrong too. Money hangs off the recorded confirmation, never
    the label: a label can be wrong, a confirmation is a fact with a name and a
    date on it.
62. **A reveal is refused far more often than it is charged.** No confirmed
    sale, no estate-agency permissions, an openly advertised property, a second
    charge, an ungraded buyer — any one of them and nothing is taken. The
    guarantee is published and applied from one list, and `decideRefund()` needs
    nobody's agreement, because a guarantee an operator can decline is a
    concession.
63. **The card a buyer sees before paying is a closed shape, not a filtered
    deal.** No address, no seller situation, no return figure. A filter is a
    list of things somebody remembered to remove; a closed shape is a list of
    things somebody decided to include, and a test pins the keys.
64. **Nobody reaches a seller before identity and funding are checked.**
    `mayApproachSeller()` owns the decision so no call site reads the grade and
    invents its own. Grade C — we know exactly who they are and nothing else —
    is the refusal that matters.
65. **A score is capped by what can be proved.** Low confidence caps at 40, and
    the number is load-bearing: at 55 an unevidenced 62 still beats an evidenced
    42, which is the ordering §18 exists to prevent. Every score publishes its
    confidence, evidence used, evidence missing, calculation date, principal
    reasons and principal risks.
66. **A question with no answer is published as unanswered, never left out.**
    `materialInformation.ts` has three states, not two: stated, not-applicable,
    and not-known-and-here-is-who-was-asked. A buyer cannot tell the difference
    between "no covenants" and "nobody looked", and omitting the second is a
    misleading omission under the CPRs. Part A unanswered stops the property
    being marketed at all, and therefore stops the reveal.
67. **The Regulations cover both parties, so the seller is checked too.**
    `sellerDueDiligence.ts` asks three separate questions and conflating them
    is the usual mistake: who are they, may they sell it, and who is behind it.
    The middle one is where transactions actually fail — the person on the
    telephone is very often not the registered proprietor — and an executor, an
    attorney and a company each need different evidence. Nothing recorded is
    unchecked, never "no concerns", and it stops the property being marketed.
68. **A stage is derived, never set.** `workflow.ts` walks the twelve steps
    forward and stops at the first gap, so a deal with an accepted price and no
    seller checks reports as stuck at the check rather than as further on. A
    stage field somebody advances tells you what they believe; this tells you
    what can be proved, and the two diverge exactly when it matters. Portfolio
    OS is in the list marked `built: false`, because a step drawn as working
    would misrepresent the product.
69. **The twelve prohibitions each name the control that enforces them.**
    `prohibitions.ts` is the register and a test walks its citations, failing if
    one names a function nobody wrote — the failure mode of every compliance
    register is a note that reads as a control and is not one.
70. **One file knows a provider's names, and it is `stripe.ts`.** Stripe takes
    form-encoded line items rather than a JSON amount, which is why it needs an
    adapter rather than a configuration value. Its signature scheme is already
    what `verifyWebhook()` implements, so the adapter adds a header name and
    nothing else — a provider that signed differently would be a change to
    `webhook.ts`, and it must stay visible as one. The event map is closed:
    `checkout.session.completed` and not `payment_intent.succeeded`, because
    mapping both applies one purchase twice and the event-id claim would not
    catch it.
71. **Nothing is credited from a redirect.** `/account/billing/complete` reads
    the ledger and says a confirmation still to arrive is normal. The URL a
    customer is sent to is the one signal an attacker fully controls, and there
    is no code path from that page to the ledger.
72. **Money out is held, and blocked, and paid once.** A wrong payment in can
    be refunded; a wrong payment out is gone. The hold is fourteen days —
    exactly the buyer's own refund window, because paying out before it expires
    is paying out money we have promised to give back — and an outstanding
    reversal blocks entirely however old the money is, since a share paid on
    money later charged back loses the whole amount rather than the commission.
    The idempotency key is derived from the recipient and the source, never
    generated, and the store holds it unique.
73. **Nothing pays an account nobody checked.** A payout recipient carries a
    verification with a date, a named checker and what was checked, and it
    lapses. Sending money to an unchecked account is how a marketplace becomes
    the payment leg of somebody else's fraud, and it is unrecoverable by the
    time anybody notices.
74. **A holding's value is evidenced or it is an assumption, and the difference
    is printed.** The most tempting mistake in a portfolio view is carrying the
    appraisal's post-works value forward as though the works happened and a
    valuer agreed — every figure downstream inherits it. With no valuation
    recorded the current value is what was paid, marked as stale, and a
    valuation needs a figure, a date and a valuer or it is not one.
75. **The refinance window is a date, not a status.** Computed from the
    completion date and the facility term: seasoned at six months, urgent
    ninety days before the end. What kills a refurbishment is not the interest,
    it is arriving at the term end with no exit arranged, and by then the
    options are an extension fee, a forced sale or the lender taking it.
76. **A limiter fails open and says it is per-process.** Nothing bounded an
    inbound request until sign-in cost 170ms of scrypt, at which point six
    attempts a second saturated a core. `rateLimit.ts` allows where it cannot
    decide, because a bug in a limiter must cost a defence rather than the
    platform, and it holds no shared state — on four instances a caller gets
    four times the allowance, which is still a bound and is not a quota.
77. **Password parameters travel with the hash.** `COST` was declared,
    commented as OWASP's floor, and passed to neither scrypt call, because the
    promisified type had no parameter for it — a signature that cannot express
    an argument guarantees the argument is forgotten. Correcting the cost
    without recording it would have locked out every account, so hashes are
    `scrypt$N$r$p$digest`, old ones verify at their own parameters, and they
    are upgraded on the one occasion the plaintext exists.
78. **A page is a rendering limit and never a supply figure.** `pageDeals()`
    bounds the listing surfaces, which loaded the whole table and scored every
    row. The pipeline headline reads the total, not its own row count — the
    alternative says "50 opportunities" on a pipeline of four thousand.
79. **The first non-additive schema change has somewhere to go.**
    `migrations/` runs numbered files once each, in a transaction, recorded.
    The base schema stays additive; this is for what additive DDL cannot say.
80. **A check that could not be run is inconclusive, never clear.**
    `screening.ts` is the port and `backend/screening.ts` the adapter; with no
    provider configured every check returns an outcome that clears no gate, so
    a deployment without one refuses visibly rather than silently approving
    everybody. A manual check is a first-class outcome with a reference and an
    author, and `method` never lies about which it was — an operator reading a
    clear result is entitled to know whether a provider said so or a colleague
    typed it.
81. **A fee needs four things, and money is one of them.** The permission, the
    stage, the disclosure to the seller and a named person raising it.
    `fees.ts` reports every missing one at once. The seller pays exactly one
    fee — a percentage of the price achieved, on completion and at no other
    point — and it needs two more things again: their signature, and that they
    are not still instructed under sole agency or sole selling rights, where a
    fee on top would make them pay twice for one completion.

### Outstanding

- A live payment account. The Stripe adapter is written and tested end to end
  — a signed delivery moves the ledger — but no real keys are configured, so
  `createCharge()` fails closed and the preflight says so.
- A live Connect account. The payout path is built and tested against both
  store engines, but with no provider configured `makePayout()` records the
  payout as failed rather than as sent, which is the safe state.
- GoldMine live import — parsers exist and are fixture-tested; no live call has
  been made (egress blocked in the build environment). Verify before relying.
- An identity and sanctions provider. `screening.ts` is the port and the
  closed path is tested; no adapter is written, so every check is inconclusive
  and operators record manual ones. That is honest and it does not scale.
- The Price Paid and corporate-ownership halves of the registry signal. The
  EPC half is wired through `backend/registry.ts` and surfaced on the Deal
  Room; `registryPressure()` scores absent facts at nothing and says which are
  missing, so a partial signal is honest rather than misleading.
- An HM Land Registry title reader. `lookupOwner()` takes one as an argument
  and is fully tested against a fixture; nothing in the app passes a real one,
  because there is no licensed API endpoint configured. It is the owner
  outreach spine and it waits on a credential, not on code.
- A timeout-capable messaging provider. `sendReconciliation.ts` is the A13
  decision (a post-timeout provider lookup → already-sent / safe-to-retry /
  escalate) and the outreach send guards a thrown timeout through it, failing
  closed to escalation. A transport that can report an accepted-then-timeout and
  answer a lookup is an SMS/WhatsApp integration, the same class as the payment
  and screening adapters.
- A licensed listing/comparable feed. The whole Deal Hunt + Market Watch engine
  (matcher, `deriveListingSignals` §19.5 detectors, comparables, identity
  resolution) is built and fixture-tested; `EMPTY_SOURCES` is the default and
  `DEAL_HUNT_FIXTURES=1` the staff-pilot set. Live investor display and the
  dense signals wait on a signed feed, not on code.

---

## Part 2 — Operating rules

### Never repeat completed work
Inspect before starting. If something exists and works: **reuse, extend,
integrate — do not recreate.** Never rewrite working auth, schemas, APIs,
components, config or design systems.

### Read before you write
Never generate code before inspecting the relevant files. **Never assume what
can be verified from the codebase.** Search first.

### Done means done
Once implemented, integrated and verified, leave it alone unless: a new
requirement depends on it, a verified defect exists, a security issue exists, a
regression is identified, or a required architectural change affects it.
**Never refactor working code for cosmetic reasons.**

### Never destroy working functionality
Before changing shared code ask: *what depends on this?* Be especially careful
with `chrome.tsx`, `money.ts`, `format.ts`, `types.ts`, `jurisdictions/`,
`globals.css`, and the repository. Prefer small controlled changes.

### Fix root causes
OBSERVE → TRACE → IDENTIFY ROOT CAUSE → FIX → VERIFY → CHECK REGRESSIONS.
Never stack workarounds around an unresolved problem.

### Do not loop
**Same error + same approach = stop and reassess.** The next attempt must
incorporate new evidence.

### Search before creating
Before any new file, component, function, type, helper or dependency, search
for an existing equivalent. One source of truth. No `UserService` /
`userService` / `UserHelper` doing the same job.

### Do not overengineer
Simplest production-grade solution that satisfies the requirement. Complexity
must solve a real problem, never a theoretical future one.

### Build vertically
UI → validation → server action → business logic → store → response → UI state
→ error handling → tests. One finished feature beats ten half-built ones.

### Type safety
Strict typing. **No `any`, no `as never`, no `@ts-ignore`.** The branded `Money`
and `Bps` types exist to catch real errors — fix the type, never suppress it.
(This has been violated before and caught in review; do not reintroduce it.)

### Centralise business logic and constants
Rates, thresholds, prices, limits and business rules belong in one place.
Never scatter `£49`, `5%`, `15%` across files. Jurisdiction rates live only in
`jurisdictions/` with an `asOf` date and pinned tests.

### Preserve the design system
Reuse `chrome.tsx`: `SiteHeader`, `Panel`, `Button`, `Badge`, `Stat`,
`KeyValue`, `VERDICT_TONE`, `scoreTone`. Do not invent new colours, buttons,
cards, headers or spacing. The platform must look like one product.

Tokens live in `src/app/globals.css`; typefaces are self-hosted by
`src/app/fonts.ts` through `next/font`. The scale is deliberate and tight:

- **Surfaces are opaque and layered** — `bg-surface-1/2/3` with a visible
  `hairline` edge. Never `bg-ink-900/40`: an alpha over black is a slightly
  lighter black with no edge, and a page of them is a page of floating
  rectangles with no hierarchy.
- **Radii are small.** The Tailwind radius scale is overridden, so
  `rounded-2xl` is 10px. Nothing is a pill except a dot or a progress bar.
- **Body is 15px, most of the interface is 12–14px**, and a page headline is
  32px. Headlines earn their size by being rare.
- **Figures are sans with `tnum`**, never the display serif. A serif numeral is
  beautiful in prose and wrong in a column of money.
- **The product is vibrant, and the vibrancy is one system.** Colour is applied
  deliberately, everywhere, through two shared mechanisms and never hand-rolled
  per page: (1) `globals.css` defines a seven-hue decorative palette —
  `gold, sky, cyan, teal, indigo, violet, fuchsia` — behind a `data-accent`
  attribute that sets `--accent`, `--accent-2` and `--accent-text` for an
  element and everything inside it; (2) `chrome.tsx` `Panel` puts a two-tone
  `.accent-strip` across its top, tints its header with `--accent-soft`, and
  takes an `accent` prop — omitted, it derives a stable hue from the title via
  `hueFor()`, so a page of panels is a mix of colours automatically. `SiteHeader`
  carries a full-palette `.spectrum-rule`, `.eyebrow` and `Stat` labels are
  `--accent-text`, and the body has low-alpha colour blooms over the ink ground.
  Top-level pages section-code their `<main>` with `data-accent` / `SECTION_ACCENT`.
  **The decorative palette is deliberately free of red, orange, amber and
  emerald**, because those are reserved: a Deal Score, a verdict
  (`VERDICT_TONE`), a `scoreTone`/`scoreBg` and a good/warn/bad `Badge` are the
  only things allowed red-amber-green, so a warning can never read as decoration
  and a decorated panel can never read as a warning. Accent is never load-bearing
  — identity never rests on hue alone.
- **A notice is a 2px left rule, not a tinted box.** A filled coloured rectangle
  says the same thing at fifty times the area and buries the sentence. (The
  panel header's `--accent-soft` wash is the one sanctioned tint, and it is a
  wash, not a box.)

### Handle all UI states
Loading, success, empty, error, disabled, permission-denied. Responsive at
mobile, tablet, laptop, desktop. Semantic HTML, labels, keyboard navigation,
focus states, contrast.

### Test what you change
```bash
npx tsc --noEmit     # types
npx vitest run       # ~1850 tests
npx next build       # build
```
Then verify the affected routes actually render.

### Never declare success without verification
"Fixed" is not a status. **IMPLEMENTED → TESTED → VERIFIED.** If something
cannot be tested in this environment, say so explicitly rather than implying it
was checked.

### Fix your own errors
Build failures, type errors, broken imports, failing tests caused by your
change are yours to fix — without asking permission.

### Do not fix unrelated things
Record and report unrelated issues. Do not modify unrelated stable code.
Uncontrolled scope creates regressions.

### No placeholders, no fake data
No TODO, mock data, fake success or hardcoded demo response inside a feature
presented as complete. **A screen showing invented numbers is not a finished
feature** — every figure on every page must come from the engine.

### Remove dead code
After replacing functionality, delete the obsolete implementation, unused
imports, abandoned components and stale debug statements.

### Security and data
Validate and authorise on the server. Never trust client input. Never expose
secrets. Never log secrets or full payment details. Financial operations must
be idempotent. Protect production data — never casually reset, delete or
overwrite it.

### Comments explain WHY
Not what the code does. Document unusual business requirements, security
decisions, compatibility constraints and non-obvious algorithms. Several
comments in this repo record bugs that were fixed and must not be "simplified"
back — `seniorFacility()` and the Red Team tiering especially.

### Communication
Perform the work; do not narrate each step. Communicate only decisions that
materially affect architecture, security, functionality, cost, scope or
compatibility. Ask only when ambiguity materially affects product behaviour,
security, finances, irreversible data changes or major business rules.

### Stop conditions
Stop and reassess before anything that would destroy production data, expose
credentials, bypass authentication, introduce a known vulnerability, create
financial transactions incorrectly, or overwrite working functionality
unnecessarily.

---

## Part 3 — Checks

**Before coding (60 seconds):** What exactly needs changing? Where is the
current implementation? Does similar functionality already exist? Which files
genuinely need modification? What could this break? What is the safest
implementation? How will I verify success?

**Before declaring done:**

- [ ] Requirement implemented, existing behaviour preserved
- [ ] No duplicate implementation created
- [ ] Types pass, build passes, tests pass
- [ ] Error, empty and loading states handled
- [ ] Responsive behaviour checked where applicable
- [ ] Security and authorisation reviewed; no secrets exposed
- [ ] No debug code, no fake data, no unnecessary dependencies
- [ ] Docs updated if the change alters what exists (`README.md` "What is
      actually built" and "Not built yet" are load-bearing — a README that
      describes a version that no longer exists is worse than none)

**Definition of done:** FUNCTIONAL + INTEGRATED + SECURE + TESTED + STABLE +
MAINTAINABLE + DEPLOYABLE.

**Priority order:** STABILITY → CORRECTNESS → SECURITY → UX → PERFORMANCE →
NEW FEATURES. P0 platform failure before P4 cosmetics, always.
