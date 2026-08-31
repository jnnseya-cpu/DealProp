# Lode, as a container.
#
# Three stages, so the image that serves the app carries neither the toolchain
# nor the dev dependencies. `next build` with `output: "standalone"` traces the
# modules the server actually reaches; nothing else is copied, which is why the
# runtime image cannot run tsx, vitest or Playwright even if something tried.
#
# There is deliberately no seeding, no migration and no build-time secret here.
# The schema creates itself on first connection, and every secret is read from
# the environment at request time — a secret baked into a layer is a secret in
# the registry.

# --- dependencies ----------------------------------------------------------
FROM node:22.11-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` against the committed lockfile. Not `npm install`: a build that can
# resolve a different tree from the one that was tested is not the same build.
RUN npm ci

# --- build -----------------------------------------------------------------
FROM node:22.11-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public identifiers only. NEXT_PUBLIC_* values are inlined into the browser
# bundle at build time, so they belong to the image and must never be a secret.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_META_PIXEL_ID
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:22.11-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Never root. The app writes nothing to disk when DATABASE_URL is set, and when
# it is unset the file store's writes should fail loudly rather than persist to
# a container filesystem that vanishes on the next deploy.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S lode -G nodejs

COPY --from=build --chown=lode:nodejs /app/.next/standalone ./
COPY --from=build --chown=lode:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=lode:nodejs /app/public ./public

USER lode
EXPOSE 3000

# The same endpoint the load balancer should use: 200 with the store reachable,
# 503 when it is not, so a broken instance is replaced rather than left serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
