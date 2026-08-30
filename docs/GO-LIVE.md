# Going live

The order below is the order things must happen in, not a checklist to work
through in parallel. Several steps exist because doing them later would mean
having already done something unlawful or untrue.

Run `npm run preflight` at every stage. It exits non-zero on anything blocking,
so it belongs in the deploy pipeline as a gate rather than as a report.

---

## 0. What is not built

Read this first. Nothing below makes these appear.

- **A payment provider.** Nothing charges a card. Everything behind one exists —
  catalogue, append-only ledger, entitlements, the verified webhook, the
  enforcement points — but going live today means going live without revenue
  collection.
- **Reconciliation against the provider.** Nothing compares this platform's
  ledger to the provider's record, so a divergence would go unnoticed.
- **Live data imports.** The Land Registry and EPC adapters are fixture-tested
  and have never made a real request — outbound access is blocked in the build
  environment. Call them once from a machine with network before relying on
  them.
- **Verified partner details.** Neither trade partner's website could be read,
  so their records claim nothing beyond what was stated directly.

---

## 1. Legal, before any of the technical work

These have lead times measured in weeks and two of them gate revenue.

| What | Why it blocks | Lead time |
|---|---|---|
| HMRC AML supervision | Introducing sellers to buyers for a fee is estate agency work. `dealRevenue()` already excludes the success fee and deal packaging until this is recorded as held. | 4–6 weeks |
| Redress scheme membership | Required alongside AML for estate agency work. | Days |
| ICO registration | The platform processes special-category data — sellers' reported health and capacity concerns. | Days |
| Professional indemnity insurance | — | Days |
| Terms of business and seller disclosure pack | The seller journey shows the buyer's projected profit; the terms must match what the product actually does. | 1–2 weeks |
| Investor categorisation thresholds | Deal material is gated on figures currently marked `requiresVerification: true`. Confirm them against the current Financial Promotion Order. | Hours |

Until AML and redress are granted, **charge subscriptions only**. The revenue
engine enforces this; do not work around it.

---

## 2. Provision

**Postgres.** Managed, with `?sslmode=require`. The connection string's
`sslmode` governs TLS and overrides any driver option — verified against pg
8.23. `sslmode=no-verify` encrypts without authenticating the server and is only
for a self-hosted database with a self-signed certificate.

The schema creates itself on first connection. There is no migration step yet;
when a column has to change shape rather than be added, that stops being true.

**Secrets.** Generate each one separately and never reuse:

```bash
openssl rand -base64 32   # OPERATOR_SECRET
openssl rand -base64 32   # CRON_SECRET
```

`OPERATOR_SECRET` also signs every account session, so **rotating it signs
everybody out**. That is the intended emergency control.

**Email.** All three of `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, or none.
A half-configured transport is how a deployment mails real people from the wrong
address. `NEWSLETTER_SENDER_NAME` and `NEWSLETTER_SENDER_ADDRESS` are legally
required in marketing email; the preflight blocks without them once email is on.

**Billing.** `BILLING_WEBHOOK_SECRET` is the provider's signing secret, used
unmodified. Without it every payment confirmation is refused, so nothing can be
sold — the safe direction, since this endpoint is what grants subscriptions and
prepaid balance. It must not equal `OPERATOR_SECRET`; the preflight blocks if it
does, because compromising either would then compromise both.

Nothing charges a card yet. The catalogue, ledger, entitlements and webhook are
built and tested; what remains is mapping a provider's payload into the event
shape `/api/billing/webhook` already handles.

**Analytics.** `NEXT_PUBLIC_META_PIXEL_ID` and `NEXT_PUBLIC_GA_MEASUREMENT_ID`
are optional, public identifiers rather than secrets, and either may be left
unset — the script is then never rendered. Use the GA4 **measurement** ID
(`G-…`); the preflight blocks on a Tag Manager container (`GTM-…`), because a
container can load a tag added later from its console, on any page, outside the
route allowlist that keeps pixels off the Deal Room, the memorandum and a
seller's own result page. Nothing loads before the visitor accepts the banner.
Before switching either on, confirm the privacy notice names both vendors.

**Site URL.** `NEXT_PUBLIC_SITE_URL` must be the public HTTPS origin with no
trailing slash. Every canonical URL, the sitemap, and every newsletter confirm
and unsubscribe link is built from it. Wrong here means the site quietly
canonicalises itself to localhost.

---

## 3. Deploy

```bash
npm ci
npm run typecheck
npm test              # 556
npm run test:pg       # 557, both storage engines against a real database
npm run build
npm run preflight     # must exit 0
```

The repository has `vercel.json` with the Monday 08:00 newsletter cron and a
nightly 03:00 billing cron. The billing one expires lapsed prepaid balance; skip
it and the twelve-month expiry disclosed at the point of sale never happens, and
the liability is carried for ever. Any host
works — the app is a standard Next.js server — but the cron must be driven from
somewhere, and `/api/cron/newsletter` fails closed without `CRON_SECRET`.

Point the platform's health check at **`/api/health`**. It returns 200 with the
store reachable and 503 when it is not, so a broken instance is taken out of
rotation instead of serving errors. It is unauthenticated and therefore
deliberately uninformative: no version, no hostnames, no error text.

---

## 4. First five minutes after the first deploy

In this order.

1. **`/api/health`** returns `{"status":"ok","store":"postgres"}`. If it says
   `"file"`, `DATABASE_URL` did not reach the runtime and every instance is
   writing to its own disk.
2. **Sign in at `/operator`** with the shared password.
3. **Create an administrator account** at `/operator/accounts`, sign out, sign
   in as that account. From here on the audit trail has a name against every
   action. The shared password is the bootstrap, not the way to work.
4. **Open `/operator/billing`** and confirm it renders. It computes every
   balance from the ledger, so an error here means the billing tables did not
   create themselves.
5. **Open `/operator/blog`** and confirm the post list renders with an SEO score
   against each one. Opens start at zero and do not backfill — the counter
   begins when the first reader arrives.
6. **Check `/operator/audit`** shows the sign-ins. If it is empty, the store is
   not persisting.
7. **Confirm `/deals` is unreachable signed out**, and that the
   `x-middleware-subrequest` header does not get past it.
8. **Fetch `/robots.txt`** and confirm the operator paths are disallowed.
9. **Submit a test enquiry at `/sell`** and confirm the resulting URL is a long
   random token, not a guessable identifier.

---

## 5. Before marketing to a single seller

`countInterestedBuyers()` reads live mandates. With none recorded, every seller
who completes the intake is told — correctly — that no buyer currently matches
their property. That is the truth, and it is also the thing that kills the
channel if sellers hear it first.

So: **recruit capital before supply.** Create Funding Boxes at `/capital` and
Buy Boxes at `/invest` first. `docs/GO-TO-MARKET.md` has the sequence and the
target of twelve funding mandates before any seller spend.

---

## 6. Rollback

The application is stateless; rolling back is redeploying the previous build.

The database is not. The schema is additive only, so an older build runs against
a newer database — but **the audit trail and accounts are append-only by design
and must not be restored over**. Take a backup before any change that is not
additive, and restore the whole database rather than a table if one is ever
needed.

Rotating `OPERATOR_SECRET` is the fastest way to end every session at once. It
requires no deploy and no database change.

---

## 7. What the preflight will still warn about, correctly

These are lawful to leave undone and dangerous to forget, which is why they warn
rather than block:

- **Permission-gated revenue excluded.** Correct until AML and redress are
  granted. `HELD_PERMISSIONS` records them once they are.
- **Investor thresholds pending verification.** Deal material is gated on
  figures that were amended and then announced for reversal.
- **Wales not deal-ready.** Land Transaction Tax is not implemented; deals there
  are capped rather than transacted.
- **No admin account.** Everything then happens under a shared password with no
  name in the audit trail.
- **Store empty.** The honest state before capital is recruited.
- **No pixel configured.** Lawful and quiet: the seller funnel is then
  unmeasured.
- **A pixel is configured.** The reminder that the route exclusions are
  load-bearing and that no tag may be added outside
  `src/app/components/Analytics.tsx`.
