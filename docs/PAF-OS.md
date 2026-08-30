# Priority Acquisition Funding OS — what is built

The specification describes a full origination and transaction-orchestration
platform: twenty sections, a twelve-state lifecycle, roughly thirty entities, a
document vault with OCR, nine AI agents, a lender portal, a data room and a
capital discovery and outreach agent.

This is what exists against it. The purpose of the table is that nobody has to
read the code to find out — a specification with no honest gap analysis becomes
a claim that the whole thing is built.

## Built and tested

| Spec | Where | Notes |
|---|---|---|
| §7 calculations — LTV, LTGDV, LTC, equity required, net day one, funding gap, exit headroom, refinance DSCR | `src/shared/domain/fundingMetrics.ts` | Each carries what it was measured against and why; output stamped with `FORMULA_VERSION` |
| §7 readiness score, 0–100 across eight weighted components | `src/shared/domain/fundingReadiness.ts` | Weights 15/15/10/10/15/10/15/10. Triage, not approval, and it says so |
| §10 offer normalisation and total-cost comparison | `src/shared/domain/borrowing.ts` | Itemised cost, net advance, `compareOffers` on total rather than headline rate |
| §6 regulatory routing, six routes with hard blocks | `src/shared/domain/regulatoryRoute.ts` | Every uncertainty routes to review, never to permitted |
| §6 prohibition on "guaranteed" and "risk-free" language | `checkPromotionLanguage()` | Returns findings; never silently rewrites |
| §9A verification states and field-level provenance | `src/shared/domain/outreach.ts` | `VERIFIED`/`PARTIALLY_VERIFIED`/`STALE`/`CONFLICTING`/`REJECTED`/`UNVERIFIED` |
| §9A outreach eligibility engine, six decisions | `outreachEligibility()` | Opt-out and warning-list matches end the question before anything else is weighed |
| §9A three-stage sequence, stage-one content rules | `checkNeutralEnquiry()` | No address, no seller circumstances, no projected return, sender identified, opt-out present |
| §9A reply classification and immediate suppression | `classifyReply()` | Removal matched by rule first, so no model confidence can override it |
| §9A candidate deduplication retaining provenance | `reconcile()` | Conflicting identity becomes `CONFLICTING` rather than one value winning |
| §9A discovery sources and their licences | `src/shared/domain/sources.ts` | FCA Register, Companies House, funders' own published mandates licensed; LinkedIn and guessed addresses refused with the reason recorded |
| §9A discovery connectors | `src/backend/discovery/` | robots.txt parsed and obeyed, per-host rate limiting, licence-gated fetcher, official APIs for Companies House and the FCA Register, verbatim extraction from a funder's own site |
| §9A verification statuses assigned from evidence | `buildCandidate()` | `VERIFIED` only where the company is confirmed trading and a business address is published; name mismatch against the register becomes `CONFLICTING` |
| §9A quarantine until approval | `/operator/discovery` | Candidates are unapprovable unless `VERIFIED`; approval is by a named person and audited; suppression survives a rerun |
| Immutable audit of material actions | `audit_events`, ledger | Append-only, enforced by database rule |

Surfaced at **`/deals/[id]/funding`**.

## Acceptance tests from the specification

Implemented as real tests where they apply to what is built:

| Test | Where |
|---|---|
| §19.1 No regulated introduction without the operator permission | `tests/funding.test.ts` |
| §19.4 Retained interest reduces net advance, not gross repayable | `tests/funding.test.ts` |
| §9A.1 An unverified or guessed email cannot be sent to | `tests/outreach.test.ts` |
| §9A.2 A warning-list match blocks outreach | `tests/outreach.test.ts` |
| §9A.3 A sole trader without consent returns `CONSENT_REQUIRED` | `tests/outreach.test.ts` |
| §9A.4 An opt-out suppresses across every campaign | `tests/outreach.test.ts` |
| §9A.5 A neutral enquiry carries no address or return | `tests/outreach.test.ts` |
| §9A.6 "Remove me" is actioned at low confidence | `tests/outreach.test.ts` |
| §9A.9 No restricted promotion without recorded approval | `tests/outreach.test.ts` |
| §9A.10 One organisation from several sources, provenance kept | `tests/outreach.test.ts` |
| §9A.8 Every discovered field traceable to a source and observation date | `tests/discovery.test.ts` |

## Not built

Listed rather than left to be discovered.

- **§9A autonomous search.** The connectors are built, but nothing crawls. A run
  takes organisations an operator names — from a trade directory, a referral, a
  spreadsheet — and verifies each. No source is licensed for harvesting the web
  for firms, so the input is a list rather than a search query. LinkedIn
  scraping and pattern-guessed addresses are refused permanently, not deferred.
- **§9A sending.** Nothing sends. The eligibility engine decides whether a send
  would be lawful; there is no mailbox connector, no campaign scheduler, no
  bounce or complaint processing.
- **Live verification.** Outbound access is blocked in this build environment,
  so no connector has made a real call. Parsers are fixture-tested against the
  published field definitions and the gates are tested against an injected
  transport. Make one live call per source before relying on any of it.
- **§3 state machine.** Deals carry a `status` field, not the twelve-state
  command-driven lifecycle with permission-checked, audited transitions.
- **§5 document engine.** No vault, no OCR, no extraction, no checksums, no
  version history, no expiry tracking beyond a count the operator records.
- **§9 funder marketplace.** Buy Boxes and Funding Boxes exist and match
  explainably, but there is no lender appetite model with FRN, allocation and
  SLA, no staged disclosure and no lender portal.
- **§11 data room and Completion Control Room.** `completion.ts` scores
  closing readiness; there is no conditions tracker with four-eyes waivers, no
  watermarked data room and no sources-and-uses reconciliation against cleared
  funds.
- **§12 AI agents.** The engines are deterministic by design. The only model
  seam is the blog drafter, which never touches a number.
- **§2 role model.** Four roles, not nine. No tenant isolation — this is a
  single-tenant application.
- **§15 API surface, §16 non-functional.** No public API, no MFA or SSO, no
  tested restore, no DPIA.

## Two judgements worth stating

**Discovery is a licensing question before it is an engineering one.** The
connectors exist, and every one of them is gated: a recorded licence, an
allowlisted host, HTTPS with no credentials in the URL, robots.txt obeyed,
per-host rate limiting, and a 401, 403 or 429 treated as an answer rather than
an obstacle. A source with no recorded licence fetches nothing at all — checked
before a request is made, so a prohibited source generates no traffic.

Extraction has no inference path. The only constructor of a discovered fact
takes the exact substring found in the document, so `firstname.lastname@domain`
cannot be produced: guessing is not collection, and a guessed address has no
source, no observation date and no lawful basis to record. A named individual's
published mailbox is found and deliberately not taken, with the reason shown to
the reviewer.

**The compliance logic is a technical control framework, not a legal
determination.** `ROUTING_RULES.requiresCounselApproval` is `true` and starts
true. UK regulatory counsel must approve the perimeter, the credit-broking
position, the promotion process and the investor categorisation before any of
this runs against real people.
