# LODE Source — AI Property Sourcing Machine — what is built

`docs/LODE_AI_Property_Sourcing_Developer_Spec.md` (v1.0, 4 November 2026) is a
from-scratch developer handover: eighteen sections, two state machines, roughly
twenty entities, an AI intake assistant, a comparable-evidence valuation engine,
multi-tenant isolation and a full compliance spine. It says plainly that "LODE
integration is an assumption; existing authentication, code and data contracts
must be inspected before implementation."

This is that inspection. Most of the specification already exists in Lode — it
describes, largely, the platform that is running. The purpose of the table is
that nobody rebuilds what is built, and nobody assumes the gaps are closed. The
same discipline as `docs/PAF-OS.md`: a specification with no honest gap analysis
becomes a claim that the whole thing is done.

One framing note. The spec is written for a standalone product sold to LODE's
own acquisitions team, with tenant isolation "from day one". Lode today is a
single-business platform with accounts and roles, not a multi-tenant SaaS. That
is the single largest structural divergence, and it is a decision, not a defect:
tenancy matters only if the platform is to be sold to other firms. Everything
else maps onto what exists.

## Built and tested

| Spec | Where | Notes |
|---|---|---|
| §2 end-to-end flow, one coherent position | `src/shared/domain/director.ts` | `runDealDirector` is the single source; the page renders it |
| §4 no scraping, no permission inferred from a public record | `src/backend/discovery/`, `sources.ts` | `assertSourceUsable` throws at ingestion; portals refused with the reason recorded |
| §4 CSV / candidate quarantine then approve | `/operator/discovery` | Unapprovable unless `VERIFIED`; approval named and audited |
| §4 signed webhook ingestion, replay-age check | `/api/billing/webhook`, `/api/outreach/events` | Verified over raw bytes, claimed once |
| §5 progressive seller intake, save-and-resume | `/sell`, `src/shared/domain/intake.ts` | Marketing choices optional and unticked |
| §5 no distress narrative, no health-based discount, vulnerability pauses | `src/shared/domain/protection.ts` | A reported capacity/coercion concern blocks regardless of price (§20 prohibition) |
| §5 seller authority: owner / executor / attorney / representative | `src/shared/domain/sellerDueDiligence.ts` | Three separate questions; nothing recorded is "no concerns" |
| §5 material information, Part A hard gate | `src/shared/domain/materialInformation.ts` | Part A unanswered stops marketing and the reveal |
| §6 investor mandate fields, self-declared vs verified funds | Buy Box mandates, `passport.ts` | Proof of funds held as dated evidence; grades derived, never stored |
| §6 mandate lifecycle, reconfirm on expiry, compliance cannot be overridden | `accounts.ts` `can()`, certification | Deal material gated on a current certification; a high score never clears a failed gate |
| §7 deterministic calcs, integer pence, versioned trace | `src/shared/money.ts`, `economics.ts` | Branded `Money`; no floats; profit computed after profit tax |
| §7 maximum purchase price solver | `maxViablePrice()` | Bounded search, no LLM arithmetic |
| §7 mandatory downside scenarios | `src/shared/domain/redteam.ts` | The nine stresses; single-factor losses cap the score |
| §7 confidence from what is evidenced | `src/shared/domain/opportunityScore.ts` | Low confidence caps the score (§65); evidence used and missing both published |
| §8 hard filters before ranking, reasons persisted | `src/shared/domain/matching.ts` | Every rejection carries the criteria it failed |
| §8 teaser hides identity and access; authenticated, logged access | `/opportunities`, `reveal.ts` | The card is a closed shape, not a filtered deal (§63) |
| §9 channel policy before every send, not only at enrolment | `src/shared/domain/outreach.ts` | Eligibility re-checked at send; PECR channel-aware |
| §9 double opt-in, service reply never enrols marketing | `src/shared/domain/newsletter.ts` | Cron fails closed without `CRON_SECRET` |
| §9 frequency caps, business-hours window, stop conditions, STOP webhooks | `src/shared/domain/campaign.ts`, `/api/outreach/reply` | Opt-out classified before other queued work; a reply pauses and raises a task |
| §9 AI first contact identifies itself and cannot bind | `src/backend/agents/`, `agents.ts` | An agent proposes; a named person decides; four effects and no fifth |
| §10 position derived from evidence, not set by hand | `src/shared/domain/workflow.ts` | Twelve steps; the deal sits at the first gap |
| §11 modular TypeScript, Postgres, provider adapters, LLM gateway | `src/backend/`, `llm.ts` | `DATABASE_URL` selects the engine; both pass one contract suite |
| §11 appraisals/permissions/workflow kept out of prompts | boundaries test | Engines are deterministic; LLMs at the edges only (§50) |
| §12 untrusted data: injection cannot change tools or policy | `src/backend/discovery/extract.ts` | No inference path; a contact is extracted or it does not exist (§40) |
| §12 external fetch allowlist, blocks private-network targets | `src/backend/discovery/fetcher.ts` | The only outbound path; licence, host allowlist, HTTPS, robots, rate limit |
| §13 encryption at rest for personal data, append-only audit | `src/backend/crypto/fieldCipher.ts`, audit | No update, no delete on the audit trail (§17) |
| §13 role checks on every object and action, rate limiting | `accounts.ts` `can()`, `rateLimit.ts` | Server actions check their own permission (§29) |
| §14 acceptance: dedup, opt-out mid-sequence, injection, unauthorised offer | `tests/` | Mapped to existing boundary, outreach, protection and agent tests |
| §16 funnel instrumentation, counted never claimed | `src/shared/domain/supply.ts`, `/operator/dashboard` | A blocked deal is never counted as available (§59) |
| §17/§18 compliance gate, HMRC/redress/PECR sources | `src/shared/domain/permissions.ts`, `docs/REGULATORY.md` | A permission is evidenced or not held; the preflight blocks on criminal gaps |

## Partial — exists but not in the shape the spec asks for

| Spec | What exists | The gap |
|---|---|---|
| §3 roles: analyst, acquisition manager, compliance officer, investor manager | `admin / operator / investor / funder / partner / seller` | Fewer, coarser roles. The staff split (analyst cannot release; compliance owns cases) is not modelled |
| §5 classification as six independent outputs | `motivation.ts` diagnostics + protection flags | We publish a motivation score plus separate protection flags, not the six named outputs (completeness / fit / timing / evidence / actionability / risk) |
| §8 pack version freeze by content hash, approval invalidated on change | reveal + memorandum | A pack is quoted and revealed, but it is not frozen by a content hash that a later change invalidates |
| §10 explicit Lead/Deal transition API with per-transition version + evidence | `workflow.ts` derives position | Position is read, not advanced through an API with version gates and a content hash |
| §13 retention schedules by record class; `/privacy/requests` workflow | encryption + audit + suppression | Retention is not formalised per record class, and there is no subject access/erasure endpoint |
| §16 first-touch vs last-touch attribution, cost per completion | analytics + supply | Counts exist; campaign attribution and cost-per-completion do not |

## Not built — the genuinely new capabilities

| Spec | Status | Note |
|---|---|---|
| §11 multi-tenant isolation (`tenant_id` on every table, cross-tenant FK blocks) | **Not built** | A deliberate decision: Lode is one business. Needed only to sell the platform to other firms |
| §7 comparable-evidence valuation + HM Land Registry Price Paid ingestion | **Not built** | Price Paid is already on Lode's own Outstanding list. The appraisal takes a value as input; it does not build one from comparables with provenance and a confidence that falls below three defensible comps |
| §6/§13 identity and AML provider adapter | **Not built** | `screening.ts` is the port and the closed path is tested; no adapter, so every check is `inconclusive` and operators record manual ones |
| §12 conversational AI seller-intake assistant | **Not built** | Intake is a form plus domain diagnostics. There is no chat that extracts facts with message-ID citations, emits the qualification JSON, and routes low-confidence or vulnerability to human review |

## Recommended build order

1. **HM Land Registry Price Paid ingestion + comparable evidence** (§7). Open
   Government Licence data, so no provider contract — only engineering and the
   egress the build environment currently blocks. It makes the appraisal
   evidence-backed rather than input-driven, which is the "does this come from a
   trusted source" question answered properly.
2. **Identity/AML adapter** (§6/§13). The port exists; this wires one provider
   to it, fixture-tested, failing closed without a key — the same shape as the
   Stripe adapter. Needs a provider chosen and a contract, exactly like the
   payment account on the Outstanding list.
3. **Conversational AI intake assistant** (§12). The largest build and the one
   with its own security surface (injection, PII, hallucinated facts). It reuses
   `llm.ts` and the agent runtime, and every extracted fact stays unverified and
   cited, with low confidence routing to a human — the acceptance suite in §14
   is the specification of its guardrails.

Tenancy (§11) is left out of this order on purpose: it is a business decision
about whether Lode is ever sold to other firms, not a gap to close by default.
