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
`fundingReadiness`, `regulatoryRoute`, `outreach`.

`src/shared/domain/jurisdictions/`: `types`, `index`, `profitTax`, `gb-eng`, `gb-sct`,
`us-gen` (GB-NIR and GB-WLS derive from gb-eng in `index`; both US-GEN and
GB-WLS are excluded from `isDealReady`).

Pages: `/` landing, `/appraise` free no-signup appraisal, `/partners` agents,
professionals and capital, `/sell` intake, `/sell/[id]` seller options, `/deals`
pipeline, `/deals/[id]` Deal Room, `/deals/[id]/agents` agent board,
`/deals/[id]/memorandum` print pack,
`/invest` Buy Boxes, `/capital` Funding Boxes, `/newsletter` (+ confirm,
unsubscribe), `/operator` sign-in.
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
three licensed sources. Candidates are quarantined at `/operator/discovery`; outreach is drafted,
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

772 tests in `tests/` (810 with Postgres). All pass. Build succeeds. All routes return 200.

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

### Outstanding

- Payments. Nothing charges anybody; `revenue.ts` models it and stops there.
- GoldMine live import — parsers exist and are fixture-tested; no live call has
  been made (egress blocked in the build environment). Verify before relying.

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
- **One eyebrow style, `.eyebrow`, and it is grey.** A gold uppercase label on
  every panel is not emphasis, it is a background colour that spells words.
- **A notice is a 2px left rule, not a tinted box.** A filled coloured rectangle
  says the same thing at fifty times the area and buries the sentence.

### Handle all UI states
Loading, success, empty, error, disabled, permission-denied. Responsive at
mobile, tablet, laptop, desktop. Semantic HTML, labels, keyboard navigation,
focus states, contrast.

### Test what you change
```bash
npx tsc --noEmit     # types
npx vitest run       # 772 tests
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
