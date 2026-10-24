# Launch audit — Cycle 1 (live-instance execution)

**Date:** 2026-10-24 · **RC commit:** `0eaa2c3` · **Branch:** `claude/property-deal-os-a4bclq`
**Environment:** local, against a **real PostgreSQL 16** cluster (ephemeral, port 5433) with the production store engine, app served by `next start` (production build, Next 16.4.3), authenticated with a real operator cookie, driven by a real headless Chromium.

This cycle is the *executable* half of the audit — standing the platform up and attacking it — and complements `docs/PRE-LAUNCH-AUDIT.md` (static/dependency/truth findings). Default verdict is NO-GO; every PASS below was run, not assumed.

---

## What was executed (evidence)

| # | Test | Method | Result |
|---|---|---|---|
| E1 | Postgres contract suite | `TEST_DATABASE_URL=… vitest run` against real PG | **PASS — 1364/1364** (the +64 over the file-store run are the production-engine money-path tests, §55) |
| E2 | Schema bring-up on empty DB | `next start` against fresh `lode` DB | **PASS** — idempotent schema created, `/api/health` → `{"store":"postgres"}` |
| E3 | Seed + write path | `npm run seed` against PG | **PASS** — 4 deals/3 buy boxes/3 funding boxes written |
| E4 | **Encryption at rest** | SQL inspection of `deals.data` | **PASS** — special-category fields stored as `enc.v1.` AES-256-GCM ciphertext, not plaintext (§16) |
| E5 | Unauthenticated auth-gate matrix | 16 gated routes via curl | **PASS** — every gated route **307 → /operator?next=…**; none 200, none 500. `/operator` (sign-in) correctly public |
| E6 | **Full route crawl, authenticated** | project `smoke.ts` in real Chromium, 37 routes | **PASS — 37/37 200**, hydrated, no console errors, no CSP violations, no failed requests |
| E7 | Billing webhook, no/forged signature | curl POST | **PASS** — **401**, not processed (raw-bytes signature check, §27) |
| E8 | Checkout with injected `amount`/`price`/`quantity` | curl POST | **PASS** — **401 "Sign in first"**; client amount never read (§23) |
| E9 | Outreach reply / cron newsletter, no secret | curl POST | **PASS** — **401** both (fail closed, §10/§10-newsletter) |
| E10 | Blog-view counter | curl POST, valid/unknown/oversized/XSS slug | **PASS** — valid→204, unknown→400 (anti-enumeration), oversized→400, `<script>`→400 **not reflected** |
| E11 | Secret leakage to client bundle | grep `.next/static` | **PASS** — no server-secret env names; only the two `NEXT_PUBLIC_` analytics IDs (public by design) |
| E12 | **Novice appraise journey** | real Chromium, 360px, **throttled slow-3G**, messy input | **PASS** — see below |
| E13 | Full `/sell` wizard E2E | real Chromium, stepped drive | **PARTIAL** — see below |

Screenshots retained (redacted, local): `novice_appraise.png` (full appraise result), plus the authenticated route renders.

---

## E12 — Novice appraise journey (Mind 2), in detail

Entered the free appraisal on a **360px phone throttled to slow 3G**, typing amounts the way a real person does — **with commas and spaces**: purchase `250,000`, market `300,000`, refurb `25 000`, rent `1,500`. The classic novice breaker is amounts with separators turning into `NaN`.

Result: a **complete, correct, engine-computed appraisal rendered in ~12s** — headline discount 16.7%, a full cost breakdown (SDLT £11,675, finance £18,705, profit £26,616), an honest bottom line (**−£2,228 after tax**, Red-Team resilience 0/100 for this deliberately-marginal deal), and correctly **no Deal Score** (§57, free appraisal is buyer-side arithmetic only). **No `NaN`/`undefined`/`Infinity`, no console errors, no error state.** The thousands separators were parsed correctly.

Mind-2 observations (non-blocking): the advanced finance fields (hold/LTV/rate) are in a collapsed section (fine — they default), and the result page is very long on a phone, though the headline verdict is at the top.

## E13 — `/sell` wizard E2E (PARTIAL, honestly)

`/sell` is a 5-step accessible wizard (situation → priorities → property → price → screening + consent) using `sr-only` native inputs behind styled labels and client-gated step advancement. Headless brute-force driving did **not** complete the wizard within budget (a mechanics limitation of automating an sr-only multi-step form — **not** a product fault). No seller record was created by my attempts (deal count stayed at 4), consistent with the submit never reaching the final consent step.

Recorded as **PARTIAL**, not PASS. Independent evidence that the write path is sound: encryption-at-rest proven (E4), store writes proven (E3), `/sell` renders cleanly (E6), and the intake→creation→consent→cipher logic is covered by the passing suite (`intake`, `submitEnquiry`, `sellerConsent`, `fieldCipher`). A genuine **Mind-2 finding (P3)**: the wizard has no visible draft-save, so a novice who loses connection mid-wizard loses progress — worth an autosave or "resume" before scale.

---

## The one alarming signal, root-caused

The authenticated crawl first showed **18/37 pages returning 500** (React #441). Traced via server logs to `Error: Unsupported state or unable to authenticate data` in `fieldCipher.decrypt` → `repository.listDeals`. **Root cause: my own harness** — the data was seeded under one `DATA_ENCRYPTION_KEY` and the app started under a different one, so AES-GCM correctly refused to authenticate the ciphertext. Re-seeding under the running key → **all 37 pages 200** (E6).

This is **not a defect**: the decrypt path throws on auth-tag failure *by design* ("a tampered value must fail rather than decrypt to something plausible. These values decide whether a vulnerable seller's deal is blocked"). **No fix made** — swallowing the error would weaken a deliberate security control (prohibited by the audit's §4.3 and CLAUDE.md). One **operational note**: rotating `DATA_ENCRYPTION_KEY` must use the built-in `encrypt:backfill` + `sameKey()` path, never a bare env swap, or every deal-listing surface fails until the data is re-encrypted.

---

## Gate results (this cycle's executable scope)

| Gate | Status | Basis |
|---|---|---|
| 1 Build integrity | **PASS** | deterministic build on `0eaa2c3`; 1364 tests on real PG |
| 2 Truth & fitness | **PASS (desktop/mobile render) / PARTIAL (sell E2E)** | truth audit (prior) + E12; novice reaches appraise value unaided on a throttled phone |
| 3 Critical functionality | **PASS (render + appraise) / PARTIAL (sell write E2E)** | E6, E12, E13 |
| 4 Security | **PASS on tested surface** | E5,E7–E11 (no auth bypass, fail-closed money/webhook/cron, no secret leak, no XSS reflection). Full external pentest NOT run |
| 5 Data integrity | **PASS** | E1 (PG contract suite incl. tenant isolation + atomic money), E4 (encryption at rest) |
| 6 Financial integrity | **PARTIAL** | webhook/checkout fail-closed proven (E7,E8); live Stripe flow **NOT TESTABLE** without sandbox keys |
| 7 Performance/load | **NOT TESTED** | needs load tooling + a target env |
| 8 Reliability/DR | **NOT TESTED** | needs failure injection against real infra |
| 9 Observability | **NOT TESTED** | no monitoring configured (`ERROR_REPORT_URL` unset) |
| 10 Privacy/compliance | **PARTIAL** | encryption at rest proven; live deletion-across-providers NOT run |
| 11 Operational readiness | **BLOCKED** | needs humans (support, incident, account ownership) |

---

## Verdict (Cycle 1)

**NO-GO for unrestricted public launch.** Not because an executable gate failed — on the surface I could reach, the platform held up well and **no new code defect was found** (the one scary signal was my harness). It is NO-GO because the gates that decide a real public launch — live payments, performance, reliability/DR, observability, full privacy — **cannot be earned without operator-supplied credentials, infrastructure and business decisions**, and those are also the 10 preflight blockers. Per the loop's termination rule #3, that is an honest NO-GO with a Human Action List, not a thrash.

The executable evidence **raises** confidence in the code itself: real Postgres, real encryption, fail-closed money/auth/webhook boundaries, a clean 37-route render, and a working novice value path on a throttled phone. See `human-actions.md` for exactly what unblocks the rest; the moment those are supplied, the untested gates (payments, load, DR, observability, privacy-deletion) can be executed and re-scored.
