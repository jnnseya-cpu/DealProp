# Going live on a Hostinger VPS that already hosts other sites

A self-hosted deployment on a VPS you already pay for, **alongside existing
websites**. The golden rule: Lode never touches ports 80/443 or your other
sites. It runs on a **localhost-only port**, and whatever web server already
fronts your 6 sites reverse-proxies `lodeprop.com` to it and issues its TLS
certificate the same way it does for everything else. `docs/GO-LIVE.md` is the
full runbook and the authority; this is the shared-box version of it.

> **What still costs money, and is not infrastructure.** Two of the ten launch
> blockers are legal, not technical: a **registered company** (free if you have
> one; ~£50 one-off at Companies House otherwise) and **ICO registration**
> (~£40/year, because the platform processes sellers' reported health and
> capacity concerns). The preflight blocks on both by design. Everything else
> below is £0.

Worked for **lodeprop.com** / **contact@lodeprop.com** — substitute your own.

---

## 1. Identify what fronts the existing sites

Run this on the VPS. It tells you which web server owns 80/443 — that is the one
you add `lodeprop.com` to.

```bash
sudo ss -tlnp | grep -E ':80 |:443 ' || true
for s in nginx apache2 httpd lshttpd lsws openlitespeed caddy; do
  systemctl is-active --quiet "$s" 2>/dev/null && echo "running service: $s"
done
[ -d /usr/local/lsws ] && echo "OpenLiteSpeed present (likely CyberPanel)"
[ -d /etc/nginx ] && echo "nginx config dir present"
[ -d /etc/apache2 ] || [ -d /etc/httpd ] && echo "apache config dir present"
command -v cyberpanel >/dev/null 2>&1 && echo "CyberPanel present"
```

Match the result to section 6: **nginx**, **Apache (httpd/apache2)**, or
**OpenLiteSpeed/CyberPanel (lsws)**. If it shows a control panel, you will do
most of section 6 through the panel's UI instead of editing files — the config
shown is what the panel generates.

---

## 2. Prerequisites

- **Docker + the Compose plugin** on the host (`docker --version`,
  `docker compose version`). If missing: `apt install docker.io docker-compose-plugin`.
  Running Docker does not disturb your existing sites — they keep serving from
  the web server you just identified.
- **DNS:** an **A record** for `lodeprop.com` (and `www`) → the VPS's public IP,
  the same IP the other sites use. No new ports to open; 80/443 are already open.
- The repo on the box: `git clone <your fork> /opt/lode && cd /opt/lode`.

Node is **not** needed on the host — it runs inside the container, pinned to the
patched `node:22.23.4-alpine`.

---

## 3. Pick a free localhost port, and secrets

Lode will listen only on loopback. Check 3000 is free (if not, use 3001, 3002…):

```bash
sudo ss -tlnp | grep ':3000 ' && echo "3000 is taken — pick another" || echo "3000 is free"
```

Secrets, generated on the box and never committed:

```bash
openssl rand -base64 32   # OPERATOR_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
openssl rand -base64 32   # CRON_SECRET
```

`OPERATOR_SECRET` signs every session — rotating it signs everyone out (the
emergency control). Keep `DATA_ENCRYPTION_KEY` somewhere recoverable (a password
manager): lose it and every encrypted seller field is permanently unreadable.

---

## 4. Runtime env file

`/opt/lode/app.env`, `chmod 600`, owned by you. Read by the container at request
time; **never** baked into the image.

```ini
# --- the ten [LAUNCH] blockers ---
NEXT_PUBLIC_SITE_URL=https://lodeprop.com
# Postgres on the same host, on the private compose network only — not exposed
# to the host at all, so there is no clash with any database your other sites
# use. TLS is unnecessary because the traffic never leaves the box.
DATABASE_URL=postgres://lode:CHANGE_ME_STRONG@db:5432/lode?sslmode=disable
OPERATOR_SECRET=<from step 3>
DATA_ENCRYPTION_KEY=<from step 3>
COMPANY_LEGAL_NAME=<your registered name, exactly>
COMPANY_NUMBER=<your Companies House number>
COMPANY_PLACE_OF_REGISTRATION=England and Wales
COMPANY_REGISTERED_OFFICE=<your registered office>
ICO_REGISTRATION=<your ICO registration number>
CONTACT_EMAIL=contact@lodeprop.com

# --- [RECOMMEND], add now or later ---
CRON_SECRET=<from step 3>
ERROR_REPORT_URL=
# COMPANY_TRADING_NAME defaults to "Lode"; set if different.

# Everything else ([REVENUE] billing, email, discovery, analytics, AI drafting)
# is in .env.example with its tier. None of it is needed to go live.
```

---

## 5. docker-compose.yml, and build

Two services: the app (bound to **127.0.0.1 only**) and Postgres (no host port
at all). **No Caddy, no published 80/443** — your existing web server does TLS.
Adapt and test it; there is no Docker daemon in the environment it was written
in, so it has not been run here. Change `127.0.0.1:3000` if you picked another
port in step 3.

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: lode
      POSTGRES_PASSWORD: CHANGE_ME_STRONG   # must match DATABASE_URL
      POSTGRES_DB: lode
    volumes:
      - lode-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lode"]
      interval: 10s
      timeout: 5s
      retries: 5
    # No `ports:` — reachable only by the app over the compose network.

  app:
    build:
      context: .
      args:
        # NEXT_PUBLIC_* and the statutory identity are inlined into the
        # prerendered public pages at build time, so they are build args as
        # well as runtime env. Public by definition — never secrets.
        NEXT_PUBLIC_SITE_URL: https://lodeprop.com
        COMPANY_LEGAL_NAME: <your registered name>
        COMPANY_TRADING_NAME: Lode
        COMPANY_NUMBER: <your number>
        COMPANY_PLACE_OF_REGISTRATION: England and Wales
        COMPANY_REGISTERED_OFFICE: <your office>
        CONTACT_EMAIL: contact@lodeprop.com
    env_file: /opt/lode/app.env
    restart: unless-stopped
    # Loopback only: the reverse proxy reaches it, the internet cannot.
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy

volumes:
  lode-db:
```

Optionally confirm the gate first (needs Node 22 on the host; the image can't
run the toolchain):

```bash
set -a; . /opt/lode/app.env; set +a
npm ci && npm run preflight        # must print READY / exit 0
```

Then:

```bash
docker compose up -d --build
sleep 20
curl -s http://127.0.0.1:3000/api/health     # {"status":"ok","store":"postgres"}
```

If that JSON is right, the app is up on loopback and the schema created itself.
Now expose it.

---

## 6. Point your existing web server at the app

Pick the one section 1 identified. In all three, `lodeprop.com` terminates TLS
at your existing server and proxies to `127.0.0.1:3000`.

### nginx

`/etc/nginx/sites-available/lodeprop.com` (then symlink into `sites-enabled`, or
paste via your panel's "add site" + custom config):

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
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d lodeprop.com -d www.lodeprop.com   # free TLS, edits the block for 443
```

### Apache (apache2 / httpd)

```bash
sudo a2enmod proxy proxy_http headers   # Debian/Ubuntu
```

`<VirtualHost *:80>` for `lodeprop.com`:

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
sudo systemctl reload apache2
sudo certbot --apache -d lodeprop.com -d www.lodeprop.com
```

### OpenLiteSpeed / CyberPanel

Mostly through the panel:

1. **CyberPanel → Websites → Create Website**, domain `lodeprop.com`.
2. **Manage → SSL → Issue SSL** (Let's Encrypt) — the same button your other
   sites used.
3. **Manage → vHost Conf**, add a proxy context so the site serves the app:

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

4. **Restart OpenLiteSpeed** (panel button, or `sudo systemctl restart lsws`).

### Then, whichever server:

```bash
curl -sI https://lodeprop.com/api/health   # 200, valid cert
```

---

## 7. First five minutes (from GO-LIVE §4)

`https://lodeprop.com/api/health` → `{"status":"ok","store":"postgres"}` (if it
says `"file"`, `DATABASE_URL` did not reach the container). Then in a browser:
sign in at `/operator` with `OPERATOR_SECRET`; create a named admin at
`/operator/accounts` and sign back in as it; confirm `/operator/billing`,
`/operator/blog`, `/operator/audit` render; `/deals` is unreachable signed out;
`/robots.txt` disallows the operator paths; a `/sell` test enquiry returns a long
random token.

---

## 8. Scheduled work — nothing runs it unless you do

The standalone server has no scheduler. `crontab -e` on the host
(`docs/crontab.example` is the source):

```cron
SITE=https://lodeprop.com
CRON_SECRET=<the same value the app has>

0 8 * * 1       curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/newsletter"
0 3 * * *       curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/billing"
0 10,14 * * 1-5 curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/outreach"
```

Check `/operator/audit` after the first run rather than assuming it fired.

---

## 9. Updating, and keeping Node patched

```bash
cd /opt/lode && git pull
docker compose up -d --build     # rebuilds on the pinned, patched Node
```

When a Node security release lands, bump the pin in the `Dockerfile` (one line,
three stages) and run the above. The other 6 sites are unaffected — this only
rebuilds Lode's container.

---

## 10. Backups (£0)

```cron
30 2 * * * docker compose -f /opt/lode/docker-compose.yml exec -T db pg_dump -U lode lode | gzip > /opt/lode/backups/lode-$(date +\%F).sql.gz
```

Copy at least one dump off the box — a backup that lives only on the VPS does
not survive the VPS.

---

## 11. Optional: live AI prose (works with your key)

**The model writes words, never figures — that is the whole design.** Every
number stays the engine's: the Deal Score, valuations, yields, true discount and
fees are computed and the model is told they are fixed, so it cannot change or
invent one. One key powers two live surfaces:

- **Analysis narration** — the live executive summary on the investment
  memorandum (`/deals/[id]/funding` and the memorandum export), written from the
  engine's computed figures each time it is opened.
- **Blog drafting** — the opening paragraphs of per-deal posts.

Both speak Anthropic and OpenAI directly, so your key works with no adapter. Add
to `/opt/lode/app.env`:

```ini
BLOG_MODEL_PROVIDER=anthropic          # or: openai
BLOG_MODEL_API_KEY=<your provider key> # console.anthropic.com or platform.openai.com
# BLOG_MODEL_NAME=claude-haiku-5-5     # optional; the cheapest, and the default
```

Then `docker compose up -d --build`. Why it is safe to turn on in production:

- **Numbers are never the model's.** They are reassembled from the engine after
  the model returns, so the sentences can read however the model wrote them and
  the figures are still the computed ones.
- **It never breaks a page.** The memorandum summary has a 10-second timeout and
  falls back to the engine's own wording; the blog drafter runs in the
  background behind the deterministic drafter. A missing key, a slow model or an
  outage costs better sentences, never the page — and never a charge for nothing.
- **It is cheap and self-funding.** `claude-haiku-5-5` is pennies per call, and
  each analysis is already metered to a credit the customer paid for.

Two honest caveats. It **costs per token** — pennies, but no longer strictly £0.
And it only has something to narrate once there are **deals in the pipeline**: at
launch the store is empty, so the key sits idle until the first deal is recorded.
Nothing is lost by turning it on now.

---

## What this does not give you

Going live this way is **subscriptions-only**. Charging the seller success fee
needs HMRC AML supervision and a redress scheme recorded in `HELD_PERMISSIONS`
first — the revenue engine enforces that (`docs/GO-LIVE.md` §1 has the lead
times). And before marketing to a single seller, recruit capital first
(`/capital`, `/invest`), or every seller is correctly told no buyer matches yet.
