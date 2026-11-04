# LODE Source — AI Property Sourcing Machine — exhaustive gap analysis

`docs/LODE_AI_Property_Sourcing_Developer_Spec.md` (v1.0, 4 November 2026) is a
from-scratch developer handover. It says plainly: "LODE integration is an
assumption; existing authentication, code and data contracts must be inspected
before implementation." This document is that inspection — every atomic
requirement in the spec checked against the code, section by section, with the
exact file and symbol, or an honest MISSING.

It was produced by auditing each spec section against the running code (not
against this repo's own earlier summaries, which it corrects in two places —
the sell form has no marketing-consent control, and `/operator/discovery` is
funder-candidate quarantine, not CSV lead import). The same discipline as
`docs/PAF-OS.md`: a specification with no honest gap analysis becomes a claim
that the whole thing is built.

## The one framing that explains most of the gaps

The spec describes **"LODE Source": a multi-tenant, internal sourcing &
acquisitions CRM** — a REST `/v1` API, an LLM qualification pipeline, explicit
Lead/Deal transition state machines, a reviewer comparable-evidence valuation
workbench, a commercial funnel, and tenant isolation from day one.

The code is **"Lode": a single-business, buyer-facing marketplace** — a free
appraisal, an opportunity marketplace with a reveal/introduction model, owner
outreach, and a derived 12-stage workflow. It is built on a JSONB document
store (no tenancy, no row versions), Next server actions (not a `/v1` REST
contract), and an LLM used only for provenance-guarded prose narration (not
qualification).

The **regulatory and domain engines overlap heavily and are largely built**:
Seller Protection, material information, seller due diligence, PECR-aware
outreach, licence-gated discovery, the deterministic appraisal and Red Team,
permissions, audit, encryption. The spec's **operational architecture**
(multi-tenancy, transition state machines, content-hash pack release, the
qualification AI, the commercial funnel, a durable job/queue substrate) is
largely absent. Neither of those is a surprise — they are two different
products sharing a compliance core.

Three divergences below are **decisions, not defects**, and are marked as such:
- **Multi-tenancy** matters only if Lode is sold to other firms.
- **Profit-tax deduction** (§7) is deliberate (CLAUDE.md decision #2) — the
  engine computes a post-tax figure and never labels it "after all tax".
- **Dark reading surfaces** (§3 asks for white) is the chosen brand system.

Legend: **BUILT** / **PARTIAL** (exists, not in the shape asked) / **MISSING** /
**DECISION** (deliberate divergence).

---

## §2 End-to-end operating flow

| Requirement | Status | Where |
|---|---|---|
| One coherent position, page renders it | BUILT | `director.ts:runDealDirector` |
| Source/purpose/permission recorded, address normalised, duplicate check | PARTIAL | `sell/actions.ts`, `sellerConsent.ts`; address is partial (postcode area + locality), dedup not evidenced |
| Disclosed AI assistant collects facts/priorities/authority | MISSING | intake is a form, not an assistant |
| Rules engine separates fit, completeness, risk | PARTIAL | `motivation.ts` + `protection.ts` flags; not the six §5 outputs |
| Deterministic appraisal with evidence + missing-input flags | PARTIAL | `economics.ts`, `opportunityScore.ts`; values are inputs, not comparable-derived |
| Human approves valuation/offers/release | PARTIAL | agents propose; no offer-issue or pack-release gate |
| Approved terms to seller via authorised channel; replies pause sequences | PARTIAL | `outreach.ts`; no sequence engine to pause |
| Investor mandates filtered; authorised pack released | PARTIAL | `matching.ts`, `reveal.ts`; no versioned pack |
| Conveyancing milestones, completion evidence, fee invoices | BUILT | `completion.ts`, `fees.ts`, `DealFee` |

---

## §3 User roles and screens

| Requirement | Status | Where / gap |
|---|---|---|
| Administrator | PARTIAL | `accounts.ts` `admin`; no distinct provider-settings/approved-rules surface |
| Acquisition manager | PARTIAL | conflated into `operator` |
| Analyst (drafts; cannot issue offers / release packs) | MISSING | no analyst role; no offer-issue or pack-release permission to withhold |
| Compliance officer | MISSING | `/operator/conduct` is a static register; operator runs all checks |
| Investor manager | MISSING | operator holds `manage-mandates` |
| Seller | PARTIAL | `seller` role, own-property only; no appointments |
| Investor | PARTIAL | `investor`/"Buyer"; no invitation/introduction inbox |
| Operational dashboard | PARTIAL | `operator/dashboard` shows supply, not intake/SLA or funnel |
| Seller inbox | MISSING | no conversation inbox |
| Lead kanban | MISSING | `operator/sourcing` is a worklist, not a stage kanban |
| Seller/property workspace (10 tabs) | PARTIAL | Deal Room sub-routes; **Conversations, Offers, Documents, Tasks tabs MISSING** |
| Appraisal workbench | PARTIAL | `/appraise`, `analysis`; no reviewer comparable workbench |
| Investor CRM | PARTIAL | Buy Boxes + accounts; no mandate-stage CRM |
| Matching queue | PARTIAL | engine exists; no queue UI / unknown-data task |
| Deal-pack editor | PARTIAL | `memorandum`; no versioned release workflow |
| Transaction timeline | PARTIAL | `completion.ts`, Progress panel; no role-gated transition screen |
| Compliance queue | MISSING | no case queue |
| Campaigns and attribution | PARTIAL | `campaign.ts`; no attribution model |
| Settings and audit | BUILT | `operator/settings`, `operator/audit` |
| Every estimate shows date/source/status | PARTIAL | present in `opportunityScore`, `registrySignal`, `materialInformation`; not uniform |
| Distinguish seller-reported / provider / reviewer-confirmed facts | PARTIAL | `agent/provenance.ts`, `sources.ts`, `inventory.ts`; no single Fact/Evidence model with a 3-way badge |
| No financial outcome shown in gold as guaranteed | BUILT | `chrome.tsx:scoreTone`/`VERDICT_TONE` |
| White reading surfaces | DECISION | app is dark (`globals.css`); gold accent + near-black nav match the spec, surfaces deliberately do not |
| Keyboard-accessible, labelled, clear errors | PARTIAL | tokens support it; no a11y test |

---

## §4 Lead acquisition and source controls

| Requirement | Status | Where / gap |
|---|---|---|
| Website forms = primary intake | BUILT | `sell/page.tsx`, `SellForm.tsx`, `actions.ts:submitEnquiry` (form, no chat) |
| Capture referral URL | MISSING | not captured |
| Capture campaign IDs | MISSING | no UTM/campaign capture |
| Capture notice version | BUILT | `sellerConsent.ts:recordEnquiryConsent` → `PRIVACY_NOTICE_VERSION` |
| Capture channel choices | PARTIAL | email/phone only; no preferred-channel |
| Approved ad-lead forms via signed webhook | MISSING | no `/webhooks/{provider}` lead endpoint |
| Store provider lead ID + consent wording | MISSING | no lead webhook |
| Referrals: partner submits minimum facts | MISSING | partners page only tells agents to send sellers to the public form |
| Referral authority + separate seller permission | MISSING | not recorded |
| CSV import quarantine → preview → approve | MISSING | no CSV lead path; `/operator/discovery` is funder candidates, `/operator/import` is single-URL listing import |
| CSV origin/collected-date/permission/licence/purpose | MISSING | no CSV import |
| Public sold-price for valuation enrichment | PARTIAL | `sources/landRegistry.ts`, `discovery/enrich.ts` (value anchor only); no live call; not a comparable valuation |
| Sold-price source/retrieval-time/licence/coverage | BUILT | `sources.ts:land-registry-ppd` (OGL licence + attribution + coverage) |
| Licensed listing feeds (later) | PARTIAL | `sources.ts:portal-listings` refused; rights-holder import only |
| Listing-feed storage/display/reuse rights | BUILT | `sources.ts:SourceLicence.permits` + `assertSourceUsable` |
| Postal campaigns (later controlled) | BUILT | `outreach.ts`, `homeownerLetter.ts`/`probateLetter.ts`/`insolvencyLetter.ts`, queued not sent |
| Postal lawful-basis assessment + suppression | BUILT | LIA stored on message; suppression matches `postalKey()` |
| Do not scrape portals | BUILT | `sources.ts:portal-listings.unlicensedReason`, `listingImport.ts:classifyImportUrl`, `fetcher.ts` allowlist |
| Do not harvest contact details by default | BUILT | `extract.ts:extractContacts` (extracted-or-nothing) |
| Do not infer permission from public phone/title/situation | BUILT | `sources.ts` (`inferred-contacts`, `land-registry-title` internal-only), `sourcedLead.ts:heightenedProtection` |
| Source adapters disabled until rights configured | BUILT | `assertSourceUsable` throws; `connectors.ts` fail closed |
| Campaign record (landing/creative/postcode/budget/channel/attribution) | PARTIAL | `sourcingArea.ts` postcode targets only |
| First-touch vs last-touch attribution | MISSING | no attribution model |
| Unattributed leads remain unattributed; no fabrication | PARTIAL | vacuously true (no attribution exists) |

---

## §5 Seller intake contract

| Requirement | Status | Where / gap |
|---|---|---|
| Progressive, save-and-resume | BUILT | `SellForm.tsx` (5 steps), `draft.ts` (per-session only, not cross-device) |
| Contact name; email or phone | BUILT | `actions.ts:parseContact` |
| Preferred channel; availability | MISSING | not collected |
| Notice acknowledgement | BUILT | `SellForm.tsx:privacyAcknowledged` |
| Marketing choices optional + unticked | MISSING | **no marketing opt-in control exists** |
| Full property address | MISSING | only postcode area + locality |
| Postcode | PARTIAL | outward part only |
| Address-resolution status; UPRN | MISSING | no address resolution; no UPRN |
| Property type; bedrooms | BUILT | `parseEnquiryAnswers` |
| Approximate area + its source | MISSING | not collected at intake |
| Tenure; lease length | BUILT | `parseEnquiryAnswers` |
| Service charge; ground rent | MISSING | not intake fields (filled later via listing form) |
| Known restrictions | PARTIAL | coarse issue checkboxes only |
| Occupancy | MISSING | hardcoded `"unknown"` in `submitEnquiry` |
| Tenancy details; access arrangements | MISSING | not collected |
| Seller role (owner/executor/attorney/…) | BUILT | `sellerDueDiligence.ts:SELLER_KINDS` (post-enquiry via capability link) |
| Authority self-reported until checked | BUILT | `recordSellerDetails` never sets verified timestamps |
| Timescale; desired price; flexibility; priorities | BUILT | `parseEnquiryAnswers`, `PRIORITIES` ("net proceeds" maps to `price`) |
| Condition; repairs; structural | BUILT | `CONDITIONS`, `ISSUES` |
| Photographs if voluntarily provided | MISSING | photo upload is operator-side only |
| Secured balances + sale costs for net estimate | MISSING | not captured at intake |
| Unknown balances remain unknown | PARTIAL | 3-state model exists generally; no secured-balance field |
| Existing agent instructions | PARTIAL | checked at the fee gate, not captured at intake |
| Exclusivity; prior offers; already under offer | MISSING / PARTIAL | not asked of the seller at intake |
| Do not require a distress narrative | BUILT | narrative optional; kept off-device |
| No health/hardship-based discount | BUILT | `motivation.ts`/`protection.ts` (price from `negotiation.ts`, never distress) |
| Vulnerability → restricted human task + pause persuasion | BUILT | `protection.ts` capacity/coercion = block + `requiresHumanReview` |
| Avoid storing unnecessary sensitive narrative | BUILT | capped + encrypted + excluded from device draft |
| Classification: Completeness | PARTIAL | `intake.ts`/`materialInformation.ts` compute answered/missing (disclosures, not the intake contract) |
| Classification: Commercial fit | PARTIAL | computed downstream in `matching.ts`, not as an intake output |
| Classification: Timing priority | PARTIAL | `motivation.ts` urgency; no callback preference |
| Classification: Evidence readiness (3 states) | PARTIAL | building blocks in `intake.ts`/`opportunityScore.ts`; no per-case label |
| Classification: Actionability | PARTIAL | authority + approachability exist; access status never captured |
| Classification: Risk flags separate from score | BUILT | `protection.ts:ProtectionFlag` |
| Independent outputs, not a single score | PARTIAL | a motivation score + protection flags, not the six named outputs |
| Hot / Warm / Outside-scope queue | MISSING | `goldmine.ts` "hot/warm" is listing days-on-market, unrelated |
| Human review overrides all queues | PARTIAL | overrides the deal (block), but there is no Hot/Warm/Outside queue |

---

## §6 Investor intake and readiness

| Requirement | Status | Where / gap |
|---|---|---|
| Person/company | PARTIAL | `BuyBox.investorName` free string; no entity |
| Beneficial-ownership workflow reference | MISSING | seller-side only |
| Target postcodes or polygons | PARTIAL | localities only; no polygon |
| Asset types | BUILT | `BuyBox.propertyTypes` |
| Strategy | PARTIAL | encoded as acceptable structures |
| Purchase-price limit | BUILT | `BuyBox.minPrice/maxPrice` |
| All-in budget | MISSING | no field |
| Cash/equity available | PARTIAL | funders only; buyer passport has proof-of-funds |
| Financing required | MISSING | no field |
| Works appetite | BUILT | `BuyBox.acceptsRefurbishment/maxRefurbishment` |
| Minimum return metric | BUILT | `BuyBox.minMarginBps/minYieldBps` |
| Timescale | PARTIAL | completion/term only |
| Occupancy preference; exclusions | MISSING | no fields |
| Separate self-declared budget from verified funds | PARTIAL | `passport.ts:ProofOfFunds` (evidenced); no self-declared budget held alongside |
| Restricted document vault | MISSING | evidence is metadata only |
| Provider ref / reviewer / verification date / expiry | PARTIAL | buyer PoF has date/issuer/expiry; no reviewer/provider-ref |
| Don't expose bank statements in packs | PARTIAL | satisfied by never storing statements |
| Stages Registered→…→Active→Paused/Expired | MISSING | only an `active` boolean + annual certification |
| Reconfirm funds/mandate before introduction if expired | PARTIAL | staleness gates buyer approach & deal material; not tied to the mandate |
| Score cannot override a failed compliance gate | BUILT | hard criteria zero the score; a block is absolute |
| Readiness is fit, not a guarantee | BUILT | `passport.ts`/`fundingReadiness.ts` caveats |

---

## §7 Valuation and appraisal engine

### Evidence model

| Requirement | Status | Where / gap |
|---|---|---|
| Comparable carries address/location/date/price/type/tenure/size/condition/source/retrieval-time | MISSING | partial fields on `landRegistry.ts:PricePaidRecord`; no `Comparable` entity attached to an appraisal |
| Store original + adjustments separately | MISSING | no adjustment model |
| Sold-price alone ≠ condition/present value | PARTIAL | acknowledged in prose; not enforced by a model |
| Default search: same type, 0.5mi, 12mo | MISSING | `pricePaid.ts:fetchSales` is postcode-only |
| Widen to 1mi / 24mo | MISSING | no widening |
| Exclude duplicates/incompatible tenure/unusual | PARTIAL | excludes non-arm's-length only |
| <3 comps / unknown area / stale → low confidence + review | MISSING | only a boolean `comparablesRecorded` in `opportunityScore.ts`; **A05 cannot pass** |
| Record why each comp selected/rejected | MISSING | no reasoning captured |
| Reviewer approves as-is and after-works ranges | MISSING | single point values taken as input |
| Don't call price-vs-refurbished-value a current discount | BUILT | `economics.ts` `discountToOmvBps` vs OMV; pinned in `appraisal.test.ts` |

### Deterministic calculations

| Requirement | Status | Where / gap |
|---|---|---|
| Integer pence at boundaries; decimal for finance | BUILT | `money.ts` |
| GBP, explicit rounding, versioned trace | PARTIAL | GBP/rounding yes; no calculation-trace object emitted by `appraise()` |
| Gross discount % | BUILT | `economics.ts:appraise` |
| Total acquisition cost (incl sourcing fee + VAT) | PARTIAL | `buildCostStack`; no sourcing-fee line, no VAT grouping |
| Total project cost (works incl VAT) | PARTIAL | single `total`; no acq/project split; no VAT on works |
| Project profit before entity/personal tax | BUILT | `appraise.profitBeforeTax` |
| Profit on cost | MISSING | engine computes margin on GDV, not profit/cost (the spec's 15.74%) |
| Cash return; suppress if funding incomplete | PARTIAL | `roiOnCashBps` computed, never suppressed |
| Seller net estimate; label unknowns | MISSING | no redemption/seller-fee fields in the engine |
| Versioned jurisdiction tax rules + effective date + assumptions | BUILT | `jurisdictions/gb-eng.ts:stampDutyLandTax` (`asOf`), `profitTax.ts` |
| Unknown buyer profile → tax pending, no final return | MISSING | always computes from supplied booleans; **A06 not implemented** |
| Don't hard-code a universal SDLT rate | BUILT | band tables per jurisdiction |
| Income/corp tax excluded from MVP; never "after all tax" | DECISION | engine deducts profit tax (CLAUDE.md #2); never labelled "after all tax", marked requires-review |

### Maximum purchase price (solver)

| Requirement | Status | Where / gap |
|---|---|---|
| Solve largest price meeting BOTH min profit AND min profit-on-cost | PARTIAL | `maxViablePrice` bisects a single margin-on-GDV objective |
| Recompute price-dependent tax/finance each iteration | BUILT | re-calls `appraise()` each loop |
| Integer-pence bounded search | BUILT | bisection to <100 pence |
| Report tolerance | MISSING | returns a bare `Money` |
| Fail if objective not monotone | MISSING | no monotonicity check |
| No LLM arithmetic | BUILT | pure bisection |
| §7 illustration reproduced by a test (£216k/£34k/15.74%/21.05%) | MISSING | no test; engine derives tax/finance from tables so it structurally can't take the supplied figures; **A07 not implemented** |

### Mandatory scenarios

| Requirement | Status | Where / gap |
|---|---|---|
| Base | BUILT | `redteam.ts` |
| Exit −10% | BUILT | `gdv-10` |
| Works +20% | PARTIAL | uses +25% (`works-25`) |
| Holding +3 months | PARTIAL | uses +4 (`hold-plus-4`) |
| Interest +2pp where variable | PARTIAL | +3pp single-factor; +2pp only inside compound |
| Combined downside | BUILT | `moderate`/`severe`/`capital-loss` |
| Recompute interest + sale costs per scenario | BUILT | re-runs `appraise()` |
| BTL: gross/net yield + mortgage assumptions separate | PARTIAL | gross yield in matching; no dedicated BTL view |
| Refinance/BRRR/HMO deferred | DECISION | repo implements refinance-and-hold; no BRRR/HMO models |

---

## §8 Matching and deal-pack release

| Requirement | Status | Where / gap |
|---|---|---|
| Hard filter: jurisdiction | BUILT | `matching.ts` hard |
| Hard filter: geography | PARTIAL | locality is a soft preference, not hard |
| Hard filter: price / all-in budget | PARTIAL | purchase-price range only |
| Hard filter: asset type | BUILT | hard |
| Hard filter: strategy | PARTIAL | approximated by structures/appetite |
| Hard filter: funding readiness | MISSING | not a match criterion |
| Hard filter: mandate active | PARTIAL | filtered at call sites, not inside the match |
| Hard filter: compliance status | MISSING | never gates a match |
| Hard filter: seller permission | PARTIAL | protection-block covered; consent-to-introduce not a filter |
| Hard filter: deal release approval | MISSING | no release-approval criterion |
| Evaluate hard filters before ranking | BUILT | `evaluator` zeroes ineligible |
| Ranking weights 30/25/25/20 | MISSING | ad-hoc soft weights, 55–100 band |
| Persist component values and reasons | PARTIAL | computed live; no Match entity persisted |
| Unknown hard-filter data → exclude + task | MISSING | no task path |
| No ranking by vulnerability/protected characteristics | BUILT | by construction (not asserted by a test) |
| Release workflow (draft→approval→clearance→versioned pack→invite) | PARTIAL | agents produce sign-offs; no analyst/compliance split; no versioned pack step |
| Pack: property facts/valuation/costs/scenarios/risks/outstanding checks | BUILT | `memorandum/page.tsx` |
| Pack: actual capacity (agent/principal) | MISSING | not in the pack |
| Pack: fees and payer | MISSING | not surfaced in the pack |
| Pack: known conflicts | MISSING | not in the pack |
| Pack: verified/unverified per-fact flags | PARTIAL | material report shows confidence; memo has no per-fact flag |
| Pack: comparable evidence | MISSING | no comparables engine |
| Pack: inspection status | MISSING | not rendered |
| Teasers hide owner identity and access | BUILT | `reveal.ts:opportunityCard`, `stages.ts:composeTeaser` |
| Access authenticated, time-limited, logged | BUILT | `stages.ts:grantDataRoom` (CSPRNG token, 14-day expiry), `audit("viewed-deal-material")` |
| Seller contact needs a separately authorised introduction | BUILT | `mayApproachSeller`; contact never in the card |
| Freeze the pack version referenced by an invitation | MISSING | memorandum recomputes live every open; no content hash |
| Changed price/facts invalidate approvals, require re-release | MISSING | no content-hash invalidation; **A08 cannot hold** |
| Reservations ≠ acceptance | MISSING | no reservation concept |

---

## §9 Communication automation

| Requirement | Status | Where / gap |
|---|---|---|
| Channel-policy service before EVERY send, with listed inputs | PARTIAL | `notifications.ts:decideChannel` + `outreach.ts:outreachEligibility` re-run at send; not one unified service; missing conversation-state/sender-capacity/local-time inputs |
| Distinguish service reply from marketing | BUILT | `notifications.ts:LawfulBasis` |
| Service reply must not silently enrol marketing | BUILT | `newsletter.ts` double opt-in; `service.ts:handleReply` |
| MVP marketing requires recorded channel-specific consent | BUILT | `newsletter.ts:isMailable`, `notifications.ts` |
| PECR for email/SMS/stored social | PARTIAL | email/SMS modelled; "stored social"/WhatsApp not |
| Example nurture sequence (day 0/1/3/7/14) | MISSING | no sequence engine (newsletter page: "No drip sequence") |
| Caps: 1/24h cross-channel, 5/sequence, 09:00–18:00 Europe/London | PARTIAL | `campaign.ts` caps are different values; window is **09:00–17:00 UTC**, no `Europe/London` |
| Full stop-conditions list | PARTIAL | reply/opt-out/complaint/bounce/DO_NOT_CONTACT covered; booked-call/active-conversation/under-offer/vulnerability-escalation missing |
| Classify free-text opt-outs; STOP webhooks before other jobs | PARTIAL | classification BUILT; no job queue so ordering N/A |
| Reply pauses sequence + owner task | MISSING | no sequence to pause, no task created; **A03 not implemented** |
| Re-enrolment needs a new valid event | MISSING | no enrolment concept |
| AI first-contact rules (identify + automated; can/cannot list) | MISSING | no seller-facing assistant; `agents.ts:FORBIDDEN_ACTS` is a different internal surface |
| Voice/cold-call/live-call deferred | DECISION | no voice channel (consistent with deferral) |

---

## §10 State machines and release gates

| Requirement | Status | Where / gap |
|---|---|---|
| Lead state machine (New→…→Closed) | MISSING | no Lead entity; `DealStatus` has 6 values |
| Deal state machine (Draft→…→Completed) | PARTIAL | `workflow.ts` 12 derived stages, not the named deal states |
| Failed + Withdrawn explicit terminal | PARTIAL | only `withdrawn`; **no `failed`** |
| Jurisdiction alternatives precede expansion | PARTIAL | `jurisdictions/`; not as state-machine variants |
| Transition specifies allowed role | MISSING | no transition layer |
| Transition specifies current version | MISSING | one global `WORKFLOW_VERSION`; no `row_version` |
| Transition specifies required evidence | PARTIAL | evidence gates derivation, not a transition contract |
| Transition specifies timestamp + event | MISSING | no event emission |
| Prohibit client-side status updates | PARTIAL | "derived, never set" (§68) but `DealStatus` is still a stored field |
| Approval applies to a content hash; changes invalidate | MISSING | no content hash |
| Business-enablement gate (HMRC/redress/policies/capacity/terms; agency disabled until resolved) | PARTIAL | AML + redress captured (`accounts.ts`, preflight); no single gate recording policies/capacity/terms and disabling agency |
| CDD stage gates set by compliance owner | PARTIAL | early checks exist (`sellerDueDiligence.ts`); timing not configurable by a compliance owner |

---

## §11 Technical architecture

### Platform

| Requirement | Status | Where / gap |
|---|---|---|
| Modular monolith, TS web + API | BUILT | Next 15, `boundaries.test.ts` layers |
| PostgreSQL with geospatial | PARTIAL | Postgres yes; **no PostGIS/geometry** |
| Durable job queue | MISSING | cron routes + in-process loops |
| Object storage for documents | MISSING | base64 in JSONB |
| Provider adapters | BUILT | billing/stripe, screening, epc, landRegistry, connectors |
| Server-side rules/calculation | BUILT | `src/shared/domain/*` |
| AI gateway; appraisals/permissions/workflow out of prompts | PARTIAL | "out of prompts" well honoured; thin provider seam, not a gateway (no logging/schema/retention) |
| Logical modules (12) | PARTIAL | most present; **CRM and Attribution largely MISSING**; boundaries not formalised as modules |
| Web + workers deployed separately | MISSING | single deployable |
| IaC + dev/staging/prod + managed secrets | PARTIAL | env config + field cipher; no IaC |
| Integrations (address/sold-price/EPC/email/SMS/WhatsApp/calendar/e-sign/identity-AML) | PARTIAL | sold-price + EPC + email only; **MISSING: address resolution, SMS, WhatsApp, calendar, e-signature, identity/AML adapter** |
| No embedded credentials | BUILT | env only; `boundaries.test.ts` |
| Sandbox adapters labelled, can't pass prod approval | PARTIAL | fail-closed exists; no formal sandbox-vs-prod label mechanism |

### Core entities — every table fails the mandatory core-field rule

Store tables are `id text PRIMARY KEY, data jsonb, updated_at`: ids are `text`
not UUID, **no `tenant_id`**, **no `row_version`**, `created_at` only on some,
and **no foreign keys** (JSONB document store), so cross-tenant FK prevention
is not merely absent — the tenancy and relational-integrity premise is.

| Entity | Status | Nearest analogue / gap |
|---|---|---|
| UUID id on all tables | PARTIAL | ids are `text`; many composite/email keys |
| tenant_id on all tables | MISSING | no multi-tenancy |
| created_at + updated_at on all | PARTIAL | inconsistent |
| row_version on all | MISSING | no optimistic concurrency |
| FK prevents cross-tenant | MISSING | no FKs, no tenancy |
| Contact | MISSING | `accounts.ts`/`Subscriber` partial analogues |
| Permission | PARTIAL | `sellerConsent.ts`, Subscriber; no unified entity |
| Suppression | PARTIAL | `Suppression` exists; identifier **not hashed**; no explicit scope |
| Property | PARTIAL | `PropertyFacts` embedded in DealRecord; no geometry/UPRN/own table |
| SellerCase | PARTIAL | `DealRecord`; parties/priorities partial |
| Fact/Evidence | PARTIAL | `MaterialRecord`/`Sourced<T>`; no unified table with observed-time/confidence/reviewer |
| Appraisal | PARTIAL | computed, **never stored**; no evidence IDs/approval/hash |
| InvestorMandate | PARTIAL | `BuyBox`/`FundingBox`; no person/company link, no expiry |
| ComplianceCase | MISSING | states computed, no case persisted |
| Deal/Match | PARTIAL | `MatchResult` computed; `DealFee` stored; match not persisted |
| Conversation/Message | PARTIAL | `OutreachMessage` only; no provider-message-ID; direction implicit |
| Sequence/Job | MISSING | no enrolment/attempts/cancellation entity |
| Offer/Pack | PARTIAL | `DataRoomGrant`/`RecordedOffer`; no immutable version/content hash/approver |
| Transaction | PARTIAL | `Milestone`/`CloseReport` on DealRecord; no own entity |
| Invoice | PARTIAL | `DealFee`; no due-trigger/credit-notes; status only raised/voided |
| AuditEvent | PARTIAL | `AuditEvent` append-only; **no before/after refs, no correlation ID** |

### API contract — the `/v1` tenant-scoped REST contract is absent

Routes live at `src/app/api/**` (billing, cron, outreach, blog, health,
identity, images); none are `/v1`, none carry tenant context, none read an
`Idempotency-Key` header or expected row version, and the spec error-code set
does not exist. Public intake and most mutations are Next server actions.

| Requirement | Status | Gap |
|---|---|---|
| `/v1` namespace | MISSING | none |
| Tenant from authenticated context | MISSING | no tenancy |
| Strict schemas, UTC/ISO, GBP pence, cursor pagination | PARTIAL | pence/ISO yes; **offset not cursor**; no formal request schemas |
| Stable error codes (VALIDATION_FAILED, …, OUTSIDE_COVERAGE) | MISSING | none exist |
| Idempotency-Key + expected row version on mutations | PARTIAL | internal money idempotency only; **no HTTP header read** |
| Transactional outbox + at-least-once workers | MISSING | none |
| Event envelope (event_id/type/subject/tenant/occurred_at/schema_version/correlation_id) | MISSING | no event system |
| POST /public/enquiries (202 + case ref, source token) | PARTIAL | server action; no source-token/202 contract |
| POST /webhooks/{provider} | PARTIAL | billing + outreach only; not generic; no receipt-then-202 |
| GET/PATCH /seller-cases/{id} | MISSING | no endpoint, no optimistic concurrency |
| POST /seller-cases/{id}/transitions | MISSING | no transitions endpoint |
| POST /properties/{id}/appraisals (202 job) | MISSING | computed inline |
| POST /appraisals/{id}/approve (hash, 409 if stale) | MISSING | nearest is `decideProposal` |
| POST /deals/{id}/matches | PARTIAL | computed, not a command |
| POST /packs/{id}/release | PARTIAL | `DataRoomGrant`; no versioned pack |
| POST /messages (policy-controlled) | PARTIAL | `outreach.ts` gate; no endpoint |
| POST /contacts/{id}/opt-out | PARTIAL | immediate suppression yes; no queued-job cancel |
| POST /offers/{id}/issue | MISSING | no issued-offer path |
| POST /transactions/{id}/milestones | PARTIAL | operator actions; not a role-gated command |
| POST /privacy/requests | MISSING | no privacy-request workflow |

---

## §12 AI contracts and guardrails

| Requirement | Status | Where / gap |
|---|---|---|
| Six qualification tools | MISSING | implemented tools are deal-analysis/market-data for narration |
| LLM cannot message / approve offer / query unrestricted contacts | BUILT | no such tool exists; `agents.ts` closed effect set + `FORBIDDEN_ACTS` |
| Qualification output schema | MISSING | no qualification flow |
| Schema validation before persistence | MISSING | no LLM-fact persistence path |
| Citations to message/evidence IDs; reject on missing source | PARTIAL | `provenance.ts` cites source names, not message/evidence IDs |
| Unknown is null, never zero | PARTIAL | principle present generally; no LLM-extraction layer |
| Untrusted data can't change tools/policy | PARTIAL | `extract.ts` extraction-only; no injection defence for a (nonexistent) seller-message flow |
| External URL allowlist | BUILT | `fetcher.ts:SOURCE_HOSTS` |
| Block private-network targets | MISSING | **no RFC1918/loopback guard** (see Concrete bugs) |
| Store prompt version/config/sources/output under retention | MISSING | nothing persisted |
| Masked fixtures | MISSING | none |
| AI acceptance suite | MISSING | none |
| Low confidence / failed schema → human review | PARTIAL | confidence→review in the deterministic path only |
| No model completion probability / guarantee | BUILT | probability is engine-computed, not model-generated |

---

## §13 Security, privacy and reliability

| Requirement | Status | Where / gap |
|---|---|---|
| Tenant isolation tested cross-tenant | MISSING | per-account owner checks only |
| Role checks on every object/action | BUILT | `accounts.ts:can()`, `authorisation.test.ts`, `middleware.ts` + `requireOperator` |
| MFA for staff | MISSING | password + session only |
| Encrypted transport + storage | PARTIAL | field-level AES-256-GCM (`fieldCipher.ts`); HTTPS forced in preflight; not whole-DB |
| Signed expiring document links | PARTIAL | expiring dataroom tokens; no object-storage document links |
| Malware scanning | MISSING | uploads unscanned |
| Secret rotation | MISSING | strength checks only |
| Append-only audit | BUILT | `audit.ts:appendAudit` (best-effort writes) |
| AI tools inherit acting user's scope | PARTIAL | server-authorised + narrow; run with operator context |
| Retention by record class | MISSING | not implemented |
| Legal holds override erasure | MISSING | no erasure workflow |
| Deletion removes provider copies + replays after restore | MISSING | `scripts/backup.ts` only |
| 95% intake routed ≤5 min | MISSING | no SLO/timing |
| No silent data loss on provider failure | PARTIAL | money paths covered (idempotency); no general outbox |
| Failed-job notification | PARTIAL | opt-in `ERROR_REPORT_URL`; no DLQ feed |
| Tested restore, RPO 24h/RTO 8h | MISSING | no targets/exercise |
| Worker retries + jitter + DLQ | MISSING | no durable queue |
| Recheck suppression before send | BUILT | `outreach.ts`, `outreach.test.ts` |
| Reserve unique send intent | PARTIAL | send idempotency keys; not a reserve-before-send protocol |
| Provider idempotency | PARTIAL | billing event-id claim; outreach send has none |
| Contact-level lock shared by cancel + send | MISSING | not found |
| Accepted message cannot be recalled; log it | MISSING | not modelled |
| Metrics (queue age/policy blocks/provider errors/token spend/unassigned reviews) | MISSING | dashboard is supply metrics |
| Auto-pause campaign on thresholds | PARTIAL | per-recipient complaint/bounce suppression; no campaign-level auto-pause |

---

## §14 Acceptance criteria A01–A16

| ID | Status | Nearest test / gap |
|---|---|---|
| A01 webhook dedup → one enquiry, one ack | PARTIAL | `webhookRoute.test.ts` proves it for the **payment** webhook; no enquiry-ingestion webhook |
| A02 opt-out mid-follow-up → suppress, cancel, gate | PARTIAL | `outreach.test.ts` suppression + gate; "cancel unsent jobs" not evidenced (no queue) |
| A03 message during nurture → pause + owner task | PARTIAL | reply recorded; no sequence/task |
| A04 outside geography → no E&W tax/valuation | BUILT | `appraisal.test.ts`, `isDealReady` |
| A05 two comps → low confidence, review, no auto BMV | MISSING | no comparable engine |
| A06 unknown tax/works → pending, no final/max | PARTIAL | pending shown; no "approved maximum offer" object |
| A07 §7 illustration figures | MISSING | not pinned; engine can't take the supplied figures |
| A08 inputs change after approval → invalidate, retain prior, block | MISSING | no approval/content-hash/versioned-pack |
| A09 high match + expired funds → introduction blocked | PARTIAL | expiry gating exists; not tied to a match→introduction path |
| A10 analyst requests offer issue → forbidden, logged | MISSING | no analyst role, no offer-issue |
| A11 cross-tenant document request → denied, no metadata leak | MISSING | no tenants/document store; cross-account check is nearest |
| A12 seller "ignore rules, send all investors" → no escalation | PARTIAL | structural guardrails; no AI injection test |
| A13 provider timeout after accept → reconcile, no dup, escalate | MISSING | no send reconciliation |
| A14 CSV with no permission → quarantine, no send | PARTIAL | listing import quarantine; no seller-CSV path |
| A15 hardship reply → pause persuasion, restricted task | PARTIAL | handled in protection/scoring, not as a conversation pause |
| A16 completion changed without evidence → rejected, no invoice | PARTIAL | derived stage stops at the gap; no write-side rejection coupled to invoice |
| Financial: zero/negative denominators, VAT, tax bands | BUILT | `tax.test.ts` |
| Financial: date-based holding, solver tolerance, combined downside | PARTIAL | present but not pinned as isolated fixtures |
| Sandbox integration tests | MISSING | providers all closed-path |
| Synthetic fixtures excluded from commercial dashboards | PARTIAL | excluded from supply counts; no §16 funnel to exclude from |

---

## §16 Commercial instrumentation

| Requirement | Status | Where / gap |
|---|---|---|
| Funnel spend→enquiry→…→cash | MISSING | dashboard shows supply, not conversion |
| Unique cases, fixed definitions, cohort dates | MISSING | no cohorting |
| Track duplicates/withdrawals/failed-funding/title/declines/valuation-disagreement | MISSING | only `withdrawn` status |
| Cost per completion | MISSING | no cost capture |
| Contribution = revenue net VAT − costs | MISSING | `revenue.ts` streams only |
| Keep agreed fees / recognised revenue / collected cash separate | PARTIAL | `fees.ts`/`ledger.ts`/`revenue.ts` exist; not reconciled as a trio |
| Fee-contract config (capacity/payer/basis/VAT/trigger/cancellation/exclusivity/conflicts/signed) | BUILT | `fees.ts:FeeDefinition`, `SellerAgreement`, `AgentInstruction`, `connectedParty` |
| No guaranteed fee/earnings | BUILT | `supply.ts` (FSMA s.21), `fees.ts` |

---

## §17 Launch decisions requiring named-owner approval

| Requirement | Status | Where / gap |
|---|---|---|
| Named-owner sign-off / decision log | MISSING | enforcement is env/preflight, not a recorded sign-off |
| Acting entity and capacity | PARTIAL | `identity.ts` + preflight; capacity is a disclosure flag |
| Pilot postcodes | PARTIAL | `supply.ts:LAUNCH_REGION` constant |
| Data-provider rights and budget | PARTIAL | rights enforced; budget absent |
| Signed fee terms | PARTIAL | per-deal signature; not a launch gate |
| Jurisdictional compliance gates | PARTIAL | enforced technically; no owner-approval capture |
| Permitted contact channels | PARTIAL | enforced; not a launch toggle |
| Retention schedules | MISSING | also §13 |
| Escalation coverage | MISSING | no config |
| Commercial thresholds | MISSING | messaging caps only |

---

## Concrete bugs found during the audit (independent of the spec)

These are defects worth fixing whatever is decided about the spec:

1. **`fetcher.ts` has no SSRF / private-network guard.** A `candidate-domain`
   source (a funder's or rights-holder's own site) whose hostname resolves to a
   private or loopback address, or is literally `127.0.0.1` / a metadata IP, is
   not blocked. Latent only because egress is blocked in this environment.
2. **`fetcher.ts` follows redirects without re-checking the allowlist.** The
   request uses `redirect: "follow"`, so a 30x from an allowlisted host to an
   unlisted one is followed and its body returned — the comment claims a
   redirect "cannot walk a licensed fetch onto another site", but only the
   initial URL's host is validated.
3. **Outreach business-hours window is `09:00–17:00 UTC`, not the spec's
   `09:00–18:00 Europe/London`.** During BST this sends an hour early and stops
   an hour early; `Europe/London` appears nowhere. A real timezone bug for UK
   recipients regardless of the spec.

---

## Recommended build order — in the existing structure

Everything below fits the current architecture: pure logic in
`src/shared/domain`, server-only in `src/backend`, the store contract behind
`repository`, the docs convention here. Nothing is bolted on in parallel.

1. **Fix the three concrete bugs** (fetcher SSRF guard + redirect re-check;
   outreach window to `Europe/London` 09:00–18:00). Small, self-contained,
   tested against the existing fetcher/campaign suites.
2. **HM Land Registry Price Paid ingestion + comparable evidence** (§7). OGL
   data, no provider contract — a `Comparable` type in `src/shared/domain`, a
   selection/adjustment engine with the 0.5mi/12mo→1mi/24mo rule and the
   <3-comps confidence gate, wired into `opportunityScore`. Unlocks A05/A07 and
   the "trusted source" credibility question.
3. **Identity/AML adapter** (§6/§13). Wire one provider to the existing
   `screening.ts` port, fixture-tested, failing closed without a key — the same
   shape as the Stripe adapter. Needs a provider chosen.
4. **Content-hash pack freeze + approval invalidation** (§8/§10). Hash the
   memorandum inputs at approval; a changed hash invalidates the sign-off and
   blocks release. Unlocks A08 and gives the analyst/compliance split something
   to gate.
5. **Conversational AI intake assistant** (§12). The largest build and the one
   with its own security surface. Reuses `llm.ts` and the agent runtime; every
   extracted fact stays unverified and cited, schema-validated before persist,
   low confidence or vulnerability routed to a human. §14's acceptance suite is
   its guardrail spec.

Deliberately **not** scheduled by default: multi-tenancy (§11/§13) — a business
decision about whether Lode is sold to other firms, which touches every store
query and is not a gap to close on its own.
