# Auto-deploy — one-time setup

`.github/workflows/deploy.yml` deploys automatically on every push to the
production branch, **but only after the full test suite passes against a real
Postgres**. A red build never reaches the VPS.

Pipeline: push → `verify` (types + `test:pg`) → `deploy` (build image → push to
GHCR → SSH to the VPS → `docker compose pull && up -d`).

You set this up once. After that, every slice I push goes live on its own.

> **Do the compose-networks fix first** (see chat / `/srv/lode/docker-compose.yml`)
> so the app stays on Caddy's `app_default` network. Then the one change below.

---

## 1. Point the VPS compose at the image (instead of building locally)

In `/srv/lode/docker-compose.yml`, change the `app` service from building to
pulling the image CI publishes. Replace the `build: .` line with an `image:`
line:

```yaml
  app:
    image: ghcr.io/jnnseya-cpu/dealprop:latest   # was: build: .
    networks:
      - default
      - app_default
    env_file: /srv/lode/app.env
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy
```

Everything else (db, volumes, networks, app.env) stays exactly as it is. Your
secrets still live only in `app.env` and are read at runtime — never baked into
the image.

## 2. Let the VPS pull the image

The GHCR image is private by default. Easiest: after the first successful
deploy run, open GitHub → your profile → Packages → `dealprop` → Package
settings → change visibility to **Public** (the image carries no secrets, so
this is safe). Then the VPS needs no login.

If you'd rather keep it private, log in once on the VPS with a token that has
`read:packages`:

```bash
echo <YOUR_PAT> | docker login ghcr.io -u <your-github-username> --password-stdin
```

## 3. Add the GitHub repo secrets

Repo → Settings → Secrets and variables → Actions → New repository secret. Add:

| Secret | Value |
|---|---|
| `VPS_HOST` | the VPS IP or hostname (e.g. `srv1854161…` / its public IP) |
| `VPS_USER` | `root` (or your deploy user) |
| `VPS_PORT` | `22` |
| `VPS_PATH` | `/srv/lode` |
| `VPS_SSH_KEY` | a **private** SSH key whose public half is in the VPS's `~/.ssh/authorized_keys` |

To make the deploy key (run locally or on the VPS):

```bash
ssh-keygen -t ed25519 -f lode_deploy -N "" -C "github-actions-deploy"
# add the PUBLIC key to the VPS:
cat lode_deploy.pub >> ~/.ssh/authorized_keys     # on the VPS, for VPS_USER
# paste the PRIVATE key (the whole lode_deploy file) into the VPS_SSH_KEY secret
```

## 4. First run

Push anything to `claude/property-deal-os-a4bclq` (or run the workflow manually
from the Actions tab → Deploy → Run workflow). Watch it under **Actions**. On
success the VPS pulls the new image and restarts `app`; `db`, Caddy and HTTPS
are untouched.

Roll back by re-running an older commit's Deploy, or on the VPS:
`docker compose pull app && docker compose up -d app` after pinning
`:<sha>` instead of `:latest`.

---

### Notes

- **Branch = production.** The workflow triggers on `claude/property-deal-os-a4bclq`
  and `main`. Change the `branches:` list in `deploy.yml` if your production
  branch changes.
- **The engines and money path are never auto-anything.** This ships the image
  the Dockerfile already builds; schema self-creates and numbered migrations
  run on connect, exactly as on a manual deploy. No agent, no self-patching.
- **Zero-downtime** is not claimed: `up -d app` recreates the one container, a
  second or two. For true rolling deploys, put two app replicas behind Caddy —
  a later step, not needed now.
