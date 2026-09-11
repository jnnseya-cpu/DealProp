# Production readiness

What is ready, what is not, and what cannot be made ready from inside this
repository. Written to be argued with rather than believed.

Last verified: see `git log` for this file. Every figure below was produced by
running the thing, not by reading the code.

---

## The short answer

**The platform is build-stable, security-hardened and deployable.** It is not
yet *transactable*, and the difference is entirely external credentials rather
than code.

| | |
|---|---|
| Typecheck | clean |
| Tests | 1,170 passing, both store engines, with and without an encryption key |
| Production build | clean |
| Browser smoke test | 25 pages, no console errors, no policy violations, no failed requests |
| Responsive | no horizontal overflow at 375, 393, 768 or 1280px |
| Dependency audit | **0 vulnerabilities in production dependencies** |
| Preflight, configured correctly | **0 blockers**, 15 to review |

The 15 to review are all "a credential is not set, so this feature refuses
rather than guessing". That is the designed behaviour, and each one is listed
below with what it costs.

---

## A note on the brief

Several of the instructions this work responded to assumed a Firebase stack —
`firebase.json`, `.firebaserc`, Firebase App Hosting, Firebase Auth, Firestore
and Storage security rules.

**There is no Firebase in this repository and never has been.** No config, no
SDK, no dependency, no import. The actual stack is:

| Assumed | Actual |
|---|---|
| Firebase App Hosting | `output: "standalone"` + `Dockerfile`, or Vercel (`vercel.json`) |
| Firebase Auth | scrypt password hashing (`src/backend/auth/password.ts`), HMAC-signed session cookies, a shared operator secret |
| Firestore / Storage rules | Postgres or a JSON file store behind one contract; access decided by `middleware.ts`, `guard.ts` and `accounts.ts` `can()` |
| Firebase security simulator | `tests/authorisation.test.ts`, which walks every server action and API route |

Migrating to Firebase would be a rewrite of the persistence, auth and hosting
layers, not a configuration change, and nothing in the codebase suggests
anybody intended it. The work was therefore done against the stack that exists.
If Firebase is genuinely wanted, that is a separate project and it should be
costed as one.

---

## What was fixed

### Data loss (P0)

`seed()` called `replaceAll()` on every table with no guard. One `npm run seed`
in a shell carrying the production `DATABASE_URL` destroyed every deal,
account, ledger entry, payout and audit event, from a command whose name
suggests it adds something. `seedSafety()` now refuses anything that is not
demonstrably a local host, with an override that has to be typed out in full.

### A critical remote code execution

`next@15.5.23` carried an unauthenticated RCE in the Image Optimization API.
Patched, then upgraded to Next 16 — the only fix for the high-severity `postcss`
advisory bundled inside Next's own tree — and verified end to end rather than
assumed.

`next/image` is imported nowhere in this codebase, so `/_next/image` was pure
attack surface: an endpoint every visitor could reach, decoding attacker-supplied
images through libvips and libheif. It is disabled and now returns 404.

### A script-element breakout

`JSON.stringify` does not escape `<`. An HTML parser inside a `<script>` stops
at the first `</script` whatever the JSON context, and every structured-data
block on a blog post is built from the deal record the agent wrote it from — so
the path ran from the public enquiry form, through the store, into a script
element on a public page. `jsonLdScript()` escapes it; a test refuses a bare
`JSON.stringify` in a `dangerouslySetInnerHTML`.

### Content-Security-Policy

Deliberately in two halves, because one policy cannot be right for both kinds
of page here:

- **Public pages** get a baseline closing `object-src`, `base-uri`,
  `frame-ancestors`, `frame-src` and `form-action`, with `default-src 'self'`.
  `script-src` there tolerates Next's inline bootstrap. That is the honest cost
  of static rendering — a nonce is per-request and a prerendered page is one
  document served to everybody — and it is stated rather than hidden.
- **Operator, account and deal surfaces** — the pages holding seller screening
  answers, dynamic already — get a per-request nonce with `'strict-dynamic'`.

Verified in Chromium: zero violations on 25 pages, and the nonce in the header
matches the one on the scripts.

### Encryption at rest

Seller narratives, screening answers (health and capacity concerns, reported
financial distress), the seller's situation, and due-diligence evidence naming
executors were all stored in plaintext. AES-256-GCM now, keyed from
`DATA_ENCRYPTION_KEY`, applied by wrapping the store so both engines are
covered by one piece of code.

**This is not end-to-end encryption and is not described as such anywhere.**
The server decrypts on every request because the product is arithmetic over
these fields — Seller Protection reads the screening answers to decide whether
a deal is blocked. It defends against a copy of the database leaving the
building, which is the realistic threat. It does not defend against an attacker
who owns the running process. See "What cannot honestly be claimed" below.

### Authorisation, proven rather than asserted

All 53 server actions reach an authorisation call, or are recorded as public by
design with a written reason. A test enforces it, and deliberately does **not**
count rate limiting as authorisation — a limiter bounds abuse, it does not
decide who may act.

### Mobile

`/operator/billing` ran 33px past the right edge of a phone, because the
operator navigation was hand-written on eight pages as a non-wrapping flex row.
One shared component fixed the overflow and the drift together — an operator on
`/operator/discovery` previously could not reach `/operator/payouts` without
typing the URL.

---

## What is not ready, and why

Each of these is a credential or a commercial decision. None is a code defect.

| Blocked on | Consequence today | Remediation |
|---|---|---|
| Payment provider keys | `/api/billing/checkout` authorises then returns 503. Nothing can be sold. | The Stripe adapter is written and tested end to end against a signed delivery. Set `BILLING_CHECKOUT_URL`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`. |
| Connect account | `makePayout()` records payouts as failed, which is the safe state. | Same provider, payouts permission. |
| HMRC AML supervision + redress scheme | `dealRevenue()` excludes all six permission-gated streams. The seller fee cannot be charged. | Register, then record as `key:evidence` in `HELD_PERMISSIONS`. Recording it does not grant it. |
| Identity and sanctions provider | Every screening check returns *inconclusive*, which clears no gate. Operators record manual checks. | `screening.ts` is the port; an adapter is unwritten. Honest, and it does not scale. |
| Email transport | Newsletter and outreach write to the server log instead of sending. | `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`. |
| Companies House / FCA Register keys | No funder can be verified; candidates stay `PARTIALLY_VERIFIED` and none may be approved for outreach. | Both keys are issued against accepted terms, and that acceptance *is* the licence. |
| HM Land Registry title reader | `lookupOwner()` is fully tested against a fixture; nothing passes a real one. | Waiting on a licensed endpoint, not on code. |
| Error reporting sink | Failures go to stderr and nowhere else. A payout that did not send announces itself by being noticed later. | `ERROR_REPORT_URL` — anything that accepts a JSON POST. |
| GB-WLS tax tables | Welsh deals are capped rather than transacted. | Implement and date the pack, with pinned tests, as the others are. |

---

## What cannot honestly be claimed

**"Hacker-impenetrable" is not a state software can be in**, and any report
saying otherwise is describing a wish. What can be said is specific:

- Zero known vulnerabilities in production dependencies, today, against the
  advisory database as it stands today. That changes without anybody touching
  the code, which is why `npm audit` belongs in CI rather than in a report.
- The injection classes a web application controls are closed: no `<script>`
  breakout, a CSP on every response, no unused image decoder on the request
  path, parameterised queries, authenticated encryption, `httpOnly`/`secure`/
  `sameSite` cookies, scrypt at OWASP's cost with the parameters stored
  alongside the hash.
- No penetration test has been performed. No third party has looked at this.
  An adversarial review by somebody who did not write it is worth more than
  everything in this document, and it has not happened.

**End-to-end encryption is architecturally incompatible with this product.**
E2EE means the server cannot read the data. This platform's entire function is
computing over seller data on the server: Seller Protection blocks a deal
because of what the screening answers say, the Deal Score depends on the
motivation diagnostics, and the matching engine reads the situation. A version
where only the seller's browser held the key could not score, match, protect or
introduce anything. What has been built instead — field-level encryption at
rest, against the threat that actually materialises — is the correct control,
and calling it E2EE would be a lie that made a future reviewer's job harder.

**A live production URL cannot be produced from here.** Deploying needs
credentials for a host, a provisioned Postgres, and DNS — none of which exist in
this environment and none of which should be created by an agent on somebody's
behalf. The artefacts are ready: `Dockerfile`, `output: "standalone"`,
`vercel.json`, and `npm run preflight` as the gate. `docs/GO-LIVE.md` is the
runbook.

---

## Mobile packaging: go / no-go

**Go, as a PWA. No-go for a native wrapper yet.**

Ready: installable manifest, icons and splash images for 11 device classes,
safe-area insets consumed by the header and the bottom bar, a service worker
that caches nothing data-bearing (a cache-first worker would serve a stale Deal
Score as current), no horizontal overflow at any tested width, and session
cookies that persist correctly in a standalone context.

Not ready, and these are the blockers rather than opinions:

1. **No payment path.** An App Store or Play submission of a product that takes
   money needs the money to work first, and it also raises the question of
   whether the platform's fees are "digital goods" for store-commission
   purposes. That is a commercial question, not a technical one.
2. **Push notifications are not built.** The main reason to wrap rather than
   ship a PWA is push, and nothing here uses it.
3. **No native capability is needed.** Camera, biometrics and background sync
   are all unused. A WebView wrapper would currently add a review process and a
   release cycle in exchange for nothing.

Recommendation: ship the PWA, measure whether installs happen, and revisit
wrapping only if push becomes the reason.

---

## Running the checks

```bash
npm run typecheck
npm test                      # 1,112; 1,170 with TEST_DATABASE_URL set
npm run build
npm run preflight             # the gate; exits non-zero on blockers
npm run smoke -- <baseUrl>    # loads every page in Chromium, needs a running server
npm audit --omit=dev
```

`npm run verify` runs the first four in sequence.
