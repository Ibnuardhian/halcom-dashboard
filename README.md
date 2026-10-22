# Halcom Dashboard

*Project Request & Fulfillment Tracker.* Internal web application for project requests, ticketing and SLA
monitoring: Sales → SOA (BOQ) → Purchasing (RFQ/PO), with read-only visibility for Finance.

- Product requirements: [PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md)
- Engineering rules for people and AI agents: [AGENTS.md](AGENTS.md)
- Decisions: [docs/decisions/DECISIONS.md](docs/decisions/DECISIONS.md) · Open questions: [docs/requirements/OPEN_QUESTIONS.md](docs/requirements/OPEN_QUESTIONS.md)

> **Status: projects, requests and email text exist; SLA, tasks, charts and exports do not yet.**
> Built: Docker environment, sign-in, roles (RBAC), a responsive sidebar app, projects with a sales
> pipeline view (importable from the sales export), BOQ / RFQ / PO requests with numbered IDs and
> status history, the SOA to Purchasing handover, copy-and-paste email text, a current / next action update
> feed per project, SOA editing of technical fields with a change log, user management, audit log, own-password change and database backup.
> Not built: SLA tracking, SOA tasks and Kanban, Sales targets, KPI charts, Finance cross-check, Excel
> export, attachments. The sign-in is an interim solution ([D-012](docs/decisions/DECISIONS.md)) and is
> not ready for production.

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

3. Create the database tables, the development accounts and the sample data (all safe to repeat; the sales-export import is optional, see
   [Importing the sales export](#importing-the-sales-export)):

   ```powershell
   docker compose run --rm app npm run db:migrate:deploy
   docker compose run --rm app npm run db:seed          # accounts, principals, solutions, PICs
   docker compose run --rm app npm run db:seed:sample   # sample projects with BOQ, RFQ and PO requests
   ```

   Details of what each command adds, and of the cleanup script, are in [Seeding and cleaning development data](#seeding-and-cleaning-development-data).

4. Open http://localhost:3000 and sign in (next section). The health endpoint
   http://localhost:3000/api/health returns `{"status":"ok","checks":{"database":"ok"}}`.

Stop with `docker compose stop`, or `docker compose down` to also remove the containers.
Both keep your data.

> **Never run `docker compose down -v`** and never delete the `halcom-dashboard_postgres_data`
> volume: both permanently delete the database.

## Signing in and what you will see

The seed creates one synthetic account per role. All use the password in `SEED_USER_PASSWORD` in
your `.env` (`dev-only-change-me` unless you changed it). Each time the development seed or the project
import runs it writes **`DEV_ACCOUNTS.md`** in the repository root: a cheat sheet with every email, the
password and the page each account lands on, including the named accounts created by the import. That file is
listed in `.gitignore` and `.dockerignore` because it contains a password, so it is never committed or copied
into an image. It is written only for the development database, never for the test database.

Open the app at **http://localhost:3000** or **http://127.0.0.1:3000**. The development server refuses scripts from
any other host name, so a different address renders the page without making it interactive (menus and buttons do
nothing). To test from a phone, add the PC's LAN address to `ALLOWED_DEV_ORIGINS` in `.env` and restart the `app` container.

| Email | Role | Lands on | Can also open |
|---|---|---|---|
| `superadmin@example.invalid` | Superadmin | `/dashboard/superadmin` | every dashboard, Users, Audit log, Backups, System |
| `admin@example.invalid` | Admin | `/dashboard/admin` | all dashboards except Superadmin's, Users, Audit log |
| `sales@example.invalid` | Sales | `/dashboard/sales` | Overview, Projects, requests, New request |
| `soa@example.invalid` | SOA | `/dashboard/soa` | Overview, Projects (edits technical fields), requests |
| `purchasing@example.invalid` | Purchasing | `/dashboard/purchasing` | Overview, Projects, requests |
| `finance@example.invalid` | Finance | `/dashboard/finance` | Overview, Projects, requests (read-only) |
| `management@example.invalid` | Management | `/dashboard/management` | Overview, Projects, requests (read-only) |

### The modules in the sidebar

The sidebar groups what a role may open (it is derived from the permission matrix in
[RBAC.md](docs/requirements/RBAC.md), so it never offers a page the server would refuse). On a phone it
becomes a drawer behind the menu button.

| Module | What it does |
|---|---|
| **Projects** | Pipeline list with filters (stage, status, principal, search) and a project page with Overview, Technical, Activity and Requests sections. |
| **BOQ / RFQ / PO requests**, **New request** | Numbered requests (`BOQ-SA-260001`, `RFQ-IA-260001`, `PO-...`) with filters by status. The request page has the email text and the status history. |
| **Account** (your name, bottom of the sidebar) | Change your own password. |
| **Users**, **Audit log** (admins) | Accounts and roles; every administrative and workflow change. |
| **Backups**, **System** (superadmin) | Database dump to the host folder; live application and database figures. |

### Things to try

1. Sign in as `sales@example.invalid`, open **Projects → New project**, then **New BOQ** on the project page.
   After saving you get **To, Cc, Subject and the default text** (with the request ID) to copy into Outlook.
   The application never sends mail. The lists in `EMAIL_TO_HITBOQ` and the others in `.env` fill To and Cc.
2. Sign in as `soa@example.invalid`, open that BOQ and move it to *In progress*, then *Completed*. A **Hand over to
   Purchasing** card appears: choose **RFQ** or **PO**. The new request keeps the project and points back to the BOQ;
   its page tells you to reply inside the original `[HITBOQ]` thread in Outlook.
3. As SOA open a project and go to **Activity**: write an update, choose *Current action* (what was done) or *Next action* (what comes
   after it) and **Post update**. It works like comments: the feed shows each entry with who wrote it and when, newest first, the
   page highlights the last two current actions and the latest next action, and entries are never edited. Under **Technical** SOA
   can also save the technical fields; each change is logged with its old and new value. Sales sees the same page but no forms.
   There is no way to edit values, probability, stage or status as SOA.
4. Sign in as `admin@example.invalid` and open **Users** and **Audit log**. Create a user, change a role, reset a
   password or deactivate someone; the Audit log lists each change.
5. Sign in as `superadmin@example.invalid`: **Backups** writes a dump to the host folder, **System** shows live figures,
   and the **Theme** selector in the sidebar switches Light, Dark or System (stored in that browser only).

Typing a URL your role may not open (for example `/admin/backups` as Sales) shows "This page could not be found".

What is real today: everything above. What is still a placeholder: dashboard widgets that need SLA targets, milestones
or tasks, which show "No data yet" instead of invented numbers.

Editing `SEED_USER_PASSWORD` only affects accounts created afterwards: the seed never overwrites existing
users, so `DEV_ACCOUNTS.md` can then be out of date. Change an existing account's password from the **Account** page,
or reset it from the **Users** page.

### Importing the sales export

`prisma/data/projects_export_2026-10-17.csv` (git-ignored: it holds real customer names and values) is loaded with:

```powershell
docker compose run --rm app npm run db:import-projects -- --dry-run   # report only, writes nothing
docker compose run --rm app npm run db:import-projects               # import
```

It maps every column, creates the customers, principals (brands) and solution categories, and one account per person
named as Sales PIC (role Sales) or Technical PIC (role SOA), with the password of `SEED_USER_PASSWORD`. It only adds:
projects that already exist, existing users and their passwords are never changed, so it is safe to run again. The whole
file is imported in one transaction or not at all, and any problem in the file is listed before anything is written.
It refuses to run outside development and test. A different file can be given as the first argument.

### Seeding and cleaning development data

Migrations and seeding are separate steps. Neither deletes, resets or truncates anything, and both refuse to run outside `development` or `test`.

| Command | Adds | Safe to repeat |
|---|---|---|
| `npm run db:migrate:deploy` | Applies the pending migrations (schema only) | yes |
| `npm run db:seed` | One account per role, the Sales accounts `dzaki@` and `satrio@`, the principals Fortinet, HPE and Cisco, three solution categories and three PICs. Needs `SEED_USER_PASSWORD` in `.env`. | yes: existing records and passwords are never changed |
| `npm run db:seed:sample` | Five fictional projects (four owned by Dzaki or Satrio, one registered by SOA for an outside source) with BOQ, RFQ and PO requests at different stages. Run after `db:seed`. | yes: fixed idempotency keys `seed-dev-v1:...`; nothing is overwritten |

A fresh clone therefore needs: `docker compose up -d`, `db:migrate:deploy`, `db:seed`, `db:seed:sample`. Role permissions need no seed: the defaults are in code, and the
Permissions page stores only what a superadmin changes.

`npm run db:cleanup-dev` (D-032) is for a development database that already holds test data. It reports first and changes nothing until `--apply`:

```powershell
docker compose run --rm app npm run db:cleanup-dev                                   # dry run: accounts, test projects, what is left alone
docker compose run --rm app npm run db:cleanup-dev -- --apply                        # one transaction, recomputed and verified inside it
docker compose run --rm app npm run db:cleanup-dev -- --date=2026-10-17 --tz=UTC     # the day and time zone to look at (these are the defaults)
```

It deletes the obsolete accounts listed in `prisma/seed-users.ts` when nothing refers to them, and otherwise deactivates and signs them out. It also
marks the test projects of that day deleted the way the application does (their requests and history stay). A project counts as test data only when it was
created that day through the form, was not imported from the sales export and has a placeholder company such as `PT ABCD`; everything else is reported and left alone.
Take a backup first (Backups page or `pg_dump`).

### Loading the RFQ tracker

`prisma/data/hit_rfq_tickets_2026-10-20.csv` (git-ignored: customer names and e-mail addresses) is the RFQ ticket sheet. `npm run db:import-rfq` turns each ticket into an RFQ request with its status history, PIC and project (D-035). It reports first with `--dry-run`, runs in one transaction, only adds and skips tickets already loaded, so it is safe to repeat.

For a **new database**, `npm run db:rfq-sql` writes the same data as one SQL file, `prisma/data/hit_rfq_tickets_import.sql`. Load it after the schema and the development accounts exist:

```powershell
docker compose run --rm app npm run db:migrate:deploy
docker compose run --rm app npm run db:seed
docker compose exec -T db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -v ON_ERROR_STOP=1' < prisma/data/hit_rfq_tickets_import.sql
```

Request codes are `RFQ-S-260001`: the type, one letter from the requester's e-mail address (two if another person already has that letter), the year and a number.

### Correcting Sales accounts and project ownership

`npm run db:remap-owners` applies the reviewed ownership correction of D-031 (rename `mas.dzaki@` to `dzaki@`, move the projects of `soraya@` to
Dzaki and of `gusti@` to Satrio, every other internal project becomes source Other). It only reports until `--apply` is added, runs in one
transaction and refuses outside development and test. Take a backup first (Backups page or `pg_dump`).

```powershell
docker compose run --rm app npm run db:remap-owners              # dry run: counts, conflicts, warnings
docker compose run --rm app npm run db:remap-owners -- --apply   # apply
```

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
| Seed development data | `docker compose run --rm app npm run db:seed`, then `npm run db:seed:sample` |
| Load the RFQ tracker (CSV) | `docker compose run --rm app npm run db:import-rfq -- --dry-run`, then without `--dry-run` |
| Write the RFQ tracker as one SQL file | `docker compose run --rm app npm run db:rfq-sql` (writes `prisma/data/hit_rfq_tickets_import.sql`) |
| Clean up development data (dry run) | `docker compose run --rm app npm run db:cleanup-dev` |
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
- **Hot reload is off by default.** Docker Desktop does not forward file-change events from Windows drives into
  containers, and the polling workaround (`NEXT_DEV_POLL_INTERVAL_MS=1000`) made the open page reload itself every
  second on this setup, so menus and buttons reset. After editing code run `docker compose restart app`. If you clone the
  repository inside the WSL 2 filesystem, file events work and hot reload needs no polling.
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
  time it starts and has polling turned off (with polling, Next dev restart-looped under Docker Desktop and
  pages reloaded endlessly). The suite signs in as every role and checks menus, forbidden pages (by delivered HTML,
  not status code, see D-015), user management, the project and request flow, the email text, the handover,
  SOA editing with the change log, backups, the account page and the phone layout. Reports go to `playwright-report/` (open
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

**From the application (superadmin):** **Backups** in the sidebar writes a full `pg_dump` (custom format) to the
folder mounted at `/backups`, which is the host folder `BACKUP_HOST_DIR` (default `./backups`, git-ignored). A file is
written as `.partial`, checked with `pg_restore --list`, then renamed `halcom-YYYYMMDD-HHMMSSZ.dump` (UTC). The application
never overwrites, deletes or restores a backup, and there is no download button, because the dump holds all business
data. Retention and off-machine copies are not decided yet (OPEN_QUESTIONS T-11): copy the folder somewhere safe yourself.
On Linux the host folder must be writable by uid 1000 (the `node` user in the image).

**From the command line** (works without the application):

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
| New columns or tables exist but pages fail with `Cannot read properties of undefined (reading 'findMany')` | After a migration the running dev server still holds the old Prisma client. Run `docker compose restart app`. |
| `pg_dump is not installed in this container` on the Backups page | The image predates the PostgreSQL client. Run `docker compose build app` and `docker compose up -d`. |
| Edits do not show up | Hot reload is off by default: run `docker compose restart app`. |
| The page reloads by itself, or menus and buttons close at once | The dev server is polling files (`NEXT_DEV_POLL_INTERVAL_MS` set). Leave it empty and run `docker compose up -d --force-recreate app`. Also open the app at `localhost` or `127.0.0.1`, not another host name (see `ALLOWED_DEV_ORIGINS`). |
| `Cannot find module` after pulling changes | The lockfile changed. Run `docker compose restart app`. |
| `npm error code ECONNRESET` during a build or install | A transient network failure. Retry the command; behind a proxy, configure npm and Docker proxy settings. |
| `watch error (...): ... No such file or directory` in app logs | Harmless: the polling watcher reports optional packages that are not installed. |
| E2E fails right after a Playwright upgrade | The `e2e` image tag in `compose.yaml` must match `@playwright/test` in `package.json`. |
| New pages return 404 in development after running `npm run build` | The build shares the `.next` volume with the running dev server and can leave its route table stale. Run `docker compose restart app`. |
| `/bin/sh^M: bad interpreter` | A script was checked out with CRLF line endings. [.gitattributes](.gitattributes) enforces LF; re-checkout the file. |
| `prisma migrate dev` asks to reset the database | Answer **No**. The schema and migration history have drifted; investigate before changing anything. |
| Dependencies are corrupted and need a clean reinstall | Run `docker compose run --rm --no-deps app npm ci`. Only if that fails, recreate the dependency volume: `docker compose stop app`, `docker volume rm halcom-dashboard_node_modules`, `docker compose up -d`. This volume only holds packages, never database data. |
