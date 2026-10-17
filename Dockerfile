# Multi-stage image for the Project Request & Fulfillment Tracker.
#   dev      - local development (compose.yaml): source is bind-mounted and
#              dependencies live in a named volume managed by docker/dev-entrypoint.sh
#   migrator - one-off `prisma migrate deploy` (compose.prod.yaml, explicit step)
#   runner   - minimal production server from the Next.js standalone output

# Pinned by version tag and multi-arch index digest for reproducible builds.
ARG NODE_IMAGE=node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1

# Prisma's schema engine (migrations) needs OpenSSL, which slim images omit.
FROM base AS tooling
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# Development image: tooling plus the PostgreSQL client tools used by the superadmin backup.
FROM tooling AS pgclient
COPY --chmod=0755 docker/install-pg-client.sh /usr/local/bin/install-pg-client
RUN install-pg-client

FROM pgclient AS dev
COPY --chmod=0755 docker/dev-entrypoint.sh /usr/local/bin/dev-entrypoint
# Volume mount points are created here so new named volumes inherit node ownership.
RUN mkdir -p /app/node_modules /app/.next /home/node/.npm /backups \
 && chown -R node:node /app /home/node/.npm /backups
USER node
EXPOSE 3000
ENTRYPOINT ["dev-entrypoint"]
CMD ["npm", "run", "dev"]

FROM tooling AS deps
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS builder
COPY . .
RUN npx prisma generate && npm run build

FROM deps AS migrator
COPY prisma ./prisma
COPY prisma7.config.ts ./
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
# PostgreSQL client tools for the superadmin backup (pg_dump).
COPY --chmod=0755 docker/install-pg-client.sh /usr/local/bin/install-pg-client
RUN install-pg-client && rm /usr/local/bin/install-pg-client
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Application files stay root-owned (read-only for the app user); only the
# Next.js cache directory is writable.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN mkdir -p .next/cache /backups && chown node:node .next/cache /backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
