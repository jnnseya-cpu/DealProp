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

`src/shared/domain/` (28 files): `types`, `newsletter`, `economics`, `motivation`, `protection`,
`redteam`, `dealScore`, `capitalStack`, `strategies`, `goldmine`, `matching`,
`completion`, `revenue`, `director`, `intake`, `sellerRoutes`, `workingDeal`,
`partners`, `sources`, `registrySignal`, `accounts`, `blog`, `analytics`, `seo`,
`pricing`, `entitlements`, `ledger`, `charging`.

`src/shared/domain/jurisdictions/`: `types`, `index`, `profitTax`, `gb-eng`, `gb-sct`,
`us-gen` (GB-NIR and GB-WLS derive from gb-eng in `index`; both US-GEN and
GB-WLS are excluded from `isDealReady`).

Pages: `/` landing, `/sell` intake, `/sell/[id]` seller options, `/deals`
pipeline, `/deals/[id]` Deal Room, `/deals/[id]/memorandum` print pack,
`/invest` Buy Boxes, `/capital` Funding Boxes, `/newsletter` (+ confirm,
unsubscribe), `/operator` sign-in.
Access control: `src/middleware.ts` gates `/deals`, `/invest`, `/capital`,
`/account` behind either credential and fails closed without `OPERATOR_SECRET`.
`src/app/operator/guard.ts` is the per-page lock; `src/shared/domain/accounts.ts`
`can()` is the only place a permission decision is made.
API: `/api/cron/newsletter` weekly send, secret-protected and idempotent.
PWA: installable, `src/shared/pwa.ts` is the single source for devices/icons/colours.
Assets regenerate with `npm run pwa:assets` — never hand-edit `public/`.
Go-live: `docs/GO-LIVE.md` is the runbook; `npm run preflight` is the gate and
exits non-zero on blockers. `/api/health` is the platform health check.
Go-to-market: `docs/GO-TO-MARKET.md` is the source; `npm run docs:pdf`
renders `docs/GO-TO-MARKET.pdf` — never edit the PDF by hand.
Money: `pricing.ts` owns every price, plan limit and tax decision — nothing else
may state one, and `revenue.ts` derives its published tiers from it.
`ledger.ts` holds prepaid balance as lots; `entitlements.ts` derives what a plan
grants; `charging.ts` decides whether a charge may happen. `/api/billing/webhook`
is the only inbound money path and fails closed without `BILLING_WEBHOOK_SECRET`.
`/operator/billing` shows every account's position, computed from the ledger.
Analytics: Meta Pixel and Google Tag load from `src/app/components/Analytics.tsx`
only, gated on a configured ID, granted consent, an allowlisted route and a known
event. `src/shared/domain/analytics.ts` decides where and what; `src/shared/consent.ts`
decides whether; `src/shared/eventQueue.ts` holds events until the vendor scripts
exist. Blog opens are counted independently at `POST /api/blog/view` and shown
with the SEO audit (`src/shared/domain/seo.ts`) at `/operator/blog`.

458 tests in `tests/` (459 with Postgres). All pass. Build succeeds. All routes return 200.

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
30. **Engines are deterministic.** LLMs belong at the edges proposing
    structured values — never deciding a score or clearing a flag.

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
Reuse `chrome.tsx`. Do not invent new colours, buttons, cards, headers or
spacing. The platform must look like one product.

### Handle all UI states
Loading, success, empty, error, disabled, permission-denied. Responsive at
mobile, tablet, laptop, desktop. Semantic HTML, labels, keyboard navigation,
focus states, contrast.

### Test what you change
```bash
npx tsc --noEmit     # types
npx vitest run       # 458 tests
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
