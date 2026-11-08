# Spec gap analysis — LODE AI Deal Engine suite

Desk mapping of the four dropped specifications against what is built in this
codebase, 7 November 2026.

- **Independent AI Deal Engine** (IND01–16)
- **Ask LODE for Deals / Deal Hunt** (DH01–16)
- **AI Property Sourcing Machine v2** — inbound + Market Watch + agent layer (A01–16, MW01–16, §20 agents)
- **AI Agent Master Spec v2** — the agent-execution contracts (§20–22 of the above; largely the same material)

**How to read this.** Each row is `PASS` (built, with the module that satisfies
it), `PARTIAL` (built but gated on a licensed feed or not fully wired as a live
producer), `GAP` (not built), or `DIVERGENCE` (built differently on purpose —
usually single-tenant vs the spec's multi-tenant assumption). This is a desk
mapping: per decision #42, a `PASS` should be confirmed by following it from a
page or endpoint to the code before it is treated as closed. Nothing here is a
request to rebuild working code.

---

## Progress (updated 7 November 2026)

- **A07** — PARTIAL → **PASS.** The §7 illustration is pinned (`tests/a07Calculation.test.ts`): profit-on-cost 15.74% and gross-discount 21.05% through the engine's own `ratioBps`.
- **MW02/MW03/MW13/MW14** — the identity engine is built: `propertyResolution.ts` (resolution order, reversible merge/split + reconciliation, episode grouping, case linking), 11 tests. The **merge/split review half is live** at `/operator/specialist` (persisted both engines, contract-tested, MW14). The ingestion half (resolve/episodes) activates with the licensed feed, like the rest of Market Watch.

Remaining (not code): the licensed listing feed (procurement, unlocks live Deal Hunt + dense signals), a timeout-capable messaging provider (A13 logic is built), and the multi-tenancy decision (contradicts the explicit single-tenant design).

## Headline

The four specs describe one system, and **the large majority is already built
and provider-gated.** The real work is a short list, not a rebuild:

1. **Licensed listing feed** — the single biggest unlock. Many Market Watch
   signals and the live investor Deal Hunt are modelled and tested against
   fixtures but return a zero/`needs-portal-feed` state until a feed is
   contracted (decision #14). This is the Outstanding item, not a code gap.
2. **Market Watch identity resolution — merge/split and episode linking**
   (MW02/MW03/MW14) — the observation/event model exists; reviewer-driven
   merge/split history is the thinnest part.
3. **A few signals as live producers** — below-local-median, prolonged-STC,
   auction-approaching, disappearance→`availability_check_required` exist in the
   `sourcingSignals` taxonomy as `needs-portal-feed`; they are not yet wired to a
   running producer.
4. **Multi-tenant isolation** — a deliberate DIVERGENCE: the platform is
   single-tenant (`DEFAULT_TENANT = "lode"`; "no tenant dimension"). The spec
   assumes tenant isolation from day one. Closing this is an architecture
   decision, not a feature.
5. **The formal L0/L1/L2 autonomy-level agent model** — built as a 9-agent
   *deterministic observer* layer with a durable run ledger, not the spec's
   10-agent autonomy-graded executor. Functionally equivalent for MVP; the
   naming and the L2 "routine response" dispatcher differ.

---

## Independent AI Deal Engine — IND01–16

All built end-to-end, provider-gated (see CLAUDE.md "Deal Hunt + Independent Engine").

| ID | Result | Satisfied by |
|---|---|---|
| IND01 | PASS | `EMPTY_SOURCES` default; core runs with no vendor call |
| IND02 | PASS | Worker returns explicit zero-match + coverage boundary |
| IND03 | PASS | `dealHuntBrief`/intake accept manual facts; URL grants nothing (decision #14) |
| IND04 | PASS | `matchReturnedAndReduced` — event sequence, baseline, delta |
| IND05 | PASS | Ambiguous identity excluded (DH05 path) |
| IND06 | PASS | `comparableBundle` — advertised vs agreed separate; `rent_unavailable` |
| IND07 | PASS | `evidenceClaim` revision; excluding a comp creates a new version, prior appraisal reproducible |
| IND08 | PASS | `comparison.ts` — ≤4 under one shared assumption set, overrides visible |
| IND09 | PASS | `decisionOutput.ts` — blocker shown even with positive economics |
| IND10 | PASS | `floorplan.ts` — unscaled plan stays a hypothesis, no fabricated dimension |
| IND11 | PASS | `auction.ts` — availability unverified until confirmed, confirmed charges only |
| IND12 | PASS | Deterministic search/calculator work with model unavailable; agents fail closed |
| IND13 | PASS | `watchCursor.ts` — one event/alert per watch/property/episode |
| IND14 | PASS | `decisionSnapshot` + `assertSourceUsable` — withdrawn permission blocks display/export |
| IND15 | PASS | Agents cannot contact owners/issue offers (structural, decision #51) |
| IND16 | PASS | LODE IDs stable; adapter swap keeps appraisals/snapshots stable |

---

## Deal Hunt — DH01–16

Built; `backend/dealHunt/worker.ts` + `dealHuntBrief` + `dealHuntHandoff`, surfaced at `/operator/hunts` and `/invest/hunts`.

| ID | Result | Satisfied by |
|---|---|---|
| DH01 | PASS | `interpretBrief` — typed filters + visible event interpretation |
| DH02 | PASS | `validateCriteria` — geography + ceiling required, confirmation blocked |
| DH03 | PASS | matcher computes drop pence + bps (5% threshold) |
| DH04 | PASS | cut-before-under-offer excluded |
| DH05 | PASS | ambiguous cross-agent identity excluded |
| DH06 | PASS | returned-to-market eligible with reason-unverified |
| DH07 | PASS | rerun exclusion + prior result stale (`dealHuntHandoff`) |
| DH08 | PASS | guide/missing baseline → insufficient evidence |
| DH09 | PASS | worker merges one property on two feeds → one card |
| DH10 | PASS | thin sold + advertised-only rent labelling |
| DH11 | PASS | comparable outage → partial result |
| DH12 | PASS | run lifecycle + notify-once |
| DH13 | PASS | entitlement re-checked at handoff |
| DH14 | PASS | injected brief instructions change nothing |
| DH15 | PASS | idempotent appraisal open (one linked draft) |
| DH16 | PASS | explicit zero-match, no auto-broaden |

---

## Property Sourcing acceptance — A01–16

| ID | Result | Satisfied by / gap |
|---|---|---|
| A01 | PASS | Webhook idempotency: `claimBillingEvent` pattern + outreach reply dedupe (`raiseTask`) |
| A02 | PASS | `outreach` suppression immediate; sends gate on suppression at send time (decision #44/#48) |
| A03 | PASS | Inbound reply pauses sends + opens one `operatorTask` (`handleReply`) |
| A04 | PASS | `jurisdictions/` — out-of-area applies no England tax; unknown → not-supported (decision #5) |
| A05 | PASS | `comparables` — <3 defensible → low confidence + review; reveal blocked (decisions #65/#62) |
| A06 | PASS | Unknown buyer profile → `taxPending`, worst-case tax, no final return (intake A06) |
| A07 | PARTIAL | Economics engine computes profit-on-cost + gross discount, but the spec's exact illustration (£216k/£34k/15.74%/21.05%) is **not pinned as a fixture**. Recommend adding one pinned calculation test. |
| A08 | PASS | `decisionSnapshot` versioning + reveal/release gates; input change invalidates |
| A09 | PASS | Funder verification lapses (`funderIsVerified`, 12-month); unverified blocks introduction |
| A10 | DIVERGENCE | No "analyst" role that is forbidden to issue offers — roles are `accounts.can()` permissions, not the spec's named role set. Offer-issue is operator-gated; the *effect* (no unauthorised offer) holds, the *role model* differs. |
| A11 | DIVERGENCE | Cross-tenant denial — platform is single-tenant; `tenantId` is carried on newer entities but cross-tenant isolation is not enforced/tested as the spec requires. |
| A12 | PASS | `qualification` gate drops injected instructions; scoped extraction only (decision #50) |
| A13 | PARTIAL | Provider send-reconciliation on timeout — the outreach transport is single-path; Stripe webhook has full idempotency, but the messaging provider's accepted-then-timeout reconciliation is not built. |
| A14 | PASS | CSV/discovery quarantine at `/operator/discovery`; no send without licence (decision #38/#41) |
| A15 | PASS | Vulnerability/hardship → human review, persuasion paused (intake + `screening` posture) |
| A16 | PASS | `dealTransition` A16 — completion needs conveyancer + date; fee unraisable otherwise (decision #81) |

---

## Market Watch — MW01–16

Model: `marketWatch.ts` (observations, `deriveEvents`, `matchReturnedAndReduced`), `sourcingSignals.ts` (signal taxonomy with `computable`/`from-seller`/`needs-portal-feed` availability), `evidenceClaim.ts`.

| ID | Result | Satisfied by / gap |
|---|---|---|
| MW01 | PASS | One observation per revision; one event per change (`deriveEvents` dedupe) |
| MW02 | PARTIAL | Flats: `addressKey` keeps units distinct, but formal UPRN/unit resolution with candidate review is thin |
| MW03 | PARTIAL | Relist preserves history — events are append-only; episode linking across a gap is **reviewer-confirmed and not fully wired** |
| MW04 | PASS | Feed failure → stale; no sold/withdrawn inference (matcher requires evidenced transition) |
| MW05 | PARTIAL | Single-snapshot absence → `availability_check_required` is in the signal taxonomy as `needs-portal-feed`, not a live producer |
| MW06 | PASS | Late observation uses effective time; current view not overwritten by older revision (`evidenceClaim` effective/observed times) |
| MW07 | PASS | Several searches → one owner task (`operatorTask` dedupe key subject+type) |
| MW08 | PARTIAL | Below-median signal exists in taxonomy (`needs-portal-feed`); not a live producer, correctly non-approving |
| MW09 | PASS | Probate/illness earns no score; no hardship inference (decision #8; signals never score hardship) |
| MW10 | PASS | Short-lease vs mortgage mandate → excluded on hard criterion (`matchFundingBox`/passport) |
| MW11 | PARTIAL | Licence rights matrix — `sources.ts` gates use (`permits`), but a per-provider display/export rights matrix on a live feed is not configured (no feed yet) |
| MW12 | PASS | Criteria change → membership recompute, no fictitious event (immutable query revisions, `dealHuntRun`) |
| MW13 | PARTIAL | Inbound case ↔ watched listing link — both can exist on one property, but the automatic link + duplicate-contact guard across the two channels is not wired |
| MW14 | GAP | Merge reversal → per-property history rebuild — reversible merge/split audit is **not built** |
| MW15 | PARTIAL | Provider price correction → signal retraction — `evidenceClaim` supersede exists; retraction of a derived signal + briefing update is not fully wired |
| MW16 | PASS | Listing lacks owner authority → appraisal draft allowed, release blocked (reveal/release gates, decision #66/#67) |

---

## AI agent execution layer — §20 (Master Spec v2)

| Spec item | Result | Satisfied by / gap |
|---|---|---|
| Durable run state (20.5): queued→running→validating→succeeded/awaiting_human/awaiting_data/retry_wait/failed/cancelled/superseded | PASS | `agentRun.ts` — one lifecycle state machine, guarded transitions, supersede, compare-and-swap (AG05) |
| Canonical agent envelope (20.6): run_id, subject, input_version, proposed actions, evidence IDs, outcome | PASS | `agentRun` record + `qualification` structured output; agents propose, services decide |
| Agent cannot contact owners / issue offers / move money (20.3 human-gated) | PASS | Structural (decisions #51/#52); `authoriseDecision` refuses shared password |
| Kill switch / autonomy pause (20.8-ish) | PASS | `agentControls` + `AGENTS_PAUSED` |
| Token/cost budget per run (20.5 usage/budgets) | PASS | `RUNTIME_MAX_INPUT_TOKENS`/`_OUTPUT_TOKENS`, recorded on the run |
| 10-agent catalogue (20.2) with L0/L1/L2 autonomy (20.3) | DIVERGENCE | Built as 9 deterministic observers (`agents.ts`) + model-backed intake/analysis seams, not a 10-agent autonomy-graded executor. The L2 "routine response" dispatcher (templated auto-reply after policy check) is **not built** — all outbound is human-approved, which is stricter than the spec's MVP. |
| Multi-tenant orchestrator context scoping | DIVERGENCE | Single-tenant; context scoping is by `accounts.can()` + viewer, not tenant policy. |

---

## Recommended build order (real gaps only)

1. **A07 pinned calculation fixture** — cheap, closes an acceptance case, guards the economics engine. (Hours.)
2. **Market Watch identity merge/split + episode linking (MW03/MW14)** and the **inbound↔listing case link (MW13)** — the thinnest genuinely-missing model work. (Days.)
3. **Wire the `needs-portal-feed` signals as producers behind the feed flag** (MW05/MW08/MW11/MW15) — these light up only with a licensed feed, so sequence them *with* feed procurement, not before.
4. **Licensed listing feed** (Outstanding, decision #14) — the unlock for live Deal Hunt + most Market Watch signals. Procurement, not code.
5. **Decide on multi-tenancy (A11/MW11/§20)** — a yes/no architecture decision. If single-tenant stays, record it as an explicit divergence in the specs; if not, it is a foundation change, not a feature.
6. **Messaging-provider send reconciliation (A13)** — only once a real SMS/WhatsApp provider is contracted.

Nothing above rebuilds working code. The two largest items (feed, tenancy) are
decisions and procurement; the rest is a short, bounded code list.
