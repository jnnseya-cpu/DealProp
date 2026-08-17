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
| Pages | `src/app` | Renders. **Never computes a figure.** |
| Shared UI | `src/app/components/chrome.tsx` | Mark, header, verdict vocabulary, score colours |
| Store | `src/store/repository.ts` | File-backed JSON. No domain logic. |
| Domain | `src/domain` | Pure, framework-free, fully tested |
| Money | `src/lib/money.ts` | Integer pence, branded types. Depends on nothing. |
| Formatting | `src/lib/format.ts` | Pure. Imported by domain — **no Tailwind here.** |

Stack: Next.js 15 (App Router, server components), React 19, TypeScript strict,
Tailwind v4, Vitest. No auth, no database, no payments, no external APIs.

**Dependency rule:** arrows point downward only. `src/domain` imports nothing
from `src/app` or `src/store`.

**Single-source rule:** `runDealDirector()` returns one coherent position and
the page renders it. This is why the score, the memorandum and the
seller-facing options cannot disagree.

### Built and working — do not rebuild

`src/domain/` (17 files): `types`, `newsletter`, `economics`, `motivation`, `protection`,
`redteam`, `dealScore`, `capitalStack`, `strategies`, `goldmine`, `matching`,
`completion`, `revenue`, `director`, `intake`, `sellerRoutes`, `workingDeal`.

`src/domain/jurisdictions/`: `types`, `index`, `profitTax`, `gb-eng`, `gb-sct`,
`us-gen` (GB-NIR and GB-WLS derive from gb-eng in `index`; both US-GEN and
GB-WLS are excluded from `isDealReady`).

Pages: `/` landing, `/sell` intake, `/sell/[id]` seller options, `/deals`
pipeline, `/deals/[id]` Deal Room, `/newsletter` (+ confirm, unsubscribe).
API: `/api/cron/newsletter` weekly send, secret-protected and idempotent.

154 tests in `tests/`. All pass. Build succeeds. All routes return 200.

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
11. **Engines are deterministic.** LLMs belong at the edges proposing
    structured values — never deciding a score or clearing a flag.

### Outstanding

- `/invest` and `/capital` — Buy Box / Funding Box CRUD. Last marketplace.
- Investment Memorandum — print view of the same briefing.
- Postgres — once concurrent writes are real.
- Auth + investor categorisation — required before deal material reaches a
  private investor (`docs/REGULATORY.md` §2).
- GoldMine adapter — **only** after a licensed data source exists. Do not scrape.

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
npx vitest run       # 154 tests
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
