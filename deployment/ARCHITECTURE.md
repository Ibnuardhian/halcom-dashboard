# Architecture (state of the repository, refreshed 2026-10-22 against origin/main c405918)

Phase 1 of the Oracle Cloud preparation. This file describes what the repository **actually contains today**. Anything
marked *target* is a proposal for Phase 2 to 6 and does not exist yet. Findings and their priorities are in [CHECKLIST.md](CHECKLIST.md).

## 1. Application

| Item | Fact | Evidence |
|---|---|---|
| Framework | Next.js 16.4.2, React 19.3, App Router, `cacheComponents: true`, `output: "standalone"` | `package.json`, `next.config.ts` |
| Language | TypeScript (strict), Tailwind 4, shadcn-style UI | `tsconfig.json`, `components.json` |
| Runtime | Node `>=24 <25`, npm `>=11`, `engine-strict=true` | `package.json` engines, `.npmrc` |
| Image base | `node:24.22.0-bookworm-slim` pinned by tag and digest | `Dockerfile` line 7 |
| Package manager | npm with `package-lock.json`; `.npmrc` has a 7-day release cooldown (`min-release-age`) | `.npmrc` |
| Database | PostgreSQL 18 (required: migrations call `uuidv7()`, a PostgreSQL 18 function) | `compose*.yaml`, `20261017220000_project_action_feed` |
| ORM | Prisma 7.10.1 with `@prisma/adapter-pg`; client generated into `src/generated` (git-ignored) | `prisma/schema.prisma` |
| Migrations | 25 SQL migrations in `prisma/migrations`, applied only by `prisma migrate deploy` (never at app start) | `Dockerfile` target `migrator`, `compose.prod.yaml` |
| Entry point | `node server.js` from `.next/standalone`, port 3000 | `Dockerfile` runner stage |
| File uploads | None. The application has no upload endpoint or attachment storage (T-4 open). | grep of `src` |
| Email | Never sent. Text is composed for copy and paste. No SMTP or Graph credentials exist. | D-017 |
| Local files written | Only database dumps (`pg_dump`) into `BACKUP_DIR` (`/backups`), by a superadmin action | `src/server/system/backup.ts` |
| Logging | `console.error` in 2 places (health, one other); no request log, no structured log | grep `console.` |

Layering: pure rules in `src/domain`, use cases in `src/server`, UI in `src/features` and `src/app` (CLAUDE.md, D-013).

## 2. Authentication and authorization

- Interim email and password sign-in (D-012). Passwords: scrypt N=2^16 (about 64 MiB per hash), 12 to 128 characters.
- **Remembered accounts (new since the first audit, D-029/D-030):** every sign-in of a non-admin role also stores a device credential (`device_credentials`, salted SHA-256 of a 256-bit token, single use: rotated on each use, 30 days, max 5 per browser, cookie `device_accounts` HttpOnly/SameSite=Lax/Secure in production). **Switch Account for those roles then needs no password** (`switchToRememberedAction`). ADMIN and SUPERADMIN are never remembered. The doc comment on `switchAccountAction` and D-026 still say "password always required"; that is now true only for admins and for accounts not remembered.
- Role permissions can be changed in the database (`role_permission_overrides`, D-032); `getCurrentUser()` loads them on every signed-in request (one extra query).
- Server-side sessions in table `sessions`; the cookie holds an opaque random token, only its SHA-256 is stored.
  Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, persistent. Session: 12 h idle, renewed while active,
  7 days absolute (`src/server/auth/session-policy.ts`, D-026).
- Roles: SUPERADMIN, ADMIN, SALES, SOA, PURCHASING, FINANCE, MANAGEMENT. One permission matrix (`src/domain/access/permissions.ts`),
  checked on the server by `requirePermission()` and again inside each service transaction against the stored role.
- Login failures return one generic message; unknown emails spend the same time as real checks.
- Audit log: append-only table (database triggers reject UPDATE, DELETE, TRUNCATE).
- **First superadmin:** there is no production mechanism. `prisma/seed.ts` refuses to run unless `APP_ENV` is `development` or `test`
  and creates `*@example.invalid` accounts with one shared password. All other data scripts (`import-projects`, `import-rfq-tickets`, `remap-owners`, `cleanup-dev-data`, `seed-sample`) carry the same APP_ENV guard (verified). `compose.prod.yaml` never passes `SEED_USER_PASSWORD`.
- **Rate limiting / lockout:** none (OPEN_QUESTIONS T-7).
- **CSRF:** no custom token. Mutations are Next.js Server Actions (framework Origin versus Host check) and SameSite=Lax cookies.
  The two route handlers that change anything: `POST /api/session/renew` (only extends the caller's own session).
- **Security headers:** only `Cache-Control: no-store` (added in D-026). No CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- **Server Actions origin:** `next.config.ts` sets `serverActions.allowedOrigins` to `localhost:<APP_HOST_PORT>`, `127.0.0.1:<APP_HOST_PORT>` and `ALLOWED_DEV_ORIGINS`, **evaluated at build time**. Behind Caddy with an unchanged `Host` the Origin matches and nothing more is needed; do not put the production host in `ALLOWED_DEV_ORIGINS`.
- **Trusted proxy:** the application reads no client IP and no `X-Forwarded-*` header today. It will need the client IP once login
  rate limiting exists.

## 3. Containers (as in `compose.prod.yaml`)

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:18.6-bookworm@sha256:afc7e2d4...` | Volume `postgres_data`, no published port, healthcheck, `no-new-privileges`, `shm_size 256mb`, log rotation 5 x 10 MB. |
| `migrate` | built from `Dockerfile` target `migrator` (profile `migrate`) | Runs `npx prisma migrate deploy` as user `node` with `prisma7.config.ts`. Explicit, never automatic. |
| `app` | built **on the host** from target `runner` | Non-root `node`, `cap_drop: ALL`, `no-new-privileges`, publishes `127.0.0.1:3000`, bind-mounts `${BACKUP_HOST_DIR}:/backups`, image `HEALTHCHECK` on `/api/health`. |

There is no reverse proxy, no TLS, no image registry reference, and no `.github/` directory (no workflow exists).
Development uses `compose.yaml` (db, app, and profile `test` services `db-test`, `app-test`, `e2e`) and must keep working.

## 4. Health

`GET /api/health` runs `SELECT 1` and returns `{status, checks:{database}}`: 200 or 503, `no-store`, no error detail.
It is both the container `HEALTHCHECK` and the only probe, so liveness and readiness are the same: a database outage marks the
app container unhealthy although the process is fine.

## 5. Build and test commands (verified in this repository)

| Gate | Command | Needs |
|---|---|---|
| Type check | `npm run typecheck` (`next typegen && tsc --noEmit`) | none |
| Lint | `npm run lint` (`--max-warnings=0`) | none |
| Unit | `npm test` | none |
| Integration | `npm run test:integration` | PostgreSQL 18, `APP_ENV=test`, `DATABASE_URL` (creates its own database per run, runs migrations) |
| E2E | `npm run test:e2e` | running app on `PLAYWRIGHT_BASE_URL`, `SEED_USER_PASSWORD`, fake `EMAIL_*` lists (owner triggers this) |
| Build | `npm run build` after `prisma generate` | none at build time (verified earlier with a local DB URL; to be re-verified without) |

Last measured by the owner (CLAUDE.md, 2026-10-20): unit 328/328, integration 317/317, E2E 127/130 (3 flakes pass alone), `next build` ok. My own run on 2026-10-18 (Node 22, PostgreSQL 16) was on an older commit.
These numbers need re-running on Node 24 and PostgreSQL 18 in CI.

## 6. ARM64 notes

- `package-lock.json` contains `linux-arm64-gnu` binaries for Next SWC, Tailwind oxide, lightningcss and others. No `sharp`, `bcrypt` or `argon2` runtime dependency.
- Password hashing uses Node's built-in scrypt.
- `docker/install-pg-client.sh` installs `postgresql-client-18` from PGDG (arm64 is published there) and checks the signing key fingerprint.
- **Not verified from here:** that the pinned `node` and `postgres` digests are multi-arch indexes that include `linux/arm64`. Docker Hub rejected the
  anonymous manifest request (HTTP 429) and no Docker daemon exists in this session. Verify with `docker buildx imagetools inspect <image>@<digest>`.

## 7. Target (proposal, not built)

```
Internet :443/:80 -> OCI security list -> VM (Ubuntu 24.04 ARM64)
  Caddy (container, ports 80/443, automatic HTTPS) -> app:3000 (internal network only)
  app -> db:5432 (internal network only, volume postgres_data)
  GHCR image (tag = commit SHA) pulled by a restricted deploy user; backups: pg_dump -> encrypted -> Object Storage
```
