# Deploy tomorrow — the complete walkthrough (lodeprop.com)

Follow top to bottom. Every command is copy-paste; your domain and contact are
already filled in. Checkpoints (✅) tell you when a step worked before you move
on. Budget ~2–3 hours; most of it is waiting on DNS, a build, and Stripe.

When you finish, **on at https://lodeprop.com:** the whole product, live AI,
live data, email, PWA, and **payments for subscriptions + memberships + credits**.
Transaction fees come on the moment you record real permission evidence
(step 12). Nothing is switched off in the code — only blank values keep a
feature dark.

---

## 0 · Have these in hand before you start

- SSH access to the VPS (and its **public IP**).
- Access to **lodeprop.com DNS** (to add an A record).
- Company: **registered name, company number, registered office**, and your
  **ICO registration number**.
- A **Stripe** account (or create it at step 11).
- Your **Anthropic API key** (`sk-ant-...`).
- Your **EPC** account email + key (free — register at
  epc.opendatacommunities.org if you haven't), and the two **Gazette** notice
  codes (free API) — these three turn on off-market discovery
  (`/operator/sourcing`). Price Paid needs no key.
- A strong **database password** you choose now (any 20+ random characters).

---

## 1 · Point the domain (do this first — it propagates while you work)

In your DNS provider, add:

```
A    lodeprop.com       <VPS_PUBLIC_IP>
A    www.lodeprop.com   <VPS_PUBLIC_IP>
```

✅ After a few minutes: `dig +short lodeprop.com` (from your laptop) returns the
VPS IP. TLS in step 10 cannot be issued until this resolves.

---

## 2 · Log in and make sure Docker is present

```bash
ssh root@<VPS_PUBLIC_IP>
docker --version && docker compose version
```

If either is missing:

```bash
apt update && apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

✅ Both print a version. Installing Docker does **not** disturb your 6 existing
sites — they keep serving from their current web server.

---

## 3 · Get the code

```bash
mkdir -p /opt/lode && cd /opt/lode
git clone <your repo URL> .
```

✅ `ls` shows `Dockerfile`, `package.json`, `src/`, `docs/`.

---

## 4 · Find out what fronts your existing sites (decides step 10)

```bash
sudo ss -tlnp | grep -E ':80 |:443 ' || true
for s in nginx apache2 httpd lshttpd lsws openlitespeed caddy; do
  systemctl is-active --quiet "$s" 2>/dev/null && echo "running: $s"
done
[ -d /usr/local/lsws ] && echo "OpenLiteSpeed/CyberPanel"
[ -d /etc/nginx ] && echo "nginx"
{ [ -d /etc/apache2 ] || [ -d /etc/httpd ]; } && echo "apache"
```

✅ Note the result — **nginx**, **apache**, or **OpenLiteSpeed/CyberPanel**. You
use the matching sub-section in step 10.

---

## 5 · Pick a free internal port for Lode

```bash
sudo ss -tlnp | grep ':3000 ' && echo "3000 TAKEN — use 3001" || echo "3000 free"
```

✅ If 3000 is taken, use `3001` (or higher) everywhere it appears below.

---

## 6 · Generate the three secrets

```bash
echo "OPERATOR_SECRET=$(openssl rand -base64 32)"
echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "CRON_SECRET=$(openssl rand -base64 32)"
```

✅ Copy all three lines somewhere safe. **Keep `DATA_ENCRYPTION_KEY`** — losing
it makes encrypted seller data unreadable forever.

---

## 7 · Write the environment file

```bash
nano /opt/lode/app.env
```

Paste this, replacing every `<...>` (and paste your three secrets from step 6):

```ini
# ---- LAUNCH ----
NEXT_PUBLIC_SITE_URL=https://lodeprop.com
DATABASE_URL=postgres://lode:<DB_PASSWORD>@db:5432/lode?sslmode=disable
OPERATOR_SECRET=<from step 6>
DATA_ENCRYPTION_KEY=<from step 6>
COMPANY_LEGAL_NAME=<registered company name>
COMPANY_NUMBER=<Companies House number>
COMPANY_PLACE_OF_REGISTRATION=England and Wales
COMPANY_REGISTERED_OFFICE=<registered office>
ICO_REGISTRATION=<ICO number>
CONTACT_EMAIL=contact@lodeprop.com
COMPANY_TRADING_NAME=Lode

# ---- LIVE AI ----
BLOG_MODEL_PROVIDER=anthropic
BLOG_MODEL_API_KEY=<sk-ant-...>

# ---- LIVE DATA / OFF-MARKET DISCOVERY (all free) ----
# Land Registry Price Paid needs no key. EPC is free (register at
# epc.opendatacommunities.org). The Gazette is a free API — set the two notice
# codes to turn on probate + insolvency discovery (confirm the codes against the
# live API first). With these set, /operator/sourcing works from day one.
EPC_API_EMAIL=<your EPC email>
EPC_API_KEY=<your EPC key>
GAZETTE_DECEASED_CODE=<Gazette deceased-estates notice code>
GAZETTE_INSOLVENCY_CODE=<Gazette insolvency notice code>

# ---- EMAIL + CRON ----
CRON_SECRET=<from step 6>
EMAIL_API_URL=<provider send endpoint>
EMAIL_API_KEY=<provider key>
EMAIL_FROM=no-reply@lodeprop.com
NEWSLETTER_SENDER_NAME=Lode
NEWSLETTER_SENDER_ADDRESS=<your postal address>
NEWSLETTER_REPLY_TO=contact@lodeprop.com

# ---- PAYMENTS (fill in step 11) ----
BILLING_API_KEY=
BILLING_CHECKOUT_URL=https://api.stripe.com/v1/checkout/sessions
BILLING_WEBHOOK_SECRET=

# ---- TRANSACTION FEES (step 12; empty = off) ----
HELD_PERMISSIONS=
```

Save: `Ctrl+O`, `Enter`, `Ctrl+X`. Lock it down:

```bash
chmod 600 /opt/lode/app.env
```

✅ `BILLING_WEBHOOK_SECRET` must never equal `OPERATOR_SECRET`. The `<DB_PASSWORD>`
here must match step 8.

---

## 8 · Write the compose file (app on loopback, Postgres internal)

```bash
nano /opt/lode/docker-compose.yml
```

Paste (set `POSTGRES_PASSWORD` to the **same** password as in `app.env`; change
`127.0.0.1:3000` if you picked another port):

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: lode
      POSTGRES_PASSWORD: <DB_PASSWORD>
      POSTGRES_DB: lode
    volumes:
      - lode-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lode"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_SITE_URL: https://lodeprop.com
        COMPANY_LEGAL_NAME: <registered name>
        COMPANY_TRADING_NAME: Lode
        COMPANY_NUMBER: <number>
        COMPANY_PLACE_OF_REGISTRATION: England and Wales
        COMPANY_REGISTERED_OFFICE: <office>
        CONTACT_EMAIL: contact@lodeprop.com
    env_file: /opt/lode/app.env
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy

volumes:
  lode-db:
```

Save and exit.

---

## 9 · Build and start

```bash
cd /opt/lode
docker compose up -d --build
```

The first build takes a few minutes. Then:

```bash
sleep 20
curl -s http://127.0.0.1:3000/api/health
```

✅ Returns `{"status":"ok","store":"postgres"}`. If it says `"file"`, the
`DATABASE_URL` didn't reach the container — check `app.env` and `docker compose logs app`.

---

## 10 · Put lodeprop.com in front of it

**Easiest — let the script tell you the exact commands for your server:**

```bash
bash /opt/lode/scripts/proxy-setup.sh lodeprop.com 3000
```

It detects nginx / Apache / OpenLiteSpeed and prints a copy-paste block for
*your* box (it changes nothing itself). Run what it prints, then jump to the
"whichever case" check at the end of this step.

The three cases are written out below too, for reference — use the one matching
step 4.

### 10a · nginx

```bash
nano /etc/nginx/sites-available/lodeprop.com
```

```nginx
server {
    listen 80;
    server_name lodeprop.com www.lodeprop.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/lodeprop.com /etc/nginx/sites-enabled/ 2>/dev/null
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d lodeprop.com -d www.lodeprop.com
```

### 10b · Apache

```bash
a2enmod proxy proxy_http headers
nano /etc/apache2/sites-available/lodeprop.com.conf
```

```apache
<VirtualHost *:80>
    ServerName lodeprop.com
    ServerAlias www.lodeprop.com
    ProxyPreserveHost On
    ProxyPass        / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
```

```bash
a2ensite lodeprop.com && systemctl reload apache2
apt install -y certbot python3-certbot-apache
certbot --apache -d lodeprop.com -d www.lodeprop.com
```

### 10c · OpenLiteSpeed / CyberPanel (mostly in the panel)

1. **Websites → Create Website**, domain `lodeprop.com`.
2. **Manage → SSL → Issue SSL** (Let's Encrypt) — the same button your other
   sites used.
3. **Manage → vHost Conf**, add:

   ```
   extprocessor lode {
     type        proxy
     address     127.0.0.1:3000
     maxConns    100
     initTimeout 60
     retryTimeout 0
     respBuffer  0
   }
   context / {
     type    proxy
     handler lode
     addDefaultCharset off
   }
   ```
4. **Restart**: `systemctl restart lsws` (or the panel's Restart button).

### Then, whichever case:

```bash
curl -sI https://lodeprop.com/api/health
```

✅ `HTTP/2 200`, valid certificate, and the JSON shows `"store":"postgres"`.

---

## 11 · Stripe (take the first £39)

1. Stripe → **Developers → API keys** → copy the **secret key** into
   `BILLING_API_KEY` in `app.env` (`sk_live_...`, or `sk_test_...` to test first).
2. Stripe → **Developers → Webhooks → Add endpoint**:
   `https://lodeprop.com/api/billing/webhook`; subscribe to
   `checkout.session.completed`, `invoice.paid`, `customer.subscription.created`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Copy its **signing
   secret** into `BILLING_WEBHOOK_SECRET`.
3. Apply the new env: `cd /opt/lode && docker compose up -d` (recreates the app
   with the new values; no rebuild needed).
4. **Test** with test keys: sign up a buyer, `/account/billing`, buy **Investor
   £39** with card `4242 4242 4242 4242`, confirm it lands in `/operator/billing`.
   Then swap to live keys and `docker compose up -d` again.

✅ A test payment shows in `/operator/billing`. No Stripe product is created —
the price comes from the catalogue.

---

## 12 · (Optional) turn the transaction fees on — only with real evidence

If you hold estate-agency AML supervision + a redress scheme (and FCA / AR for
funding introductions), add to `app.env` and `docker compose up -d`:

```ini
HELD_PERMISSIONS=estate-agency-aml:<HMRC number>,redress-scheme:<scheme + membership no.>,credit-broking:<FCA FRN or principal FRN + AR number>
```

Record **only** what you actually hold — the platform trusts the entry, cannot
verify it with the regulator, and an unlicensed fee is unrecoverable (FSMA s.26).
Leave it blank to launch on subscriptions + memberships + credits, which need
none of this.

---

## 13 · First five minutes (do these in a browser)

1. `https://lodeprop.com/api/health` → `{"status":"ok","store":"postgres"}`.
2. Sign in at `/operator` with `OPERATOR_SECRET`.
3. `/operator/accounts` → create a **named admin**, sign out, sign in as it
   (from here every action has a name in the audit trail).
4. `/operator/billing`, `/operator/blog`, `/operator/audit` all render.
5. Signed out, `/deals` is **blocked**.
6. `/robots.txt` disallows the operator paths.
7. Submit a test enquiry at `/sell` — the result URL is a long random token.

✅ All seven pass.

---

## 14 · Schedule the background jobs (nothing runs them otherwise)

```bash
crontab -e
```

Add (paste your `CRON_SECRET`):

```cron
SITE=https://lodeprop.com
CRON_SECRET=<from step 6>

0 8 * * 1       curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/newsletter"
0 3 * * *       curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/billing"
0 10,14 * * 1-5 curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/outreach"
```

✅ `crontab -l` shows the three lines.

---

## 15 · Nightly backup

```bash
mkdir -p /opt/lode/backups
crontab -e
```

Add:

```cron
30 2 * * * docker compose -f /opt/lode/docker-compose.yml exec -T db pg_dump -U lode lode | gzip > /opt/lode/backups/lode-$(date +\%F).sql.gz
```

Copy at least one dump off the box periodically — a backup only on the VPS does
not survive the VPS.

---

## 16 · Fill the marketplace before you market

Signed in as your admin:

- `/capital` → create a few **Funding Boxes** (bridging + private lenders; every
  required return is ≥ 8%).
- `/invest` → create a few **Buy Boxes**.

Why: with no funding mandate, the engine correctly tells a seller no buyer
matches — so recruit capital first. Then line up your first buyer and point them
at `/account/billing` for the £39.

✅ `/capital` shows active mandates and the pipeline matches against them.

---

## 17 · You are live

Announce. Take the first subscription. Watch `/operator/billing` and
`/operator/audit`.

**If anything needs rolling back:** the app is stateless — `cd /opt/lode && git
checkout <previous tag> && docker compose up -d --build`. The database is
append-only by design; take a backup (step 15) before any non-additive change
and never restore over the audit trail or accounts.

---

### If a step fails

- **Build fails:** `docker compose logs app` — usually a typo in `app.env`.
- **Health says `"file"`:** `DATABASE_URL` didn't reach the app, or the DB
  password mismatches between `app.env` and `docker-compose.yml`.
- **502/504 at the domain:** the app isn't on `127.0.0.1:3000` (check
  `curl 127.0.0.1:3000/api/health`) or the proxy port is wrong.
- **TLS won't issue:** DNS isn't pointing at the VPS yet (`dig +short lodeprop.com`).
- **"identity has not been configured":** a `COMPANY_*` build arg was blank at
  build time — fix step 8 and `docker compose up -d --build`.
```
