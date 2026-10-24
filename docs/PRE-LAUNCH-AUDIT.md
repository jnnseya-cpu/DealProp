# Pre-launch production-readiness audit — Lode

**Date:** 2026-10-24 · **Branch:** `claude/property-deal-os-a4bclq` · **Target launch:** Sun 2026-10-25

This is the result of a repository-wide production-readiness pass run against the
framework in the launch brief: inspect → diagnose → fix → verify → harden, with
no cosmetic deletion and no dependency churn against a green build. Every "PASS"
below was executed, not assumed. Nothing here is marked ready on the strength of
the app merely compiling.

A deliberate scope call was made for launch eve: **no blind mass-deletion of
"duplicate" files and no speculative dependency upgrades.** The tree was audited
and found already single-source-of-truth; the only dependency changes made were
the ones that close a *verified* security hole, each re-verified against the full
build and test suite.

---

## 1 · Production readiness status

**CODE: READY. DEPLOYMENT: BLOCKED ON OPERATOR-SUPPLIED CONFIGURATION (by design).**

There are **zero code-level blockers**. The platform typechecks clean, all 1,300
tests pass, the production build is clean on the patched framework, and the
production dependency tree has **zero known vulnerabilities**.

The preflight gate reports `NOT READY` for exactly 10 items, and **all 10 are
environment/identity values that only the operator can set** (secrets to
generate, a database to provision, and six statutory company-identity fields that
must be real — a placeholder company number is a false statement of identity, not
a missing one). These are the deploy-day steps already written up in
`docs/LAUNCH-ENV.md` and `docs/DEPLOY-TOMORROW.md`. None can or should be set by
an automated agent.

---

## 2 · Technology stack identified

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 16.4.3** (App Router, React Server Components) | Was 16.3.4; patched for a critical RCE this audit. (CLAUDE.md still says "15" — doc drift, see §15.) |
| UI runtime | **React 19.0.0 / react-dom 19.0.0** | |
| Language | **TypeScript 5.7.3**, `strict` | No `any`/`@ts-ignore` permitted by directive; verified clean. |
| Styling | **Tailwind v4** (`@tailwindcss/postcss`) | Tokens in `globals.css`, self-hosted fonts via `next/font`. |
| Tests | **Vitest 4.1.11** | 1,300 pass + 1 Postgres-only skip without `TEST_DATABASE_URL`. |
| Database | **PostgreSQL** via `pg` 8, or a **JSON file store** | `DATABASE_URL` decides; both pass the same contract suite. |
| Auth | **Hand-rolled** operator credential (scrypt, params-in-hash) | No third-party auth SDK by design. |
| Payments | **Stripe**, via a raw-HTTP adapter (`stripe.ts`) | No SDK; webhook verified over raw bytes. |
| Runtime | **Node 22.23.4** (`engines >=22.23.4 <23`) | Matches the Hostinger security advisory's fixed version. |
| Package manager | **npm** (single `package-lock.json`) | No competing lockfiles. |
| Hosting | **Docker `output: "standalone"`** (VPS) or **Vercel** | Both configs present and coherent. |

The dependency tree is deliberately minimal — runtime deps are only `next`, `pg`,
`react`, `react-dom`. Most capabilities normally pulled from SDKs (auth, payments,
email, storage) are implemented in-repo, which is why the vulnerability surface is
small.

---

## 3 · Architecture summary

Three layers with a one-way dependency rule enforced by a test
(`tests/boundaries.test.ts`): `src/app` (render only, never computes a figure) →
`src/shared/domain` (pure, deterministic engines, fully tested) → `src/backend`
(server-only: store, auth, sources, billing, outreach). A client component that
imports `@backend/*` fails the boundary test, which is what keeps server code and
secrets out of the browser bundle. `src/shared/money.ts` holds integer-pence
branded `Money`; `src/shared/format.ts` is pure formatting. One run of
`runDealDirector()` returns one position that the score, memorandum and seller
options all render, so they cannot disagree.

---

## 4 · Files removed / consolidated

**None removed; none needed removing.** The tree was audited for duplicate,
conflicting and obsolete files and found already clean:

- **One config per domain:** a single `next.config.mjs`, `tsconfig.json`,
  `vitest.config.mts`, `postcss.config.mjs`, `package-lock.json`, `Dockerfile`,
  `vercel.json`. No duplicate or nested config anywhere below the top level.
- **No backup/experimental cruft:** no `*.bak`/`*.old`/`*.orig` files (the only
  "copy"-named file is `tests/publicCopy.test.ts`, a legitimate test).
- **No committed secrets:** only `.env.example` is tracked; no real `.env`.
- **No orphaned production modules:** a whole-tree scan of every `.ts/.tsx` under
  `src/` (basename + exported symbols grepped across `src`, `tests`, `scripts`)
  found zero unreferenced production files. The only two "unwired" modules —
  `src/shared/domain/listingData.ts` and `src/backend/screening.ts` — are
  deliberate, test-covered seams built ahead of their integration (the screening
  port is *required* by CLAUDE.md §80 to exist and fail closed). They are
  intentional, not cruft, and were kept.
- Apparent redundancies (two store engines, three security layers, Wales deriving
  from England, `backend/X` vs `shared/domain/X` IO-vs-pure splits) are deliberate
  and documented, not duplication — removing them would be a regression. Per the
  launch-eve scope call, nothing was deleted.

---

## 5 · Dependencies changed

Exactly three, all to close a verified security hole (see §10), none a
speculative upgrade:

- `next` **16.3.4 → 16.4.3** (same major; critical RCE fix).
- Added `overrides`: `sharp` **^0.35.5**, `source-map-js` **^1.2.2** (pin two
  vulnerable transitives without upgrading their parents).

`npm audit --omit=dev` → **0 vulnerabilities** after the change. Lockfile
regenerated cleanly via `npm install` (`npm audit fix` itself errors on this
tree — an npm resolver bug — so the fix was applied explicitly).

---

## 6 · Build issues fixed

None outstanding. The production build (`next build`) completes clean on the
patched framework; all routes compile; middleware builds; `tsc --noEmit` is clean.
Re-verified after the dependency change.

---

## 7 · Functional issues fixed

None required. A repository-wide functional audit (every page, route, button,
form, handler, API route, and the seed path) found **zero production-facing dead
UI, zero placeholder/fake data rendered to users, and zero orphaned API routes.**
Every `<form>` has a real action/handler; every `<button>` is a wired submit or
has a real handler; all 9 API routes under `src/app/api/**` have a caller or a
documented external caller (Stripe/mail webhooks, cron). The one place demo data
exists (`src/backend/store/seed.ts`) is labelled illustrative and fenced off from
any non-local `DATABASE_URL` by `seedSafety()` (see §14).

---

## 8 · Authentication & authorisation status

**PASS (architecture) / deploy-gated (secret).** Operator access fails closed
without `OPERATOR_SECRET` (middleware returns 503, confirmed by preflight), and is
enforced twice — middleware matcher plus a per-page `requireOperator()` — because
Next has shipped middleware-bypass advisories before. Permission decisions are
made in exactly one place, `accounts.ts` `can()`. Passwords use scrypt with
parameters stored in the hash (`scrypt$N$r$p$digest`). Seller links are CSPRNG
capability URLs. Deal material requires a current certification, not just a login,
and investors/funders never hold `view-seller-data`. The scrypt sign-in path is
rate-limited (`rateLimit.ts`, fail-open, per-process by design).

---

## 9 · Database & storage status

**PASS (code) / deploy-gated (provisioning).** `DATABASE_URL` selects Postgres
(`pg`) or the JSON file store; both pass the same contract suite. The file store
is correct for single-instance/dev and wrong for multi-instance — preflight blocks
launch until `DATABASE_URL` is set. Numbered, transactional, recorded migrations
live in `migrations/`. The file store is excluded from the Docker image
(`outputFileTracingExcludes`). The Postgres engine is the production one and is
tested against a real Postgres (the `test:pg` script / CI service) because two
money bugs once lived only there.

---

## 10 · Security hardening completed

- **Patched a critical framework RCE:** `next` 16.3.4 fell in the vulnerable
  `16.0.0–16.4.0` range (RCE in `next/og ImageResponse`). `next/og` is not used in
  app code, so it was not directly reachable, but the framework was patched to
  16.4.3 regardless.
- **Closed two high-severity transitives:** `sharp` (<0.35.5, librsvg
  CVE-2026-96889) and `source-map-js` (1.0.0–1.2.1, DoS), pinned via `overrides`.
- **Production dependency tree: 0 vulnerabilities.** The 5 remaining advisories
  are all dev-only test/build tooling (`vitest`/`vite`/`tsx`/`esbuild`/
  `launch-editor`) that never ships to the running server — documented
  non-blocking in §15.
- **No secret leakage to the client:** scanned the built client bundle
  (`.next/static`); no server-secret env names present — only the two
  `NEXT_PUBLIC_` analytics identifiers, which are public by design.
- **Standing controls verified present:** server/client boundary test; billing
  webhook verified over raw bytes, claimed once, type-allowlisted,
  amount-checked; payout hold with recipient verification; tax fails closed
  outside the UK.

No claim is made that the platform is "unhackable." It applies defence-in-depth,
least-privilege and fail-closed defaults, and the realistic-attack surfaces
checked above are hardened.

---

## 11 · End-to-end tests completed

- **1,300 tests pass**, 1 skipped (Postgres-only, runs in CI with a Postgres
  service / `TEST_DATABASE_URL`). 75 test files.
- `tsc --noEmit` clean; `next build` clean — both re-run after the dependency
  change.
- Public routes render in a real headless browser at 200 (verified for
  `/how-it-works` this session; the project `smoke.ts` drives the full public +
  gated route list in a browser and asserts hydration + no console/policy errors,
  to be run against the deployed origin with `OPERATOR_SECRET` set).

Not independently run here (require live credentials/origin): real Stripe checkout
→ webhook → ledger, real email delivery, real discovery provider verification.
These are credential-gated, not code-gated — see §16/§17.

---

## 12 · Mobile / PWA readiness

**PASS.** Installable PWA; `src/shared/pwa.ts` is the single source for
devices/icons/colours, with a test pinning splash colours to the `globals.css`
tokens. Safe-area insets consumed by `.app-header`/`.app-safe-bottom`. The service
worker caches nothing data-bearing (so a stale Deal Score is never served as
current). Preflight confirms every declared icon and splash asset is present.
Layouts are responsive to phone width by directive. GO for PWA install;
native/hybrid wrapping is not required for launch.

---

## 13 · Deployment status

**NOT YET DEPLOYED — deployment is the operator's step and needs credentials.**
Both targets are configured and coherent: Docker `output: "standalone"` with a
3-stage `node:22.23.4-alpine` build, non-root runtime user, and a `/api/health`
healthcheck (VPS); and `vercel.json` crons (Vercel). For the Hostinger VPS, crons
come from the host crontab (`docs/DEPLOY-HOSTINGER.md` §8, `docs/crontab.example`)
since `vercel.json` crons only fire on Vercel. Follow `docs/DEPLOY-TOMORROW.md`
step by step; `scripts/proxy-setup.sh` prints the exact reverse-proxy + TLS block
for whichever web server already fronts the box, changing nothing itself.

---

## 14 · Dummy / test data removed

**Nothing to remove; already isolated.** The only seeded content
(`src/backend/store/seed.ts`: 4 demo deals, 3 buy boxes, 3 funding boxes) is
labelled illustrative and guarded by `seedSafety()` — it refuses to run against
any non-local `DATABASE_URL` unless an explicit destructive override is set, and
both the exported `seed()` and the CLI entrypoint enforce it (covered by
`tests/seedGuard.test.ts`). Subscribers/accounts/audit are seeded empty by design
(nobody enrolled without recorded consent). No lorem ipsum, fake metrics, test
credentials, or placeholder figures render in the app — every figure routes
through the engine.

---

## 15 · Known non-critical issues

1. **Dev-only dependency advisories (non-shipping):** 5 advisories remain in
   `vitest`/`vite`/`tsx`/`esbuild`/`launch-editor`. These are test/build tooling,
   absent from the production server. Bumping them (e.g. `tsx` → 4.23.15, vitest
   → latest 4.x) is safe to do *after* launch, when a test-tooling regression
   can't threaten the launch window. Deferred deliberately.
2. **Doc drift:** `CLAUDE.md` and parts of the docs say "Next.js 15"; the repo is
   on 16.4.3. Cosmetic; worth a one-line fix post-launch.
3. **Wales (`GB-WLS`) capped, not deal-ready:** intentional — its Land Transaction
   Tax tables are not verified, so deals there are capped rather than transacted.
   Surfaced honestly on the new coverage map.
4. **Deploy-doc overlap (housekeeping):** `docs/` now holds several overlapping
   deploy guides (`DEPLOY-HOSTINGER.md`, `DEPLOY-TOMORROW.md`, `GO-LIVE.md`,
   `LAUNCH-ENV.md`, `DAY-ONE-CHARGING.md`, `PRODUCTION-READINESS.md`). No code
   risk; a candidate for post-launch consolidation if you want one canonical
   runbook.
5. **Two naming near-collisions (cosmetic):** `backend/agent/` (LLM runtime) vs
   `backend/agents/` (§12 decision service), and two unrelated
   `configuredProvider` exports (`@backend/llm` vs `@backend/screening`). Both are
   genuinely distinct; the names are just close. Rename post-launch if desired.

---

## 16 · Remaining blockers (all operator-supplied configuration)

From `npm run preflight` — **10 blocking, every one a value only you can set:**

1. `OPERATOR_SECRET` — `openssl rand -base64 32`.
2. `DATA_ENCRYPTION_KEY` — `openssl rand -base64 32` (keep it recoverable and off
   the database host; it protects special-category seller data).
3. `DATABASE_URL` — provision Postgres.
4. `NEXT_PUBLIC_SITE_URL` — `https://lodeprop.com`.
5–10. **Company identity (statutory, must be real):** registered legal name,
   company number, place of registration, registered office, ICO registration,
   contact address. The preflight refuses placeholders by design.

These are code-complete and fail closed until set. Setting them is the first part
of `docs/LAUNCH-ENV.md`.

---

## 17 · Required external actions

To move from "turns on" to "fully transacting," in priority order:

- **Stripe live keys + webhook secret** (`BILLING_API_KEY`,
  `BILLING_CHECKOUT_URL`, `BILLING_WEBHOOK_SECRET`) — until set,
  `/api/billing/checkout` authorises then returns 503 and no sale completes. The
  adapter is written and tested end-to-end.
- **Email transport** (`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`) +
  `CRON_SECRET` — newsletter, outreach and opt-out actioning.
- **Transaction-fee permissions** (`HELD_PERMISSIONS` as `key:evidence` pairs) —
  only with real HMRC AML / redress / FCA authorisations; a bare key grants
  nothing. Subscriptions and AI credits earn regardless.
- **Free data keys** (EPC, Gazette notice codes) for off-market discovery;
  Companies House / FCA keys for funder verification.
- **An identity/sanctions screening provider** — none wired; every check is
  inconclusive until one is, and operators record manual checks. Honest but
  doesn't scale.
- **Monitoring sink** (`ERROR_REPORT_URL`) — recommended before taking money.

All are credentials/infrastructure/business decisions, not code gaps.

---

## 18 · Final production-readiness conclusion

**The code is production-ready. The deployment is not yet done, and cannot be
completed by me, because it requires your real secrets, a provisioned database,
and your statutory company identity.**

What this audit changed: it found and fixed a **critical Next.js RCE** (plus two
high transitives) and re-verified the whole build/test chain on the patched
framework — a real, shipping-severity defect closed before launch. Everything else
it touched, it verified was already sound: a clean single-source-of-truth tree,
no dead UI, no fake data, no leaked secrets, fail-closed auth/billing/tax, an
isolated seed path, a coherent dual deploy config.

The honest bottom line for Sunday: work through `docs/LAUNCH-ENV.md` and
`docs/DEPLOY-TOMORROW.md` to set the 10 blocking values and the external
credentials you hold, run `npm run preflight` until it says `READY`, deploy the
Docker image, then run `scripts/smoke.ts` against the live origin. The platform
will then be live and transacting to the extent your connected providers allow —
with the known framework vulnerability already closed rather than shipped.
