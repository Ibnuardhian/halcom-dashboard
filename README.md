# Project Request & Fulfillment Tracker

Internal web application for project requests, ticketing and SLA monitoring:
Sales → SOA (BOQ) → Purchasing (RFQ/PO), with read-only visibility for Finance.

- Product requirements: [PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md)
- Engineering rules for people and AI agents: [AGENTS.md](AGENTS.md)
- Decisions: [docs/decisions/DECISIONS.md](docs/decisions/DECISIONS.md) · Open questions: [docs/requirements/OPEN_QUESTIONS.md](docs/requirements/OPEN_QUESTIONS.md)

> **Status: foundation plus access control.** The Docker environment, database, sign-in, roles
> (RBAC), a dashboard per role and a shared overview exist. The business modules (projects,
> tickets, email, SLA, exports) are **not built yet**, so most dashboard widgets show
> "No data yet" on purpose. The sign-in is an interim solution (see
> [DECISIONS.md D-012](docs/decisions/DECISIONS.md)) and is not ready for production.

Everything runs in Docker. You do **not** need Node.js, npm or PostgreSQL on the host.

## Stack

| Layer | Choice (pinned) |
|---|---|
| Runtime | Node.js 24.22.0 LTS: `node:24.22.0-bookworm-slim`, pinned by digest |
| Framework | Next.js 16.4.2 (App Router, Turbopack, Cache Components), React 19.3.0, TypeScript 5.9.3 |
| UI | Tailwind CSS 4.3.3, shadcn/ui (`base-nova` style on Base UI 1.9.0), lucide-react |
| Forms, tables, charts | React Hook Form 7.89.0 + Zod 4.6.5, TanStack Table 9.2.8, Recharts 3.10.1 (installed, not used yet) |
| Database | PostgreSQL 18.6: `postgres:18.6-bookworm`, pinned by digest |
| ORM and migrations | Prisma 7.10.1 with the `pg` driver adapter |
| Tests | Vitest 5.0.3 (unit, integration), Playwright 1.64.0 (E2E, official image) |
| Lint | ESLint 9.39.5 with eslint-config-next 16.4.2 |

## Prerequisites

- Docker Desktop with the WSL 2 backend (Windows), or Docker Engine on Linux.
  Docker Engine 25+ and Compose 2.20+ are required; tested with Engine 29.1.3 and Compose 2.40.3.
- Internet access for the first start and for builds (npm registry, Prisma engine download,
  Google Fonts during `next build`).
- About 5 GB of free disk space for images and volumes.

## Quick start

Run from the repository root. Commands are shown for PowerShell; they work unchanged in Bash
except `Copy-Item` (use `cp`).

1. Create the local configuration and generate a database password:

   ```powershell
   Copy-Item .env.example .env
   docker run --rm node:24.22.0-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
   ```

   Paste the printed value into `POSTGRES_PASSWORD` in `.env`.

2. Start the stack and wait until `app` shows `(healthy)`:

   ```powershell
   docker compose up -d
   docker compose ps
   ```

   The first start installs dependencies into a Docker volume, which takes 1–2 minutes.
   Follow it with `docker compose logs -f app`.

3. Create the database tables and the sample accounts (both safe to repeat):

   ```powershell
   docker compose run --rm app npm run db:migrate:deploy
   docker compose run --rm app npm run db:seed
   ```

4. Open http://localhost:3000 and sign in (next section). The health endpoint
   http://localhost:3000/api/health returns `{"status":"ok","checks":{"database":"ok"}}`.

Stop with `docker compose stop`, or `docker compose down` to also remove the containers.
Both keep your data.

> **Never run `docker compose down -v`** and never delete the `halcom-dashboard_postgres_data`
> volume: both permanently delete the database.

## Signing in and what you will see

The seed creates one synthetic account per role. All use the password in `SEED_USER_PASSWORD` in
your `.env` (`dev-only-change-me` unless you changed it).

| Email | Role | Lands on | Can also open |
|---|---|---|---|
| `superadmin@example.invalid` | Superadmin | `/dashboard/superadmin` | every dashboard, Users |
| `admin@example.invalid` | Admin | `/dashboard/admin` | all dashboards except Superadmin's, Users |
| `sales@example.invalid` | Sales | `/dashboard/sales` | Overview |
| `soa@example.invalid` | SOA | `/dashboard/soa` | Overview |
| `purchasing@example.invalid` | Purchasing | `/dashboard/purchasing` | Overview |
| `finance@example.invalid` | Finance | `/dashboard/finance` | Overview |
| `management@example.invalid` | Management | `/dashboard/management` | Overview |

Things to try:

1. Sign in as `sales@example.invalid`. You see **Overview** and **My dashboard** only. Typing
   `/dashboard/finance` in the address bar shows "This page could not be found".
2. Sign out, then sign in as `admin@example.invalid` and open **Users**. Create a user, change a role,
   reset a password or deactivate someone. The **Admin dashboard** lists each change under
   "Recent administrative activity".
3. Sign in as `superadmin@example.invalid`. The role list in **Users** now also offers Admin and Superadmin.

What is real today: sign-in, roles and permissions, user management, the audit trail, and the account
statistics on the Admin and Superadmin dashboards. What is a placeholder: every other widget, which
shows "No data yet" until the project and ticket modules exist. The rules are in
[docs/requirements/RBAC.md](docs/requirements/RBAC.md).

To change the password the seed uses, edit `SEED_USER_PASSWORD` for **new** accounts only: the seed never
overwrites existing users. Reset an existing account's password from the **Users** page.

## Everyday commands

`--no-deps` skips starting the database for commands that do not need it.

| Task | Command |
|---|---|
| Start / stop | `docker compose up -d` / `docker compose stop` |
| App logs | `docker compose logs -f app` |
| Shell in the app container | `docker compose exec app sh` |
| Lint | `docker compose run --rm --no-deps app npm run lint` |
| Type check | `docker compose run --rm --no-deps app npm run typecheck` |
| Unit tests | `docker compose run --rm --no-deps app npm test` |
| Integration tests | `docker compose --profile test run --rm app-test npm run test:integration` |
| E2E tests | `docker compose --profile test run --rm e2e` |
| Stop the test services | `docker compose --profile test stop app-test db-test` |
| Production build check | `docker compose run --rm --no-deps app npm run build`, then `docker compose restart app` |
| Add a dependency | `docker compose run --rm --no-deps app npm install <package>@<version>`, then `docker compose restart app` |
| Reinstall from the lockfile | `docker compose restart app` (or `docker compose run --rm --no-deps app npm ci`) |
| Create a migration | `docker compose run --rm app npx prisma migrate dev --name <change_name>` |
| Apply migrations | `docker compose run --rm app npm run db:migrate:deploy` |
| Migration status | `docker compose run --rm app npm run db:migrate:status` |
| Seed development data | `docker compose run --rm app npm run db:seed` |
| SQL shell | `docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'` |

## How the development environment works

| Service | Purpose | Data |
|---|---|---|
| `db` | PostgreSQL for development; `127.0.0.1:55432` on the host, `db:5432` inside Docker | `postgres_data` volume (persistent) |
| `app` | `next dev` on `127.0.0.1:3000`; the repository is bind-mounted at `/app` | `node_modules`, `npm_cache`, `next_dev` volumes |
| `db-test` (profile `test`) | Disposable PostgreSQL for automated tests | tmpfs, discarded when stopped |
| `app-test` (profile `test`) | Dev server connected to `db-test`; target of the E2E tests | `next_test` volume |
| `e2e` (profile `test`) | Playwright 1.64.0 with browsers; runs `tests/e2e` | none |

- **Dependencies** live in the `node_modules` volume, not on the host. On every container start,
  [docker/dev-entrypoint.sh](docker/dev-entrypoint.sh) runs `npm ci` if `package-lock.json`
  changed and regenerates the Prisma client into `src/generated/prisma` (git-ignored).
- **Hot reload** polls for changes (`NEXT_DEV_POLL_INTERVAL_MS`, default 1000 ms) because Docker
  Desktop does not forward file-change events from Windows drives into containers. Measured on
  the reference machine: edits appear within about 2 s, and the idle app container uses about 3 % CPU.
  For faster I/O, clone the repository inside the WSL 2 filesystem and set
  `NEXT_DEV_POLL_INTERVAL_MS=` (empty).
- **AGENTS.md is protected:** `agentRules: false` in [next.config.ts](next.config.ts) stops
  `next dev` from writing its own block into the project charter.
- **Editor support:** VS Code on the host cannot see the `node_modules` volume, so imports show
  as unresolved. Use *Dev Containers: Reopen in Container* with
  [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json), which attaches to the `app` service.

### Dependency policy

- Versions are exact (`save-exact`) and `package-lock.json` is committed; containers install with `npm ci`.
- [.npmrc](.npmrc) sets `min-release-age=7`: npm only resolves versions published at least 7 days
  ago. A security release may be exempted temporarily through `min-release-age-exclude`, with a
  dated comment explaining why.
- Install scripts run only for approved, version-pinned packages (`allowScripts` in
  [package.json](package.json)). After an upgrade, review with
  `docker compose run --rm --no-deps app npm install-scripts ls` and approve explicitly with
  `npm install-scripts approve <package>`.
- Before merging dependency changes, run `npm audit`, `npm audit --omit=dev` and `npm audit signatures`
  in the container.
- Keep the `e2e` image tag in [compose.yaml](compose.yaml) equal to the `@playwright/test` version.

## Database

Safety rules (see [AGENTS.md](AGENTS.md) §4):

- Never use `docker compose down -v`, `docker volume rm` on `postgres_data`, `prisma migrate reset`,
  `prisma db push --force-reset`, `DROP`, `TRUNCATE` or destructive seed scripts.
- If `prisma migrate dev` offers to reset the database, answer **No** and investigate the drift.
- Development commands use the `db` service (`APP_ENV=development`). Integration tests refuse to
  run unless `APP_ENV=test`, and the seed refuses to run outside `development` or `test`.

Schema change workflow:

1. Edit [prisma/schema.prisma](prisma/schema.prisma).
2. Run `docker compose run --rm app npx prisma migrate dev --name <change_name>`. This writes
   `prisma/migrations/<timestamp>_<change_name>/migration.sql` and applies it to the development database.
3. Review the generated SQL. Prefer additive changes; destructive or data-transforming migrations
   need an impact analysis, a backup and explicit approval.
4. Run `docker compose restart app` so the dev server picks up the regenerated client.
5. Commit the schema and the migration together. Integration tests apply all migrations to the
   disposable test database automatically.

Current tables: `users`, `sessions` and `audit_events` (migration `access_foundation`). The migration
adds constraints Prisma cannot express: lower-cased emails, and database triggers that make
`audit_events` append-only (UPDATE, DELETE and TRUNCATE are rejected). Users are deactivated, never deleted.

To connect a GUI client, use host `127.0.0.1`, port `55432` (`POSTGRES_HOST_PORT`) and the
credentials from `.env`.

## Testing

- **Unit** (`tests/unit`): Vitest, no database.
- **Integration** (`tests/integration`): Vitest against real PostgreSQL. Runs in `app-test` against the
  tmpfs `db-test`; every run creates its own empty database there and applies all migrations to it.
- **E2E** (`tests/e2e`): Playwright with Chromium. Runs in `e2e`, which shares the network of `app-test`,
  so the browser uses `http://localhost:3000`. `app-test` migrates and seeds the disposable database each
  time it starts. The suite signs in as every role and checks menus, forbidden pages (by delivered HTML,
  not status code, see D-015) and user management. Reports go to `playwright-report/` (open
  `playwright-report/index.html`) and traces to `test-results/`, both git-ignored.
- Retries are disabled, so a flaky test fails visibly.

Quality gates before a pull request: lint → type check → unit → integration → E2E → build.

## Production

[compose.prod.yaml](compose.prod.yaml) defines:

- `db`: persistent volume, not published to the host.
- `app`: the standalone Next.js server. It runs as a non-root user with all Linux capabilities
  dropped, and its application files are read-only.
- `migrate`: a one-off migration runner (profile `migrate`).

The project name `halcom-dashboard-prod` keeps production volumes separate from development.

On the Docker host:

```bash
cp .env.example .env    # set strong POSTGRES_* values; never commit this file
docker compose -f compose.prod.yaml --profile migrate build
docker compose -f compose.prod.yaml up -d --wait db
docker compose -f compose.prod.yaml run --rm migrate    # explicit, reviewed step
docker compose -f compose.prod.yaml up -d --wait app
curl -fsS http://127.0.0.1:3000/api/health
```

- The app is published on `APP_BIND_ADDRESS:APP_PORT` (default `127.0.0.1:3000`). Put a
  TLS-terminating reverse proxy in front of it.
- Migrations never run on app start. Back up the database before applying migrations.
- Container logs rotate (json-file, 5 × 10 MB per container).
- This sequence was smoke-tested locally with a disposable database (migrations, health check, login
  page, and protected routes returning no content without a session). A real deployment target has not
  been chosen yet.
- **Not ready for real users yet.** There is no way to create the first superadmin in production
  (the seed refuses to run there), no login rate limiting, and the sign-in is an interim solution.
  See D-012 and the open questions T-7 to T-9. The session cookie is `Secure` in production, so serve
  the app over HTTPS.

## Backups

These commands avoid shell redirection, which corrupts binary dumps in PowerShell. For production,
add `-f compose.prod.yaml` after `docker compose`.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose exec db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --format=custom --file=/tmp/backup.dump'
docker compose cp db:/tmp/backup.dump "backups/halcom-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
docker compose exec db rm /tmp/backup.dump
```

Restore into a **new** database, which leaves existing data untouched:

```powershell
docker compose cp backups/<file>.dump db:/tmp/restore.dump
docker compose exec db sh -c 'createdb -U $POSTGRES_USER halcom_restore && pg_restore -U $POSTGRES_USER -d halcom_restore --no-owner /tmp/restore.dump'
```

Replacing a live database requires an approved plan (AGENTS.md §4). Backup frequency, retention
and off-site storage are still open decisions.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `required variable POSTGRES_USER is missing a value` | `.env` is missing. Copy `.env.example` to `.env` (Quick start, step 1). |
| `ports are not available ... An attempt was made to access a socket in a way forbidden by its access permissions` | The host port is in use (often a locally installed PostgreSQL on 5432) or reserved by Windows. Change `APP_HOST_PORT` or `POSTGRES_HOST_PORT` in `.env`. List reserved ranges with `netsh interface ipv4 show excludedportrange protocol=tcp`. Do not stop a local PostgreSQL service unless you know what it holds. |
| `app` stays `starting` | The first start runs `npm ci`. Check `docker compose logs -f app`. |
| `password authentication failed` after editing `.env` | PostgreSQL stores the credentials when the volume is first created; editing `.env` later does not change them. Restore the previous values in `.env`, or change the password inside the database: `docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'`, then `ALTER USER <user> WITH PASSWORD '<new>';`. |
| Edits do not hot-reload | Make sure `NEXT_DEV_POLL_INTERVAL_MS` is set (default 1000) and restart: `docker compose up -d`. |
| `Cannot find module` after pulling changes | The lockfile changed. Run `docker compose restart app`. |
| `npm error code ECONNRESET` during a build or install | A transient network failure. Retry the command; behind a proxy, configure npm and Docker proxy settings. |
| `watch error (...): ... No such file or directory` in app logs | Harmless: the polling watcher reports optional packages that are not installed. |
| E2E fails right after a Playwright upgrade | The `e2e` image tag in `compose.yaml` must match `@playwright/test` in `package.json`. |
| New pages return 404 in development after running `npm run build` | The build shares the `.next` volume with the running dev server and can leave its route table stale. Run `docker compose restart app`. |
| `/bin/sh^M: bad interpreter` | A script was checked out with CRLF line endings. [.gitattributes](.gitattributes) enforces LF; re-checkout the file. |
| `prisma migrate dev` asks to reset the database | Answer **No**. The schema and migration history have drifted; investigate before changing anything. |
| Dependencies are corrupted and need a clean reinstall | Run `docker compose run --rm --no-deps app npm ci`. Only if that fails, recreate the dependency volume: `docker compose stop app`, `docker volume rm halcom-dashboard_node_modules`, `docker compose up -d`. This volume only holds packages, never database data. |
