# Decision Log

Material technical decisions, newest last. Business rules stay in
[PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](../../PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md);
unresolved items are tracked in [OPEN_QUESTIONS.md](../requirements/OPEN_QUESTIONS.md).

## D-001 Docker-first development and deployment

- **Date:** 2026-10-17 · **Status:** Accepted
- **Context:** The team must not need Node.js, npm or PostgreSQL on Windows hosts. Install,
  dev server, migrations, seeding, linting and testing must all run through Docker Compose,
  reproducibly.
- **Decision:** One multi-stage [Dockerfile](../../Dockerfile) with `dev`, `migrator` and `runner` targets.
  [compose.yaml](../../compose.yaml) is the development stack (bind-mounted source; named volumes for
  `node_modules`, the npm cache, the Next.js output and PostgreSQL data).
  [compose.prod.yaml](../../compose.prod.yaml) is the production stack, with a different project name so
  its volumes can never mix with development data. Health checks exist for every long-running service.
- **Consequences:** Host editors cannot see `node_modules`; an optional Dev Container config is
  provided. File watching needs polling on Windows drives (D-008).

## D-002 Runtime and image pins

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - `node:24.22.0-bookworm-slim`, pinned by multi-arch index digest. Node 24 is the Active LTS
    (maintenance until April 2028). Node 26 is not LTS until late October 2026.
  - `postgres:18.6-bookworm`, pinned by digest. PostgreSQL 18 images keep data under
    `/var/lib/postgresql/18/docker`, so the volume mounts at `/var/lib/postgresql`.
  - `mcr.microsoft.com/playwright:v1.64.0-noble`, pinned by digest and kept equal to `@playwright/test`.
  - OpenSSL is installed only in stages that run the Prisma CLI. Debian packages are not
    version-pinned; the base image digest bounds them.
- **Consequences:** Upgrades are explicit edits of tag and digest. Renovate or Dependabot can
  automate them later.

## D-003 Dependency pinning and supply-chain policy

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Exact versions (`save-exact`) plus a committed lockfile; containers install with `npm ci`.
  - npm `min-release-age=7` (7-day cooldown) applies to the whole tree. Temporary, dated exemptions
    exist only for security releases:
    - Next.js 16.4.1+ fixes critical advisories (unauthenticated RCE in `use cache` and Image
      Optimization, DoS in Server Actions), so 16.4.0 must not be used.
    - Prisma 7.10.1 upgrades mysql2 and deepmerge-ts (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3,
      GHSA-ggr8-5vv4-36mx).
  - Install scripts run only for version-pinned approvals in `allowScripts`: `prisma` (preinstall),
    `@prisma/engines` (downloads the schema engine), `esbuild` and `unrs-resolver` (native binaries).
    Each script was reviewed before approval.
  - The npm `latest` tag is not trusted blindly. On 2026-10-17, `prisma@latest` pointed to
    `8.0.0-rc.23` while `@prisma/client@latest` was 7.10.1.
- **Evidence (2026-10-17):** `npm audit --omit=dev` reports 0 vulnerabilities. All 569 packages had
  verified registry signatures and 167 had provenance attestations.
- **Consequences:** Remove the exemptions in [.npmrc](../../.npmrc) after 2026-10-23.

## D-004 Framework baseline from the brief

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Next.js 16.4.2 scaffolded with `create-next-app@16.4.2`, keeping its defaults:
    - App Router, `src/`, Turbopack, and `@/*` imports.
    - `cacheComponents: true` and `partialPrefetching: true`.
    - Tailwind CSS 4 loaded through the `@tailwindcss/turbopack` loader, with no PostCSS config.
    - TypeScript 5.9.3 (template range `^5`).
  - `output: "standalone"` for the production image.
  - shadcn/ui 4.21.4 initialised with its defaults: the `base-nova` style on Base UI, neutral base
    color and lucide icons. `cn` comes from the official `cn` package (shadcn-ui/cn); the
    `src/lib/utils.ts` re-export exists only for the shadcn alias. The `shadcn` package is a
    devDependency because only its CSS is imported, at build time.
  - ESLint 9.39.5, which is end-of-life. eslint-config-next 16.4.2 still depends on
    `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, which do not support
    ESLint 10 yet.
  - React Hook Form, Zod, TanStack Table and Recharts are installed per the brief (§13) but not used yet.
    TanStack Table v9 replaces `useReactTable` with `useTable`, and `useLegacyTable` exists for v8-style
    code. shadcn data-table examples still use the v8 API.
- **Consequences:** With Cache Components, routes render at request time unless cached
  explicitly. Request-time route handlers call `connection()` (see `/api/health`).

## D-005 Prisma 7 with the PostgreSQL driver adapter

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - The `prisma-client` generator writes to `src/generated/prisma` (git-ignored, regenerated by the dev
    entrypoint and the image build).
  - The client uses `@prisma/adapter-pg` with a 5 s connection timeout and is created lazily, so
    builds never connect to a database.
  - Configuration lives in `prisma7.config.ts`, the file name Prisma 7.10 looks for first
    (`prisma.config.ts` is its legacy fallback). It does not load `.env`; Docker Compose injects
    `DATABASE_URL`.
  - Project and ticket models are not defined yet. They depend on open business decisions and the
    conceptual model in brief §11. The access models arrived in D-012.
- **Consequences:** `migrate status` exited with code 1 until the first migration existed (D-012).

## D-006 Authentication library not installed

- **Date:** 2026-10-17 · **Status:** Superseded by D-012 for the interim solution
- **Context:** The brief allows "Auth.js or another approved internal authentication solution" and
  Phase 0 requires confirming authentication needs. On 2026-10-17, Auth.js v5 (`next-auth@5`) was
  still a beta (`5.0.0-beta.32`).
- **Decision:** Install nothing until the approach is chosen (OPEN_QUESTIONS T-1). The approach
  determines the users/roles schema, so domain tables wait for it as well.

## D-007 Test isolation

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Unit tests: Vitest, no I/O.
  - Integration tests: Vitest against the `db-test` service, whose data lives in tmpfs. The
    global setup refuses to run unless `APP_ENV=test`, creates a fresh empty database named
    `halcom_it_<random>` for the run (nothing is dropped; the tmpfs is discarded when the service
    stops) and applies all migrations to it. Runs therefore cannot interfere with each other or with
    the data `app-test` seeds into `halcom_test` for E2E.
  - `app-test` applies migrations and seeds synthetic users each time it starts.
  - E2E tests: Playwright in the official image, against `app-test` (a dev server wired to
    `db-test`). The `e2e` container shares the `app-test` network namespace, so the browser loads
    `localhost` and Next.js's cross-origin protection for dev resources stays on.
  - No automatic retries.
- **Consequences:** Tests can never write to the development database, and no test needs a
  database reset.

## D-008 Hot reload by polling on Windows drives

- **Date:** 2026-10-17 · **Status:** Accepted
- **Context:** A probe confirmed that file changes on a Windows drive produce no inotify events
  inside containers. Next.js advises polling only as a last resort.
- **Decision:** `watchOptions.pollIntervalMs` is enabled only when `NEXT_DEV_POLL_INTERVAL_MS` is set,
  which `compose.yaml` does by default (1000 ms). Measured: edits visible in about 2 s, idle app
  container at about 3 % CPU. A repository inside WSL 2 can turn polling off.

## D-009 Explicit production migrations

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:** Migrations run only through the `migrate` service (profile `migrate`), never on app
  start (brief §20.2). The app does not depend on the migration service.
- **Consequences:** The `migrator` image contains all development dependencies (1.71 GB) because
  the Prisma CLI is a devDependency. Slimming it is a possible follow-up.

## D-010 Next.js must not edit AGENTS.md

- **Date:** 2026-10-17 · **Status:** Accepted
- **Context:** Next.js 16.4 `next dev` appends a managed block to `AGENTS.md` when it detects an AI
  coding agent (`dist/server/lib/generate-agent-files.js`).
- **Decision:** `agentRules: false` in `next.config.ts`. With that setting Next.js only removes its
  own marked block, and this project's charter has none. A hash check confirmed AGENTS.md is
  unchanged after `next dev` runs.

## D-011 Accepted residual risks

- **Date:** 2026-10-17 · **Status:** Accepted, review monthly
- **Decision and rationale:**
  - **`braces` ≤ 3.0.3, GHSA-vfj7-8cjw-p6xm (high, stack-exhaustion DoS):** no patched version
    exists. It is reached through `fast-glob`/`micromatch` in development and build tools only
    (eslint-config-next, shadcn CLI, ts-morph). It is absent from the production runtime image, which
    was verified. `npm audit` shows 9 entries for this one advisory.
  - **ESLint 9 end of life:** blocked by eslint-config-next (D-004). It is a development tool only.
  - **Development PostgreSQL published on `127.0.0.1:55432`:** loopback only. Port 55432 avoids
    clashing with locally installed PostgreSQL servers.

## D-012 Interim authentication: database sessions

- **Date:** 2026-10-17 · **Status:** Accepted as interim; replace if OPEN_QUESTIONS T-1 chooses SSO
- **Context:** RBAC and per-role dashboards need a signed-in user, but the approved authentication
  approach (T-1) is undecided. Auth.js v5 was still a beta; Better Auth and Auth.js v4 were not evaluated.
- **Decision:** Email and password sign-in with server-side sessions.
  - Passwords: scrypt (N=2^16, r=8, p=1) via `node:crypto`, salted, cost stored in the hash, NFKC-normalised.
    Unknown emails spend the same time as wrong passwords, and every failure returns one generic message.
  - Sessions: a 32-byte random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production);
    only its SHA-256 is stored; 12 hours absolute; role and active flag are re-read on every request, so
    deactivation and role changes apply immediately.
  - No authentication library was added, so there is no new dependency or install script. All of it sits
    behind `getCurrentUser()`, `requireUser()` and `requirePermission()`, so SSO can replace it without
    touching pages.
- **Known gaps (not acceptable for production):** no login rate limiting or lockout; no password-change
  screen (admins reset passwords); no first-superadmin bootstrap for production (the seed refuses to run
  there); failed sign-ins are not logged. See OPEN_QUESTIONS T-7 to T-9.

## D-013 RBAC model

- **Date:** 2026-10-17 · **Status:** Accepted as a proposal; visibility policy still open (brief §17)
- **Decision:** One role per user (`SUPERADMIN`, `ADMIN`, `SALES`, `SOA`, `PURCHASING`, `FINANCE`,
  `MANAGEMENT`), explicit permissions in one pure module, a dashboard per role plus a shared overview.
  The matrix, rules and assumptions are in [docs/requirements/RBAC.md](../requirements/RBAC.md).
- **Authorization:** every page and server action re-checks the permission on the server; the menu is only
  derived from the same matrix. Account changes run in a transaction with an advisory lock, re-verify the
  actor from the database, and write an audit event in the same transaction. `audit_events` is
  append-only through database triggers, and users are never deleted (deactivated instead).
- **Consequences:** Sales, SOA, Purchasing, Finance and Management dashboards show "no data yet" until
  the project and ticket modules exist. They show no numbers, because the brief forbids fabricated
  analytics.

## D-014 SOA handover email (business decisions from the product owner)

- **Date:** 2026-10-17 · **Status:** Confirmed by the user; the delivery part is superseded by D-017
- **Decision:** After SOA replies to the `[HITBOQ]` email sent to the SOA team, the outgoing message becomes
  `[HITRFQ] {EndUserCompany} - {ProjectName}` or `[HITPO] ...`, addressed to the Purchasing team.
  - SOA may choose either `[HITRFQ]` or `[HITPO]` at handover, as the brief requires (§6.4); neither is assumed.
  - The reply **must stay in the same mail thread** as the `[HITBOQ]` email.
- **Consequence:** a `mailto:` link cannot set threading headers, so `outlook_draft` mode cannot meet the
  threading requirement for this step. A thread-preserving reply needs Microsoft Graph (reply to the original
  message, then address it to Purchasing and change the subject). That depends on tenant consent, mailbox
  identity and the stored original message ID (OPEN_QUESTIONS B-3). Whether Outlook keeps a thread when the
  subject prefix changes must be verified against the real tenant.

## D-016 Superadmin tooling

- **Date:** 2026-10-17 · **Status:** Confirmed by the user; partly implemented
- **Decision:** Admins may add other operational users (already implemented). Superadmin additionally gets
  development and operations tools: switching the UI theme, monitoring application performance, and database
  backup, "and more".
  - Theme switcher and the System monitoring page are implemented, restricted to `SUPERADMIN`
    (permissions `theme.switch` and `system.monitor`).
  - Backup is implemented as D-021 (host folder). Password change for other users already existed (Users page, reset).
- **Notes:** the theme switch is a per-browser preference, so the permission only controls who sees the
  control. The monitoring page reads counts, sizes and timings only; it never shows query text or row data.

## D-015 Next.js rendering rules for signed-in pages

- **Date:** 2026-10-17 · **Status:** Accepted
- **Decision:**
  - Pages that read the session render behind `<Suspense>`, and `getCurrentUser()` calls `connection()`
    first so a session check never runs while prerendering.
  - Each page wraps its per-user content in its own `<Suspense>`. A `loading.tsx` was tried and the
    development validator did not count it.
  - `(app)/layout.tsx` exports `instant = false`: the session cannot be cached ahead of time, because a
    deactivated user must lose access immediately, and validation renders without a session.
  - A forbidden or unknown URL renders the not-found UI with none of the page content, but the HTTP
    status stays 200, because Cache Components streams the response before the check runs. E2E tests
    therefore assert on the delivered HTML. `forbidden()` was not used because it is experimental.

## D-017 Email is copy-and-paste only (supersedes the delivery part of D-014)

- **Date:** 2026-10-17 · **Status:** Confirmed by the user; implemented
- **Decision:** The application never sends mail and never opens Outlook. A request page shows **To, Cc,
  Subject and a default text** (containing the request ID) for the user to copy into Outlook.
  - Recipients come from `EMAIL_TO_HITBOQ` / `EMAIL_CC_HITBOQ` (and `HITRFQ`, `HITPO`) in the server
    environment. A missing or invalid list shows a configuration error, never another group's list.
  - Subject: `[HITBOQ|HITRFQ|HITPO] {EndUserCompany} - {ProjectName}` (brief §6.4). The text carries the request
    ID, project ID, requester, needed-by date, the source BOQ on a handover, and a link (`APP_BASE_URL`).
  - Shown only to roles that send these emails (Sales, SOA, admins).
- **Consequence:** the same-thread requirement of D-014 is met by the user replying inside the original
  `[HITBOQ]` thread in Outlook; the handover page tells them to do so. **Microsoft Graph is not needed**, so
  OPEN_QUESTIONS B-3 is withdrawn and the `microsoft_graph_send` mode and the email outbox are not built.
  There is no delivery log, because the application cannot know what was sent.

## D-018 Request and project numbering

- **Date:** 2026-10-17 · **Status:** Confirmed by the user (format); counter scope is an assumption
- **Decision:**
  - Requests: `BOQ-<initials>-YY0001`, `RFQ-<initials>-YY0001`, `PO-<initials>-YY0001`, for example `RFQ-IA-260001`.
    The sequence restarts per type, per initials and per year (assumption, OPEN_QUESTIONS T-13). Initials come from the
    requester's email address: `ibnu.ardhian@x` gives `IA`, `sales@x` gives `SA`. The two-digit year uses the Asia/Jakarta time zone.
  - Projects: `PRJ-001`, `PRJ-002`, ... one unbroken sequence, matching the sales export. The counter continues after the
    highest imported number.
  - Numbers come from the `code_counters` table, taken atomically inside the creating transaction, so concurrent
    creations never share a code.
  - Repeated submits of one form create one record (a per-page-view submission key), and a repeated handover click
    returns the existing RFQ or PO (unique source and type).

## D-019 Project pipeline model, master data and the sales-export import

- **Date:** 2026-10-17 · **Status:** Implemented
- **Decision:** A project carries commercial fields (stage, estimated value, probability, final value, won date, lost
  reason, competitor), general information (customer, principal, solution category, industry, location, stakeholders),
  technical fields (technical PIC, requirement, assessment, solution proposed, architecture, sizing, BOQ, quotation,
  proposal, POC, scope, challenge, blocker, notes) and progress notes (current and next action).
  - `Customer`, `Principal` (brand) and `SolutionCategory` are master tables keyed by a normalised name, so "HPE" and
    " hpe " are one record. Weighted value is computed (value times probability), never stored.
  - Stage and status are separate: stage is where the deal is, status says whether it is live, on hold, won, lost or completed.
  - `npm run db:import-projects` loads the sales-export CSV into the development or test database. It only adds, runs in one
    transaction, skips projects that already exist, never changes an existing user, and refuses other environments.
    The CSV holds real customer data and is git-ignored (`prisma/data/`).
  - The wording BOM became BOQ everywhere (stage "Sizing / BOQ", field "BOQ"); the import still accepts the old "BOM" headings.

## D-020 Project updates (current and next action) and technical fields

- **Date:** 2026-10-17 · **Status:** Implemented for SOA; Sales commercial editing not built yet
- **Decision (current and next action):** these are a **comment-like feed**, not an edited field (clarified by the user).
  - *Current action* is what has been done (this week); the page highlights the **last two**. *Next action* is what will be done
    after the current action; the page highlights the latest one.
  - The log is only **when** each entry was added and by whom: each post is one append-only row in `project_actions`
    (kind, text, author, time). Entries are never edited or deleted; a correction is a new entry. The project keeps the text of
    the latest entry of each kind (`current_action`, `next_action`), written in the same transaction as the entry and an audit event.
  - Permission `projects.post-update`: SOA, admin, superadmin. The export's existing actions became the first entries (no author).
- **Decision (technical fields):** SOA (and admins) may also change the technical fields (requirement, assessment, solution,
  architecture, sizing, BOQ, quotation, proposal, POC, scope, challenge, blocker, notes), permission `projects.edit.technical`,
  per the field-level rules of the spec (SOA edits technical specifications, BOQ details and technical notes). *This goes slightly
  beyond what was asked for Next action; remove the permission from SOA in `permissions.ts` to switch it off.*
  Commercial fields (value, probability, stage, status, owner) are read-only for them.
  - Enforced on the server: the service accepts only the listed field names and rejects any other key, re-reads the actor
    inside the transaction, and locks the project row.
  - Every changed technical field writes one row to the append-only `project_changes` log (who, field, from, to, when) plus an
    audit event, in the same transaction. A save that changes nothing writes nothing.

## D-021 Database backup to a host folder

- **Date:** 2026-10-17 · **Status:** Implemented (answer to OPEN_QUESTIONS T-11: host folder)
- **Decision:** Superadmin creates a custom-format `pg_dump` from the Backups page. The file goes to the folder mounted at
  `/backups` (host folder `BACKUP_HOST_DIR`, default `./backups`, git-ignored). It is written as `.partial`, verified with
  `pg_restore --list`, then renamed; existing files are never overwritten or deleted. Restore stays manual and approved
  (README, Backups). The image carries the PostgreSQL 18 client from the official PGDG repository (signing key fingerprint checked).
- **Not decided:** retention, encryption and off-machine copies; downloading a dump from the UI is not offered.

## D-022 Application shell, branding and responsive layout

- **Date:** 2026-10-17 · **Status:** Implemented
- **Decision:** The product is named **Halcom Dashboard** (tagline: Project Request & Fulfillment Tracker). The sidebar carries the
  Halcom logo and the modules grouped as Dashboards, Work and Administration, derived from the permission matrix. Below the
  `md` breakpoint it becomes a drawer (menu button, closes on navigation and Escape). Colours: primary blue `#1173BA`
  from the logo, white background, grey `#F3F4F6` surfaces, light blue `#E0F2FE` accents, amber `#F59E0B` only for attention states.
  Users can change their own password on the Account page; the Audit log page is open to admins.
