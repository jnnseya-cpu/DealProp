# Launch env — paste-and-go (lodeprop.com)

Everything you set on the VPS to turn the platform fully on. Your two known
values are filled; the rest are placeholders — replace `<...>`. Nothing here is
a code switch: when a value is set, the feature is on.

See `docs/DEPLOY-HOSTINGER.md` for the Docker/compose/reverse-proxy steps this
env plugs into.

---

## 1 · Generate the three secrets on the VPS

```bash
openssl rand -base64 32   # OPERATOR_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
openssl rand -base64 32   # CRON_SECRET
```

Keep `DATA_ENCRYPTION_KEY` somewhere you can recover it — lose it and encrypted
seller fields are unreadable for good.

---

## 2 · `/opt/lode/app.env` (chmod 600, never committed)

```ini
# ---- LAUNCH (the 10 the gate blocks on) ----
NEXT_PUBLIC_SITE_URL=https://lodeprop.com
DATABASE_URL=postgres://lode:<STRONG_DB_PASSWORD>@db:5432/lode?sslmode=disable
OPERATOR_SECRET=<from step 1>
DATA_ENCRYPTION_KEY=<from step 1>
COMPANY_LEGAL_NAME=<your registered company name>
COMPANY_NUMBER=<Companies House number>
COMPANY_PLACE_OF_REGISTRATION=England and Wales
COMPANY_REGISTERED_OFFICE=<registered office address>
ICO_REGISTRATION=<ICO registration number>
CONTACT_EMAIL=contact@lodeprop.com
COMPANY_TRADING_NAME=Lode

# ---- LIVE AI (your Anthropic key; cheapest model is the default) ----
BLOG_MODEL_PROVIDER=anthropic
BLOG_MODEL_API_KEY=<sk-ant-...>
# BLOG_MODEL_NAME=claude-haiku-5-5

# ---- LIVE DATA (EPC free key; Land Registry needs none) ----
EPC_API_EMAIL=<your EPC account email>
EPC_API_KEY=<your EPC api key>

# ---- SCHEDULED WORK + EMAIL ----
CRON_SECRET=<from step 1>
EMAIL_API_URL=<provider send endpoint>
EMAIL_API_KEY=<provider key>
EMAIL_FROM=no-reply@lodeprop.com
NEWSLETTER_SENDER_NAME=Lode
NEWSLETTER_SENDER_ADDRESS=<postal address required in marketing email>
NEWSLETTER_REPLY_TO=contact@lodeprop.com

# ---- PAYMENTS (Stripe — section 3; no products to create) ----
BILLING_API_KEY=<sk_live_...>
BILLING_CHECKOUT_URL=https://api.stripe.com/v1/checkout/sessions
BILLING_WEBHOOK_SECRET=<whsec_...>

# ---- MONITORING + ANALYTICS (optional) ----
ERROR_REPORT_URL=<a JSON-POST incident/chat webhook>
# NEXT_PUBLIC_GA_MEASUREMENT_ID=G-...

# ---- FUNDER DISCOVERY (optional at launch) ----
# COMPANIES_HOUSE_API_KEY=
# FCA_REGISTER_EMAIL=
# FCA_REGISTER_KEY=

# ---- TRANSACTION FEES — the lawful ON switch (section 4) ----
# Empty = off (the safe default). Record ONLY permissions you actually hold.
HELD_PERMISSIONS=
```

`BILLING_WEBHOOK_SECRET` must **not** equal `OPERATOR_SECRET` (the gate blocks
that). The DB password here must match the one you give the Postgres service.

---

## 3 · Stripe — four steps, no products to create

1. Create a Stripe account → **Developers → API keys** → copy the **secret key**
   into `BILLING_API_KEY` (`sk_live_...`).
2. `BILLING_CHECKOUT_URL` is Stripe's endpoint, already set above.
3. **Developers → Webhooks → Add endpoint**: `https://lodeprop.com/api/billing/webhook`,
   subscribe to `checkout.session.completed`, `invoice.paid`,
   `customer.subscription.created`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy its **signing secret** into
   `BILLING_WEBHOOK_SECRET` (`whsec_...`).
4. Test with Stripe **test keys** first (buy the £39 plan with a test card, watch
   the webhook land in `/operator/billing`), then swap to **live keys**.

The price is computed server-side from the catalogue and sent inline — there is
no Stripe product or price to mirror.

---

## 4 · Turning the transaction fees ON — only with real evidence

The gated streams (opportunity reveal, seller / sourcing / deal / packaging
fees, funding introductions, professional referrals) switch on the moment the
matching permission is recorded — **and not before**. It is the funder's /
operator's statement that the authorisation is held, as `key:evidence` pairs:

```ini
HELD_PERMISSIONS=estate-agency-aml:<HMRC AML supervision number>,redress-scheme:<scheme and membership number>,credit-broking:<FCA FRN, or principal FRN and AR number>,financial-promotion-approver:<FCA FRN with s.21 approver permission>,professional-referrals:<reference for the recorded arrangement>
```

- A **bare key with no evidence grants nothing** and blocks the preflight.
- **Record only what you actually hold.** The platform trusts what you enter; it
  cannot verify the number with the regulator. A false entry is a false
  statement, and an unlicensed estate-agency or credit-broking fee is an offence
  and unrecoverable under FSMA s.26 — recording it does not make it lawful.
- As an **Appointed Representative**, the credit-broking / promotion entries take
  your principal's FRN plus your AR number.

Set the pairs you hold → `dealRevenue()` includes those streams on the next
request. Leave it empty until then: subscriptions, memberships and analysis
credits earn from day one regardless.

---

## 5 · Docker build args (identity baked into the public pages)

These are **public by definition**, so they are build arguments, not secrets:

```bash
docker compose build --pull \
  --build-arg NEXT_PUBLIC_SITE_URL=https://lodeprop.com \
  --build-arg COMPANY_LEGAL_NAME="<registered name>" \
  --build-arg COMPANY_TRADING_NAME=Lode \
  --build-arg COMPANY_NUMBER=<number> \
  --build-arg COMPANY_PLACE_OF_REGISTRATION="England and Wales" \
  --build-arg COMPANY_REGISTERED_OFFICE="<office>" \
  --build-arg CONTACT_EMAIL=contact@lodeprop.com
```

Every other value is read from `app.env` at runtime — nothing secret is baked
into the image.

---

## 6 · Confirm everything is on

```bash
docker compose up -d
curl -s https://lodeprop.com/api/health          # {"status":"ok","store":"postgres"}
# optionally, on a box with Node + app.env loaded:
#   set -a; . /opt/lode/app.env; set +a && npm ci && npm run preflight   # expect READY
```

Then the first-five-minutes checks in `docs/DEPLOY-HOSTINGER.md` §7, and the
cron lines in §8 so the newsletter, billing expiry and outreach actually fire.
