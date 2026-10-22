# Going live on a Hostinger VPS, at £0 infrastructure

A focused path for a self-hosted deployment on a VPS you already pay for.
`docs/GO-LIVE.md` is the full runbook and the authority; this is the concrete
Hostinger version of its "Anywhere else" section, with Postgres on the same box
and HTTPS from Let's Encrypt, so nothing new is bought.

> **What still costs money, and is not infrastructure.** Two of the ten launch
> blockers are legal, not technical: a **registered company** (free if you
> already have one; ~£50 one-off at Companies House if not) and **ICO
> registration** (~£40/year, because the platform processes sellers' reported
> health and capacity concerns). The preflight blocks on both by design —
> launching without them is unlawful, not merely untidy. Everything below is £0.

Worked for the domain **lodeprop.com** and contact **contact@lodeprop.com**.
Substitute your own if they change.

---

## 0. Prerequisites on the VPS

- Docker and the Compose plugin. Hostinger's VPS "Ubuntu + Docker" template has
  them; otherwise `apt install docker.io docker-compose-plugin`.
- Ports **80** and **443** open to the internet, and **22** for you.
- DNS: an **A record** for `lodeprop.com` (and `www`, if you want it) pointing at
  the VPS's public IP. HTTPS cannot be issued until this resolves.
- The repo on the box: `git clone <your fork> lode && cd lode`.

Node itself is **not** needed on the host — it runs inside the container, pinned
to the patched `node:22.23.4-alpine`. Keep it patched by rebuilding when a Node
security release lands (this is the Hostinger advisory you already acted on).

---

## 1. Secrets — generate on the VPS, never commit

```bash
openssl rand -base64 32   # OPERATOR_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
openssl rand -base64 32   # CRON_SECRET
```

`OPERATOR_SECRET` signs every operator and account session — rotating it signs
everyone out, which is the intended emergency control. Losing
`DATA_ENCRYPTION_KEY` makes every encrypted seller field permanently unreadable,
so store it where you can get it back (a password manager), not only on the box.

---

## 2. The runtime env file

Create `/opt/lode/app.env`, owned by you, `chmod 600`. It is read by the
container at request time and is **never** baked into the image.

```ini
# --- the ten [LAUNCH] blockers ---
NEXT_PUBLIC_SITE_URL=https://lodeprop.com
# Postgres on the same host, over the compose network — TLS is not needed
# because the traffic never leaves the box. Use a real password.
DATABASE_URL=postgres://lode:CHANGE_ME_STRONG@db:5432/lode?sslmode=disable
OPERATOR_SECRET=<paste from step 1>
DATA_ENCRYPTION_KEY=<paste from step 1>
COMPANY_LEGAL_NAME=<your registered name, exactly>
COMPANY_NUMBER=<your Companies House number>
COMPANY_PLACE_OF_REGISTRATION=England and Wales
COMPANY_REGISTERED_OFFICE=<your registered office>
ICO_REGISTRATION=<your ICO registration number>
CONTACT_EMAIL=contact@lodeprop.com

# --- [RECOMMEND], safe to add now or later ---
CRON_SECRET=<paste from step 1>
ERROR_REPORT_URL=
# COMPANY_TRADING_NAME defaults to "Lode"; set if different.

# Everything else ([REVENUE] billing, email, discovery, analytics) is in
# .env.example with its tier. Add it when you reach that tier — none of it is
# needed to go live subscriptions-only.
```

The Postgres password in `DATABASE_URL` must match the one you give the `db`
service in step 3.

---

## 3. docker-compose.yml

Three services: the app, Postgres with a named volume, and Caddy for automatic
HTTPS. Adapt and test it — there is no Docker daemon in the environment this
file was written in, so it has not been run here.

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

  app:
    build:
      context: .
      args:
        # NEXT_PUBLIC_* and the statutory identity are inlined into the
        # prerendered public pages at build time, so they are build args as
        # well as runtime env. They are public by definition — never secrets.
        NEXT_PUBLIC_SITE_URL: https://lodeprop.com
        COMPANY_LEGAL_NAME: <your registered name>
        COMPANY_TRADING_NAME: Lode
        COMPANY_NUMBER: <your number>
        COMPANY_PLACE_OF_REGISTRATION: England and Wales
        COMPANY_REGISTERED_OFFICE: <your office>
        CONTACT_EMAIL: contact@lodeprop.com
    env_file: /opt/lode/app.env           # the secrets and DATABASE_URL
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on:
      - app

volumes:
  lode-db:
  caddy-data:
```

`Caddyfile`, next to it:

```
lodeprop.com, www.lodeprop.com {
	reverse_proxy app:3000
}
```

Caddy obtains and renews a Let's Encrypt certificate automatically once the DNS
A record resolves — that is the £0 HTTPS. The app listens on 3000 inside the
network; only Caddy is exposed.

---

## 4. Confirm the gate, then build and start

If you have Node 22 on the host, confirm the ten blockers are satisfied before
building — the image cannot run the toolchain, so this is the one chance to run
the gate:

```bash
set -a; . /opt/lode/app.env; set +a   # load the env into this shell
npm ci && npm run preflight           # must print READY / exit 0
```

Then build and start everything:

```bash
docker compose up -d --build
```

The schema creates itself on first connection — there is no migration step.

---

## 5. First five minutes (from GO-LIVE §4)

```bash
curl -s https://lodeprop.com/api/health      # {"status":"ok","store":"postgres"}
```

If it says `"file"`, `DATABASE_URL` did not reach the container — the app is
writing to a disk that vanishes on redeploy. Then, in a browser:

1. Sign in at `/operator` with `OPERATOR_SECRET`.
2. Create a named admin at `/operator/accounts`, sign out, sign back in as it —
   from here the audit trail has a name against every action.
3. `/operator/billing`, `/operator/blog`, `/operator/audit` all render.
4. `/deals` is **unreachable** signed out.
5. `/robots.txt` disallows the operator paths.
6. A test enquiry at `/sell` returns a long random token, not a guessable id.

---

## 6. Scheduled work — nothing runs it unless you do

The standalone server has **no scheduler**. Without this, lapsed balance never
expires, the newsletter never sends and approved outreach never goes out — all
failures by omission. `crontab -e` on the host (`docs/crontab.example` is the
source):

```cron
SITE=https://lodeprop.com
CRON_SECRET=<the same value the app has>

0 8 * * 1    curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/newsletter"
0 3 * * *    curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/billing"
0 10,14 * * 1-5 curl --fail --silent --show-error --max-time 300 -H "authorization: Bearer $CRON_SECRET" -X POST "$SITE/api/cron/outreach"
```

Check `/operator/audit` after the first scheduled run rather than assuming it
fired.

---

## 7. Updating, and keeping Node patched

```bash
cd lode && git pull
docker compose up -d --build        # rebuilds on the pinned, patched Node
```

A running container keeps its old Node until rebuilt, so when a Node security
release lands, bump the pin in the `Dockerfile` (one line, three stages) and run
the command above. That is the whole of the Hostinger advisory response for this
app.

---

## 8. Backups (£0)

The app is stateless; the database is not, and the audit trail and accounts are
append-only by design. A nightly dump to the host, kept out of the repo:

```cron
30 2 * * * docker compose -f /opt/lode/docker-compose.yml exec -T db pg_dump -U lode lode | gzip > /opt/lode/backups/lode-$(date +\%F).sql.gz
```

Rotate what you keep, and copy at least one off the box — a backup that lives
only on the VPS does not survive the VPS.

---

## What this does not give you

Going live this way is **subscriptions-only**. Charging the seller success fee
needs HMRC AML supervision and a redress scheme recorded in `HELD_PERMISSIONS`
first — the revenue engine enforces that, and `docs/GO-LIVE.md` §1 has the lead
times. And before marketing to a single seller, recruit capital first
(`/capital`, `/invest`), or every seller is correctly told no buyer matches yet.
