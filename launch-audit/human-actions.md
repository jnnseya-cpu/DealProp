# Human Action List

Everything below requires a person — credentials, infrastructure, legal/business judgement, or a real provider contract. None can be done by an automated agent, and each is a true blocker for the gate named. The moment one is supplied, the corresponding audit gate can be executed and re-scored.

## A. Config blockers (preflight fails closed until set) — gate 3/4/5/10

1. `OPERATOR_SECRET` — `openssl rand -base64 32` on the host.
2. `DATA_ENCRYPTION_KEY` — `openssl rand -base64 32`; store it off the DB host and keep it recoverable. Rotating it later requires `encrypt:backfill`, never a bare swap.
3. `DATABASE_URL` — provision production Postgres (the engine proven in Cycle 1).
4. `NEXT_PUBLIC_SITE_URL` — `https://lodeprop.com`.
5–10. **Company identity (statutory, must be real):** registered legal name, company number, place of registration, registered office, ICO registration, contact address. The preflight refuses placeholders by design (§56).

## B. Payment integrity — gate 6 (currently PARTIAL)

- **Stripe sandbox keys first**, then live: `BILLING_API_KEY`, `BILLING_CHECKOUT_URL`, `BILLING_WEBHOOK_SECRET`. Without them `/api/billing/checkout` authorises then 503s, and the full checkout→webhook→ledger→entitlement flow **cannot be executed**. The fail-closed boundaries are already proven (E7/E8); the live money path is what remains.

## C. External services — gates 2/10

- **Email transport** (`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`) + `CRON_SECRET` — double opt-in, outreach, opt-out actioning.
- **Transaction-fee permissions** (`HELD_PERMISSIONS` as `key:evidence`) — only with real HMRC AML / redress / FCA authorisations.
- **Data keys** — EPC + Gazette codes (off-market discovery); Companies House / FCA (funder verification).
- **Identity/sanctions screening provider** — none wired; every check is inconclusive until one is (§80).

## D. Operational / infra — gates 7/8/9/11

- **Load/performance target + tooling** — to execute gate 7 against a real environment.
- **Monitoring sink** (`ERROR_REPORT_URL`) + uptime/alerting — gate 9 is NOT TESTED until this exists.
- **DR drill** — restore a real backup into isolation; confirm RPO/RTO. Gate 8.
- **Account ownership** — domain, DNS, cloud, Stripe, mail all owned by the organisation, not an individual; emergency admin documented. Gate 11.
- **Legal sign-off** — terms, privacy, refund/cancellation, AI disclosures reviewed by a person.

## E. Journeys to execute once B/C are live

- Full `/sell` wizard E2E (Cycle 1 PARTIAL) — complete on a real device/browser.
- Checkout → webhook → ledger → entitlement reconciliation (financial invariants = 0).
- A real GDPR deletion request across DB, auth, storage, email platform, backups.
