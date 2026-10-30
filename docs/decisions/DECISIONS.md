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
  - Requests: `BOQ-<prefix>-YY0001`, `RFQ-<prefix>-YY0001`, `PO-<prefix>-YY0001`, for example `RFQ-S-260001`.
    The sequence restarts per type, per prefix and per year (assumption, OPEN_QUESTIONS T-13). The two-digit year uses the Asia/Jakarta time zone.
    **The prefix rule was changed by D-035:** it is one letter, no longer the initials of the address parts (the old `ibnu.ardhian@x` gave `IA`, `sales@x` gave `SA`).
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

## D-023 Sales Pipeline, Progress and Status, one form, notifications, SOA phase, MailTo and export

- **Date:** 2026-10-18 · **Status:** Implemented
- **Progress and Status replace the old Stage and Status.** Sales' sheet drop-downs are the model: Progress (5% Qualify, 15% Understand,
  30% Propose, 60% Negotiate, 60% Negotiate (FU), 95% Agree, 100% Closed Won, 0% Closed Lost) and Status (On Track, On Hold, Done,
  Block). Choosing a Progress step sets its probability unless the probability is changed by hand in the same save. Existing
  projects were given a starting value from their stage and status (migration `20261018140000`; a guess, Sales correct it). Requests
  can be added only to a project that is **On Track**. *The old `projects.stage` and `projects.status` columns are no longer read or
  written; dropping them is a separate migration that needs the owner's approval, because it deletes the finer-grained old values.*
- **Sales Pipeline** is the one Sales dashboard (Table or Charts view, `?view=`). Request lists leave the Sales menu; a new project and its
  first BOQ, RFQ or PO are created in one form, in one transaction.
- **Commercial fields** (Progress, Status, estimated PO value, probability, target margin %, quote released, target closing) are edited
  by the Sales owner of the project (admins: any project), through a whitelist, with a change log and audit event.
  Estimated gross profit = value (final value once known) × target margin; empty until both are known.
- **Notifications** (`notifications` table, written in the transaction of the change): a new request reaches the team that owns its type;
  status changes and handovers reach the requester and Sales owner; project updates (commercial, technical, current/next action,
  SOA phase) reach the Sales owner, the technical PIC and the team with an open request on the project. The actor is never notified.
  Finance and Management receive none (they own no requests).
- **SOA phase:** a BOQ request is labelled Assessment, Sizing or POC by SOA (permission `requests.work.boq`); a database check keeps
  the label off RFQ and PO. RFQ and PO belong to Purchasing; SOA sees the email text only for BOQ and for what it handed over itself.
- **MailTo:** each request's email panel has a button that opens a draft in the person's mail program with To, Cc, subject and text.
  The application still sends nothing (D-017). A text that would make the link longer than 1900 characters is left out of the link.
- **Export:** the Overview offers a CSV export of the projects with the columns the person ticks (UTF-8 with BOM for Excel; text that
  starts with `= + - @` is neutralised). Each export is written to the audit log. An .xlsx export can follow if Excel formatting is needed.

## D-024 Navbar, collapsible sidebar, tracking view and export modal

- **Date:** 2026-10-18 · **Status:** Implemented (not yet committed)
- **Navbar:** a bar across the top at every width holds the sidebar button, the theme switcher (superadmin), notifications and a profile menu
  (name, role, Account, Sign out). The sidebar now holds only the logo and the modules. On a desktop the button hides and shows the sidebar
  (not remembered between visits); below `md` it opens the drawer as before.
- **Tracking** (Sales Pipeline, third view next to Table and Charts): every project Sales created with its requests, who has each request now
  ("Waiting for SOA to pick it up", "Dewi (Purchasing) is working on it", "Waiting for you"), when it last changed, a search and a filter
  (no request yet, open, waiting for me, all done). No timing rule is applied; SLA is still open (T-16).
- **Charts:** Pipeline by progress names the steps without their percentages; the percentage only feeds the weighted pipeline.
- **Export:** the column picker is a modal that opens from an Export data button on the Overview.

## D-025 PIC reassignment, margin amount, SLA range, email templates and the request flow

- **Date:** 2026-10-19 · **Status:** Implemented
- **Flow:** BOQ -> RFQ -> PO. The BOQ can be skipped (a project may start with an RFQ); **a PO needs a completed RFQ on the project**
  (confirmed by the product owner). A BOQ continues as an RFQ and an RFQ as a PO; the Sales owner of the project, an admin, or SOA (after
  a BOQ) decides. "Do not continue" is recorded with a note and can be undone. A new project cannot start with a PO.
- **Waiting for Sales:** the Sales owner answers (back to In progress, the answer is the reason) or cancels the request; nothing else.
- **SLA:** per receiving team (SOA for BOQ, Purchasing for RFQ and PO), written by the superadmin as one number or a range of days, `2-3`,
  `1-4`, at most 7 (default `2-3`). The first number is when an answer is expected, the last the deadline. **Days are working days**
  (Monday to Friday, Jakarta time, no holiday calendar; confirmed). The clock starts at creation, stands still while the request waits for
  Sales (the dates move by the waiting time) and stops at Completed. States: On track, Due now (from the expected date), Overdue, Paused, Met, Late.
- **Email templates:** per team, subject and text with `{{variables}}`; the subject must contain `{{request_id}}` so a reply carries it. The
  application still sends nothing (D-017). Subject format is now `[HITBOQ] Company - Project [Request ID]`.
- **Superadmin:** can move a project to other Sales, SOA and Purchasing PICs (details, requests and history untouched; the move is logged)
  and can delete a project. Deleting is a soft delete: history tables are append-only, so the project is hidden everywhere instead.
- **Commercial:** probability is no longer entered; it is the percentage of the Progress step. Target margin is an amount (default) or a
  percentage, never both. Money inputs group thousands with dots as they are typed.

## D-026 Persistent login and Switch Account, role modules and dashboards, project source Other

- **Date:** 2026-10-18 · **Status:** Implemented (from `FEATURE_SPEC_LOGIN_ROLE_DASHBOARDS_SOA_OTHER.md`)
- **Sessions:** the server-side session and the opaque HttpOnly cookie of D-012 stay; no new provider. A session lasts **12 hours idle**
  (`SESSION_TTL_HOURS`, 1 to 72) and is **renewed while the person works** (the page asks `POST /api/session/renew` every ten minutes while
  visible; a session in the last half of its lifetime gets a fresh 12 hours), but **never lives past 7 days** after sign-in
  (`SESSION_MAX_HOURS`). This replaces A-5 ("not extended by activity"). The cookie is a persistent cookie, so it survives a browser restart.
  `Secure` in production, `SameSite=Lax`. Nothing about the session is kept in web storage.
- **Switch Account:** ends (revokes) the current session, clears the cookie and shows the sign-in page with the accounts used on this
  browser. Choosing one only fills the email; **the password is always required**. The list (`recent_accounts` cookie: name, email, role;
  HttpOnly; at most five; 30 days) can be cleared per account or entirely. Sign out never signs anyone back in. Signing in revokes the
  browser's previous session. Sign-in, sign-out and switch are written to the audit log (`auth.login`, `auth.logout`, `auth.switch`;
  failed attempts are not logged, T-7). Login, logout and switch revalidate the whole app so no page of the previous user is cached, and every
  page is served `Cache-Control: no-store`.
- **Navigation per role:** Sales: Sales Pipeline, Projects, Sales Targets (`/targets`), Request Center (`/requests`). SOA: Technical
  Dashboard, Projects, New project, BOQ Tickets (list or board), New BOQ request, Purchasing Handoff (`/handoffs`), Technical Reports,
  Principal & Solution Master Data. Purchasing: Purchasing Dashboard, Projects (the shared view) and **RFQ Requests only**; PO requests are not in
  its menu but stay in the data, the lists and the notifications (interpretation of the spec, see OPEN_QUESTIONS T-17). Finance:
  Finance Dashboard, Projects, request lists (read) and Financial Crosscheck. Admin: Administration Dashboard, Users and Roles, Permissions,
  SLA Policies (read-only for admin, editable by superadmin), Master Data, Audit Logs. Backups and System stay superadmin-only.
- **Dashboard numbers** (`src/domain/requests/metrics.ts`, computed from requests and their status history, each linking to the filtered list):
  open (not Completed or Cancelled); backlog (Submitted); overdue (past the SLA deadline, requests waiting for Sales excluded); due now;
  waiting for Sales; past needed-by date; needed in the next 7 days; workload per assignee; bottlenecks (time in the current status);
  over the requests **completed in the last 90 days**: SLA compliance (met over met + late), queue time (created to first response), waiting
  time (in Waiting for Sales), processing time (turnaround minus queue minus waiting) and turnaround. Sales also see their requests by status
  and their target versus achievement. Time is calendar hours; the SLA clock is working days (D-025).
- **Finance crosscheck** (read-only, `src/domain/finance/crosscheck.ts`): value, RFQ and PO references, audit count, and four derived flags
  (Closed Won without final value, without PO, without RFQ; PO completed on a project not Closed Won). No verification or editing exists; it
  would need its own permission and audit trail. CSV export is audited.
- **Project source:** `source_type` (`INTERNAL_SALES`, `OTHER`) on the project, separate from status and request type. `OTHER` has no Sales PIC
  (`sales_owner_id` is now nullable) and needs the external company; contact, reference and notes are optional. A database CHECK and the
  service both enforce the combinations. Legacy rows become `INTERNAL_SALES` (each has a Sales owner; nothing is inferred). **SOA, admin and
  superadmin register `OTHER` projects; Sales register `INTERNAL_SALES`.** SOA may raise a BOQ on an `OTHER` project (not on a Sales
  project, not RFQ or PO) and continue it to Purchasing like any BOQ. SOA/admin edit the external details (change log + audit); an `OTHER`
  project can be handed to an internal Sales PIC, but an internal project cannot become `OTHER` (it would drop its Sales PIC and the targets
  that count it). Source is in the Projects list (column, filter, search), the project page and the exports.
- **Amended after the product owner's answers (T-17):** (1) **PO stays Purchasing's work**: PO requests are back in its menu. (2) **"Other" is
  the Sales side, not the project**: when creating a project, Sales choose themselves or Other and type a *sales name* as a marker; the project is
  otherwise normal, and charts count it under "Other". Sales (and SOA, admin) may register such projects, and **any salesperson may act on an
  Other project** (commercial details, answering Waiting for Sales, deciding the next step); an internal project still belongs to its owner only.
  Sales may also correct the sales name. (3) **Customers page** (`/customers`, Sales and admins): customers are never typed there; they are created from
  the end-user company when a project is created, one customer per name.
- **Tests:** the integration files now run one after another (`fileParallelism: false`) because the dashboard tests compare whole-table counts.

## D-027 One project view, Principal/Solution master data and a Purchasing view of RFQs only

- **Date:** 2026-10-18 · **Status:** Implemented (no migration: the Principal and Solution tables already existed)
- **One view:** the BOQ, RFQ and PO of a project are panels inside the project page; `/request/CODE` stays and shows the same panel. A
  request handed over starts In progress. The email text opens in a modal and the status history is collapsed. Technical fields are
  optional and added on demand; SOA see only BOQ requests in the menu.
- **Master data:** Principal and Solution are separate searchable lists with stable ids. A new name is created only by the explicit
  Create button (SOA, admin, superadmin: `masterdata.manage`); a name that exists, ignoring case and spacing, is selected instead and the
  server refuses a duplicate (unique name key, also under concurrency). Rename keeps the id and so every project; delete is refused while a
  project uses the record. Changes go to the audit log, and a project's classification to its change log.
- **Technical sections:** one that was never saved is dropped at once; a saved one is cleared only after confirmation. Only that field
  changes; the change log keeps what it said (so history is not lost, and no row is deleted).
- **Purchasing:** the menu offers only the Purchasing Dashboard and RFQ requests. All other pages and the PO list are not offered but still
  work by address (nothing was deleted). The dashboard queue is RFQ only. The request lists have search (request, project, End User,
  requester, PIC, Principal, Solution, item details), status filter, sorting (SLA is computed, over the newest 1000) and pages of 20, all in the URL.
- **Not built:** attachments on requests do not exist yet, so the RFQ list has no attachments column. Purchasing no longer sees PO requests in
  its menu or queue; if Purchasing must still work POs, that needs a decision. **Answered 2026-10-18 (T-17): PO is Purchasing's work, so its menu
  now has Purchasing Dashboard, RFQ Requests and PO requests.**

## D-028 Status changes on the board only, Waiting for Sales retired, Revision for a completed BOQ

- **Date:** 2026-10-18 · **Status:** Implemented
- **Board:** SOA (BOQ) and Purchasing (RFQ, PO), and admins, change a status only by dragging the card to another column of the board
  (`/requests/<type>?view=board`, the default view of the team that works on that type; the list is one click away). The status form on the
  request page is gone. Only moves the flow allows are drop targets. A cancellation, or reopening a completed RFQ or PO, asks for a reason.
  The keyboard does the same with Shift + Arrow keys on a focused card. The server checks every move again (`changeRequestStatus`).
  Sales and Finance see the board but cannot move cards; Sales no longer change a status.
- **Waiting for Sales is retired:** it is no longer offered and nobody can move a request into it; questions to Sales are asked and answered by
  email, which keeps the history. The value stays in the database (older requests and their append-only status history use it; PostgreSQL
  cannot drop an enum value without rewriting rows). An older request that still has it is shown in the In progress column and can be moved on.
- **Revision:** a BOQ that is Completed can be dragged to Revision (no reason: the details go by email), and from there back to Completed or to
  Cancelled. An RFQ or PO has no Revision (a completed one is reopened with a reason). A BOQ in Revision is open work, keeps its first
  completion time (the SLA is not re-measured) and cannot be continued to an RFQ until it is completed again.
- **Migrations (additive):** `20261022100000_request_revision` (enum value) and `20261022100100_request_revision_completion` (the completed_at
  check now also allows Revision; it only gets looser, no row is touched).

## D-029 Remembered accounts, one New project form for SOA, Sales ownership, clearable dates, Propose means Submit Quotation

- **Date:** 2026-10-18 · **Status:** Implemented
- **Remembered accounts (Switch Account):** every sign-in of a role other than ADMIN and SUPERADMIN remembers the account on that browser, so
  Switch Account continues as it without the password (`device_credentials`, migration `20261022120000_device_credentials`, additive). The
  cookie `device_accounts` (HttpOnly) holds only `{ id, token }`; no name, email or role. The database stores a salted SHA-256 of the token.
  Each use replaces the token (a copied cookie works once). Every use re-reads the stored user: deactivated, expired, or a role that became
  ADMIN or SUPERADMIN means refusal and the credential is deleted. A password change, an admin reset and deactivation delete all of a user's
  credentials. ADMIN and SUPERADMIN always type the password. Valid for 30 days from sign-in; at most five per browser; "Forget" removes one.
- **SOA:** the menu no longer has New project or New BOQ request. A project and its BOQ are created with one form (the New project button on
  Projects and on BOQ Tickets, BOQ preselected); `/requests/new` without a project leads there. Adding another request to an existing
  project is still done from the project page.
- **Sales ownership:** a Sales project is always Internal Sales with the signed-in salesperson as Sales PIC (any owner sent with the form is
  ignored). Sales no longer hold `projects.create.external` or `projects.edit.source`; only SOA (and administrators, for oversight) classify
  a project as Other or change that classification. Existing Other projects keep working: any salesperson still enters their commercial details.
- **Dates:** every date field has a Clear button shown only while it has a value; an empty date is stored as no date (logged for the
  commercial fields).
- **Progress 30%:** Propose means the quotation was submitted (label "30% - Propose (Submit Quotation)"). Moving to Propose, or creating a
  project at Propose, fills Quote released with today (Jakarta) when it is empty. The date stays editable and clearable at any time.

## D-030 SOA register a project for a registered salesperson, or as Other

- **Date:** 2026-10-18 · **Status:** Implemented (no migration)
- The New project form for SOA has two sources: **Internal Sales** (the Sales PIC is a registered, active salesperson picked from a searchable
  drop-down, required) and **Other** (the external sales name). New permission `projects.assign-sales` (SOA, superadmin). The server
  validates that the chosen account exists, is active and is a Sales account; the salesperson is told (`project.assigned` notification);
  the audit event records who registered it and for whom. SOA may raise the project's BOQ in the same step (not an RFQ or PO, and not a BOQ on
  an existing internal project). Sales still own their own projects and cannot name another owner (any owner sent is ignored).

## D-031 Owner migration, PICs, several principals, Excel import, chart drill-down, Sales dashboard

- **Date:** 2026-10-18 · **Status:** Implemented (migrations `20261023100000_project_principals`, `20261023110000_operational_pics`, both additive)
- **Account and ownership migration** (`npm run db:remap-owners`, dry run by default; `--apply` runs one transaction, development and test only,
  superadmin recorded as the actor). In order: `mas.dzaki@` is renamed to `dzaki@` (name Dzaki; same account id, so every reference follows);
  projects of `soraya@` move to `dzaki@`; projects of `gusti@` move to `satrio@`; every other internal project becomes source **Other**, with
  the earlier owner kept as the external sales name and a note ("Previously owned by ..."). Nothing is deleted. The plan refuses to apply when
  both addresses of the rename exist, a target is missing, inactive or not Sales; an owner who is not a Sales account (the SOA account
  `adityo@`) is reported as a warning, not guessed. Each change is in the project change log and the audit log; the counts are verified
  inside the transaction and a difference rolls everything back. Applied to the development database on 2026-10-18 after a `pg_dump`:
  38 projects: 15 Dzaki, 18 Satrio, 5 Other. Recovery is the dump; there is no automatic revert.
- **PICs** (`pics`, `request_pic_assignments`, `requests.pic_id`): a PIC is an operational assignee of SOA or Purchasing, not a login account.
  Each team keeps one shared login. An administrator creates, renames, deactivates and reactivates PICs (`pics.manage`, `/admin/pics`); a PIC
  is never deleted. SOA or Purchasing hands a request to a PIC of their own team from the request page; every change is an append-only row
  (from, to, by, when) and an audit event. Workload by assignee counts per PIC; starting work no longer makes the login the assignee
  (`requests.assignee_id` stays, deprecated). The migration made a PIC of every SOA or Purchasing account a request had been assigned to
  (Adityo, and the two shared logins by name; the shared ones should be handed on and deactivated). The project-level Technical PIC and
  Purchasing PIC (`projects.technical_pic_id`, `purchasing_pic_id`) still point at accounts: they route notifications, so moving them to PICs is a separate decision.
- **Several principals per project** (`project_principals`, unique per project and principal): SOA picks any number from a searchable list
  and may create a new one (`masterdata.manage`); a name that exists is matched, never duplicated. `projects.principal_id` keeps the first so
  lists, filters and exports keep working. Charts count a project under each of its principals; the folded "Other (n)" slice counts it once.
- **Excel import** (`projects.import`: SOA, Admin, Superadmin; `/projects/import`): upload `.xlsx`, match columns (suggested from the headers),
  check every row, then import. The file is posted again with each step and checked again on the server (5 MB, 5,000 rows, 60 columns; no
  formulas run). Duplicates (same Project ID, or same end user and project name, in the data or earlier in the file) are skipped, never
  updated. All or nothing (default) or valid rows only; the import is one transaction, so any failure leaves no project, principal, code
  number or audit row behind. Explicit Project IDs move the counter past them. Sales do not import: owners are named in the sheet.
- **Overview charts** link to the Projects list filtered to exactly what they count (progress, status, funnel step "reached", principal,
  solution, industry, Sales PIC; the folded "Other" slice carries all of its values; "Not set" is `none`).
- **Projects table** pages of 25, 50, 100 or All (`per`, `page`); All is every match, not capped.
- **Sales Pipeline dashboard**: every number is the signed-in salesperson's own (the request counts were global before); sales performance
  (open pipeline, weighted, margin, won) comes before the BOQ/RFQ/PO numbers; the targets block and its tab are gone (Sales Targets has its own page).

## D-032 Permission editor, one Admin Dashboard, development data cleanup and repeatable seeds

- **Date:** 2026-10-18 · **Status:** Implemented (migration `20261024100000_role_permission_overrides`, additive)
- **Why a superadmin could not manage role permissions.** Permissions were only defined in code (D-013), the Permissions page was a read-only
  matrix, and there was no write path at all (no table, no action, no `permissions.manage`). Nothing was misconfigured; the feature did not exist.
- **Permission editor** (`/admin/permissions`). Permissions stay defined in code. The database stores only **deviations** from the built-in
  defaults (`role_permission_overrides`: role, permission, granted); a permission set back to its default removes its row, and a permission
  added to the code later reaches every role as written there. The effective rules are loaded from the database at the start of every
  signed-in request and held on `globalThis` (Next.js bundles pages, actions and route handlers separately, so a module-level copy would
  diverge), so `can()` stays synchronous and every one of its ~120 call sites follows the stored rules. If that read fails the request fails;
  falling back to the defaults could give back a permission that was taken away.
- **`permissions.manage`** (new): held by Superadmin only. Admin keeps `permissions.view`. Both the page and the action call
  `requirePermission("permissions.manage")`, and `savePermissionChanges` re-reads the stored actor and the stored rules inside a transaction
  (`LOCK TABLE ... SHARE ROW EXCLUSIVE`, so one editor at a time), so a forged form or a session that claims another role changes nothing.
  Changes are all-or-nothing and write one `permissions.updated` audit event per role with the before and after.
- **Guards** (`PERMISSION_GUARDS`, enforced when saving and again when the rules are computed, so even a bad row cannot lock anyone out):
  Superadmin always keeps `permissions.view`, `permissions.manage`, `users.view`, `users.manage`, `users.manage-privileged` and
  `dashboard.superadmin.view`; `permissions.manage` and `users.manage-privileged` can never be granted to another role. Ordinary Admin users
  therefore cannot be given permission management by this screen.
- **Categories.** Every permission is classified exactly once into ten collapsible categories with a readable label and description
  ([permission-catalog.ts](../../src/domain/access/permission-catalog.ts)); identifiers are unchanged. The compiler (`Record<Permission, ...>`)
  and a unit test refuse a permission that is missing or listed twice. Each dashboard permission is its own checkbox.
  Actual behaviour was checked per permission (page, action and service call sites); descriptions say what is enforced, for example
  `requests.handover` decides the step after a completed BOQ or RFQ on any project, while assigning a PIC follows `requests.work.*`;
  `theme.switch` only decides who sees the theme control.
- **One Admin Dashboard.** `/dashboard/admin` and `/dashboard/superadmin` rendered the same widgets and the same data (only the title differed),
  so they now share one page titled **Admin Dashboard**. Both addresses and both permissions (`dashboard.admin.view`, `dashboard.superadmin.view`)
  stay, so existing assignments and links keep working and each can still be granted on its own. A role that holds both is offered one menu entry.
  What only a superadmin can do is unchanged and enforced where it always was (System, Backups, SLA policy edits, admin accounts); the dashboard
  shows those shortcuts only to a viewer who holds the permission. Sales, SOA, Purchasing, Finance and Management dashboards are untouched.
- **Development data cleanup** (`npm run db:cleanup-dev`, dry run by default, `--apply` in one transaction, development and test only). Applied
  to the development database on 2026-10-18 after a `pg_dump` (`backups/pre-dev-cleanup-2026-10-18.dump`):
  - *Test projects of 2026-10-17* (the day read in the application's time zone, UTC; the database computes the half-open day): a project is
    test data only if it was created that day through the project form (has a submission key), was not imported from the sales export and its
    company is a placeholder (`PT` and four capital letters). PRJ-035 "PT ABCD" and PRJ-036 "PT EFGH" with BOQ-MD-260001, RFQ-SO-260001 and
    RFQ-SA-260001 matched. The 34 projects of the sales export (PRJ-001..034) were looked at and left. PRJ-037 and PRJ-038 look like test data but
    were created on 2026-10-18, so they are only reported. A project is removed the way the application removes one (marked deleted, hidden from
    lists, charts and exports); its requests, status history, change log and audit events stay, because those tables are append-only and
    foreign keys restrict a hard delete. Notifications that only led to the hidden pages were deleted (18). The customers PT ABCD and PT EFGH
    stay as master data.
  - *Obsolete accounts* (the registry in `prisma/seed-users.ts`, synthetic `@example.invalid` accounts only, never an administrator, never one with a
    live session): found by scanning every foreign key to `users` in the catalog. No reference at all: deleted (`soraya`, `hendi.batam`,
    `jihan.batam`, `mira.batam`, `tim.batam`). Referenced by history: **deactivated and signed out, not deleted** (`gusti`: 2 audit events;
    `adityo`: 32 projects as Technical PIC, a request, its status history, an audit event), because deleting would break the audit trail and
    pointing 32 projects at another person would be a guess. Each action is an audit event.
  - The apply step recomputes the plan inside the transaction and stops if it differs from the reviewed one; a failing step rolls everything back.
- **Seeds.** `npm run db:seed` creates the role accounts, the Dzaki and Satrio Sales accounts, principals, solutions and PICs (through the
  application's services). `npm run db:seed:sample` adds five sample projects with BOQ, RFQ and PO requests at different stages and one project
  from an outside source. Every record has a fixed name or an idempotency key (`seed-dev-v1:...`), so repeating either command adds nothing and
  never overwrites a change made in the application. Routine seeding never deletes, resets or truncates. Migrations stay separate
  (`db:migrate:deploy`). The sales export is not part of the seed: it is real data and stays git-ignored.

## D-033 User Guide: interactive workflow chart and role-by-role steps

- **One page, every role.** `/guide` (header link "User Guide") needs only a signed-in session, no permission. Nothing on it is data: it describes the workflow,
  and what it highlights and links to follows the viewer's permissions.
- **One definition.** `src/domain/guide/workflow.ts` holds every step once (role, kind, action, input, output, recipient, grid position, step-by-step
  instructions, page links) and the arrows between them. The flowchart, its popovers, the list for small screens and the role tabs are all drawn from it.
  `role-guides.ts` keeps "Can read", "Can edit" and "Cannot" apart for each role (everyone reads, only the owner edits).
- **Highlighting from permissions.** A role's lane is highlighted when the account's own role is that role, or when the account holds every permission in
  `GUIDE_ROLE_CAPABILITY` for it (an Admin therefore lights Sales, SOA, Purchasing, Finance, Management and Admin, not Superadmin). The function takes a
  list of roles, so an account with several roles is highlighted for all of them. Colour has one meaning on the chart, the viewer's roles; a step's role,
  kind and next recipient are text and icons, and arrows differ by line style (handoff thick, within a role thin, information or setup dashed).
- **Interaction.** Hover, focus, click, tap or Enter open a step's details; Escape, the close button, a click on empty chart or a second click closes them.
  The popover is fixed to the screen (never clipped by the chart's scrolling). The chart scrolls, drags and zooms (50% to 150%, fit to width); below `md` a
  list of the same steps replaces it.
- **Restricted detail.** The step-by-step instructions of Admin and Superadmin are not sent to the browser of anyone who does not hold those roles; links
  appear only for pages the viewer may open (each link lists the permission its page requires; a unit test compares it with the page's `requirePermission`).
- **Checked.** `tests/unit/guide.test.ts` pins each stated rule to the code that enforces it (flow order, who decides after a BOQ or RFQ, who works which
  request, read-only roles, reasons for cancelling and reopening) and checks the chart geometry (no overlapping steps, no arrow through a third step).
  `tests/e2e/guide.spec.ts` covers highlighting for all seven roles, hover, click, keyboard, zoom, tabs, role-specific links and the small-screen list.
- **Not covered.** The guide describes what exists today. Request attachments are not built, so the guide does not mention them. The BOQ,
  quotation and PO documents themselves are prepared outside the application; the guide says so.

## D-034 Gross-profit-only targets, customer industry, Sales revision requests

- **Sales Targets take gross profit only.** The target form has no revenue box. Revenue stays on the Sales Targets scorecard as **won (after the PO)** and
  **weighted forecast**, with no target and no "reached" column. `sales_targets.revenue_target` is kept (no data is dropped): a value saved by an
  earlier version is never shown, changed or lost, and clearing the gross profit target keeps a row that still holds one. A save is an update or a create,
  not an upsert: an upsert proposes an insert first, and a row with no target at all breaks the table's check.
- **Customer industry.** `customers.industry` (nullable text, migration `20261025100000_customer_industry`) is filled in on the Customers page: the customer's
  name opens a window with an Industry box that suggests the industries already in use. New permission `customers.edit` (Sales, Admin, Superadmin: the roles
  that open the page). Charts, filters, the project page and exports use the customer's industry first and fall back to the free text a project carried from
  the sales export (`effectiveIndustry`). Any role with `customers.edit` may edit any customer's industry (a customer is shared master data, not one salesperson's).
- **Sales revision requests.** New permission `requests.revise` (Sales, Admin, Superadmin). On a **Completed BOQ** the request page shows "Request a revision"
  with a required reason (up to 500 characters). The BOQ moves straight to Revision (the first completion date is kept, so the SLA does not run late), the reason
  is in the status history and the audit log, and SOA (the team and the project's technical PIC) is notified. A salesperson may do it only on a project they act on
  (their own, or one from another source). RFQ and PO have no Revision status: Purchasing reopens them. Revision notifications (this one, and SOA moving a BOQ to
  Revision on the board) are red in the list with the word Revision, and the bell badge turns red while one is unread; a banner on the request page keeps
  "In revision" and the reason in view.

## D-035 One-letter code prefix, RFQ tracker import, SQL for a new database, indexes

> Amended by D-036: the mail-id columns and `responded_at` described below were dropped a day later, and the SOA senders are PICs, not accounts.

- **Date:** 2026-10-20 · **Status:** Implemented (migrations `20261026100000_code_prefix_and_request_email`, `20261026110000_code_prefix_max_length`, additive)
- **Request code prefix** (`users.code_prefix`, unique). The prefix is the **first letter of the person's e-mail address** (`satrio.akbar@` gives `S`, `adityo.prabowo@` gives `A`, as in the
  tracker's own `RFQ-A-260002`). If another person already holds that letter, the next person takes the **first two letters** (`soraya@` gives `SO`), then three; a code has room for three
  characters only (`requests_code_format_chk`), so after that comes two letters and a digit. It is chosen the first time the person raises a request, under an advisory lock, and kept, so a code never
  changes. Requests that already exist keep their codes (`BOQ-SA-...`); a person's numbering for the new prefix starts at 1.
- **RFQ tracker import** (`npm run db:import-rfq`, dry run with `--dry-run`; development and test only; one transaction; only adds; safe to repeat). The sheet's 27 tickets became 27 RFQ
  requests with their status history, PIC assignment and projects. Rules, all in `src/server/import/rfq-tickets.ts`:
  - Status: Done is Completed, Failed is Cancelled (the note is the reason), On Going is In progress, Baru is Submitted. Dates in the sheet carry no time: a ticket came in at 09:00, was answered
    at 15:00 and an undated outcome is set at 17:00 (Asia/Jakarta); these times are assumptions. `Tanggal Response` is stored as `requests.responded_at` (new), set by the application the first time a
    request is taken up or completed. `LinkEmail`, `MessageID` and the conversation id are stored on the request (`email_link`, `email_message_id`, `email_conversation_id`).
  - Every RFQ belongs to a project, so each ticket made one (one per customer and project name). A sender who is a Sales account owns it; Gusti's go to Satrio (D-031); an SOA or admin sender (Adityo,
    Ibnu) has no Sales PIC, so the project is source Other with their name. A sender with no account is created **inactive, with a password nobody knows**, only so history can name them.
  - "Gita & Soraya" is two people but a request has one PIC: the first is assigned and the whole text is kept in the description. Tickets that already have an id keep it.
  - Applied to the development database on 2026-10-20 after a `pg_dump` (`backups/pre-rfq-import-2026-10-20.dump`): 27 requests, 27 projects (3 source Other), 5 code prefixes.
- **SQL for a new database** (`npm run db:rfq-sql`, writes `prisma/data/hit_rfq_tickets_import.sql`, touches no database). It is generated from the same plan, so it cannot disagree with the importer:
  loaded into an empty database (migrations, `db:seed`, then the file) it produced rows identical to the importer's on every compared column. One transaction, only adds, repeatable.
  It holds customer names and e-mail addresses, so it stays in the git-ignored `prisma/data/`.
- **Database review and optimisation.** The tables already follow the business flow (project, then BOQ, RFQ, PO with their history), so the schema was not rebuilt: a rebuild would mean dropping
  tables that hold history, which the safety rules forbid, and nothing in the flow required it. What was added: the e-mail and response columns above and three indexes on foreign keys that had none
  (`requests.requester_id`, `projects.solution_category_id`, `audit_events.actor_id`). Measured on 80,000 requests and 120,000 audit events (rolled back afterwards): the requests of one person
  6.4 ms to 0.3 ms, the audit events of one actor 6.2 ms to 0.4 ms. Left alone on purpose, as candidates for a later reviewed migration: the deprecated columns `projects.stage`, `projects.status`,
  `requests.assignee_id` and their indexes.

## D-036 SOA PICs raise tickets, response date as a status step, columns taken out

- **Date:** 2026-10-20 · **Status:** Implemented (migrations `20261027100000_request_trim_and_raiser`, `20261027110000_drop_deprecated_columns`). The product owner asked for the column removals; both migrations drop data, so a `pg_dump` was taken first (`backups/pre-column-cleanup-2026-10-20.dump`, `backups/pre-rfq-rebuild-2026-10-20.dump`).
- **Dropped from `requests`:** `email_link`, `email_message_id`, `email_conversation_id` (the mail ids are not kept) and `responded_at`. The sheet's `Tanggal Response` is now what it means: the request moved to **In progress** on that date, a row of the status history (Submitted to In progress at 15:00 Jakarta time, then the outcome at 17:00 the same day; both times are assumptions, the sheet has dates only). The note is the reason of the last move. A Failed ticket without a response date goes straight from Submitted to Cancelled.
- **Dropped as deprecated:** `projects.stage` and `projects.status` (replaced by `progress` and `track_status`; the export's values had been mapped into those at import, 65 projects held stage and status values that are now gone), `requests.assignee_id` (replaced by `pic_id`; 3 requests still held a value), their indexes and foreign key, and the enum types `ProjectStage` and `ProjectStatus`. The CSV reader still understands the export's Stage and Status columns (`src/domain/projects`), because the sales-export import maps them into progress and track status.
- **SOA people are PICs, not accounts.** Adityo and Ibnu are SOA PICs. A ticket they send is raised through the shared SOA login (`soa@`) and names the person in the new `requests.raised_by_pic_id` (a PIC of team SOA; shown as "Requested by Adityo (SOA PIC, through the shared SOA login)"). Their projects have source Other, no Sales PIC and no Sales name: the person is the project's **Technical PIC (SOA)** (`projects.technical_pic_id`; Adityo's account exists, Ibnu got an inactive SOA account with a password nobody knows, only so the column can name him). The database wants a name for source Other, so it reads `Internal SOA request`. `adityo@` stays inactive because 32 projects name it as Technical PIC. There is no form field for the SOA PIC yet, and SOA still may not raise an RFQ in the application (`requests.create.rfq` belongs to Purchasing and Admin; Sales raise any request with `requests.create`): the data allows it, the permission is a separate decision.
- **Code prefix for a SOA ticket.** The shared login has one prefix like any account (`SO`, because `S` is Satrio's), so a SOA ticket without a code in the sheet is `RFQ-SO-...`. A code the sheet already has (`RFQ-A-260002`) is kept and its number is counted, but the login does not take the letter `A`. Prefix per PIC instead of per login is possible but would need a prefix on the PIC; not done.
- **Rebuilding tickets that were loaded before.** The status history is append-only, so tickets of the first load could not simply be corrected. `npm run db:import-rfq -- --rebuild` (dry run first) replaces the history and PIC assignments of the requests this import made, and only those, inside one transaction in which the two append-only triggers are switched off and on again; it refuses a request that anything other than the import touched, keeps the codes the tickets already have while they fit their prefix, and writes an `import.rfq_tickets_rebuilt` audit event. Applied to the development database: 52 history rows replaced, 1 ticket recoded (`RFQ-I-260001` became `RFQ-SO-260002`), the prefixes `A` and `I` released.
- **Projects for tickets without one.** Confirmed by the product owner: a ticket whose project does not exist gets a new project (one per customer and project name), as the importer already did.
- The SQL file for a new database follows the same rules and was loaded into an empty database and compared with the development database: identical except the number `RFQ-SO-260002`, which is 260001 in an empty database.

- **Purchasing and SOA dashboards (D-036).** Both teams show the same summary above their SLA numbers: Total, Done, Completion rate (done over total; cancelled requests count in the total), On going (In progress), a donut of requests by status and a bar chart of requests per PIC. Every active PIC of the team has a row, with 0 if none (Purchasing's Gita and Soraya), and unassigned requests are a last row. The difference is what each counts: SOA its BOQ requests, **Purchasing its RFQ and PO requests together** (before, Purchasing counted RFQ only and mentioned the open POs in a sentence). The request list takes `?types=RFQ,PO`, so every Purchasing number links to the list behind it.

## D-037: Seed, importer and tests use the Neon accounts (2026-10-23)

The Neon and local databases had been edited by hand to company accounts. The product owner asked that the seed that still created `@example.invalid` accounts be updated to `@halcominovasi.co.id`.

- **Accounts (`src/domain/devdata/accounts.ts`).** `DEV_EMAIL_DOMAIN = "halcominovasi.co.id"`. One account per role named by its label (Superadmin, Admin, SOA, Purchasing, Finance, Management); SOA signs in as `support@`; Sales are Dzaki and Satrio, and there is no generic `sales@`: the Sales role of the tests is Satrio. The seed never runs against Neon (it refuses outside development or test).
- **PICs.** The seed creates Adityo and Ibnu (SOA) and Gita and Soraya (Purchasing), the PICs Neon has; "SOA PIC 1/2" and "Purchasing PIC 1" are gone.
- **RFQ import.** Gusti, Adityo and Ibnu have no account any more: a Gusti ticket is Satrio's (requester and owner); a SOA person's ticket is raised through `support@` with the person as SOA PIC, and the Technical PIC (SOA) column holds `support@` (it takes an account). The shared SOA login keeps the request letters `SO` (it takes them from "soa", because `S` is Satrio's). Nobody is created only for history now; the support for it stays in the importer.
- **Not changed.** The development clean-up (`db:cleanup-dev`) still recognises synthetic `@example.invalid` accounts, so it can never delete a company account. Test fixtures that only need an address keep `@example.invalid`; the fake distribution lists in `compose.yaml` too.
- **Password.** The minimum length is 8 (it was 12), so the 9-character password set directly in the databases is valid.
- **Sign-in sheet.** `DEV_ACCOUNTS.md` is generated from the database; the Sales role account is listed with the Sales people, and the "obsolete accounts" registry is empty.

## D-038: Sales Pipeline analytics: Pipeline Conversion and Pipeline Growth (2026-10-23)

**Audit result.** Before this, the application stored no history of a project's stage. `projects.progress` is overwritten in place; `project_changes` logs only some edits (one `progress` row in the development database) and `audit_events` has no stage events for most paths. Imported projects have none at all. So a chart of past stage distributions could not be made truthfully, and none is made up.

- **KPI cards.** Open projects, Open pipeline, **Pipeline conversion**, Estimated gross profit, Won. The Weighted pipeline tile is gone (the weighted numbers are still in the exports and the "Weighted value by salesperson" chart, and `?show=weighted` still works for old links).
- **Pipeline Conversion = open projects at Propose or beyond / open projects x 100.** Open is the dashboard's definition: not Closed Won, not Closed Lost, Status not Done. Propose or beyond = Propose, Negotiate, Negotiate (FU), Agree. Closed Won and Closed Lost leave both sides (Won has its own tile). A zero denominator shows N/A. It is the share of *today's* open pipeline that has reached the quotation step. It is **not** a historical conversion rate: that needs stage history and a cohort definition, which the data cannot give yet. The tile opens `/projects?show=quoted`.
- **Stage history (migration `20261028100000_project_progress_history`).** Append-only table `project_progress_history` (project, from, to, time, person if known, source). A **trigger on `projects`** writes a row when a project is created and whenever `progress` changes, in the same transaction, so every path is covered (forms, imports, the SQL load files) and none can forget. The time is the database clock at the moment of the change, never a backdated value. The person comes from the transaction setting `app.actor_id` (`setActor`), set when Sales or SOA edit a project and when a project is created; elsewhere it stays empty. The migration also wrote one **baseline** row per existing project (its stage at that moment). The history therefore starts at the migration: **the earliest reliable date is the migration time of each database**, shown in the chart as "stage history starts on ...". Periods that ended before it have no point and the line breaks there.
- **Pipeline Growth.** Three exclusive groups: Opportunity (Qualify, Understand), Quoted (Propose, Negotiate, Negotiate (FU), Agree), Closed Won; Closed Lost is in none and a stage the code does not know is not guessed into a group. Each point is the number of projects in each group at the **end of the period** (the running period: now). Eligible total = Opportunity + Quoted + Closed Won at that moment; percentage = count / eligible total, 0 for an empty total. Weekly (ISO weeks, Monday first, 12), Monthly (calendar months, 12), Quarterly (calendar quarters, 8). Boundaries are midnight **Asia/Jakarta** (UTC+7, no daylight saving). The three cards under the chart are the last period against the one before it, made from the same points as the chart ("N/A" without earlier data, "New" from zero; a fall is not called bad).
- **Query.** One parameterised statement (`src/server/projects/growth.ts`): per period moment, `DISTINCT ON (project_id)` the latest history row at or before it (ties broken by the row id, which is time-ordered), keeping projects not deleted at that moment, counted in the database. No join to a table with several rows per project, so nothing is counted twice. The only index is the one the lookup needs on the new table (`project_id, changed_at DESC`). A salesperson's scope is the project's owner today (a later owner change is not replayed).
- **Endpoint.** `GET /api/pipeline-growth?granularity=weekly|monthly|quarterly` (no-store, 401 without a session, 400 for another value). A salesperson gets only their own projects; the server decides the scope. The chart is a client component that fetches on a change of period without reloading the page, aborts the earlier request and ignores a late answer to an older choice, and shows loading, empty and error states and a table of the same numbers.
- **Kept.** The value-by-progress column chart ("Pipeline by progress") and the funnel stay: they show money per step, which this chart does not.
- **Limits.** Until history has built up, the chart is mostly the present distribution plus whatever has changed since the migration; it must not be read as a trend before that. A project hard-deleted in the future would fail the foreign key (projects are soft-deleted).

## D-039: The three production blockers, and a deployment to Vercel (2026-10-24)

T-7, T-8 and T-9 were the reasons this application could not be put in front of real users. All three are built, and the deployment they were blocking is prepared for Vercel with the database on Neon.

- **T-7, slowing down guessing.** A new table `login_attempts` counts failed sign-ins twice: against the e-mail that was typed and against a SHA-256 of the client address. Five failures on one e-mail, or twenty-five from one address, inside a fifteen-minute window lock it; the lock starts at fifteen minutes and doubles for every further block of failures, up to an hour, and never longer. A permanent lockout was rejected on purpose: it would let anyone keep a colleague out by typing a wrong password often enough. The count is kept for addresses that belong to nobody as well, so being locked out never tells an outsider which addresses are real, and the rules are pure functions in `src/domain/access/login-throttle.ts` with the state in the database, not in memory, because the application runs as several instances (on Vercel, as short-lived functions).
- **T-8, the first superadmin.** `npm run db:bootstrap-superadmin` (`src/server/auth/bootstrap.ts`) creates exactly one account, and only while the database has no superadmin at all; a second run reports who already has the role and writes nothing. The password is read from the environment, never from the command line, the account is created under an advisory lock so two runs cannot both succeed, and the creation is audited as `user.bootstrapped`.
- **T-9, a password somebody else chose.** `users.must_change_password` is set when an administrator creates an account, when an administrator resets a password, and by the bootstrap. While it is set, `requireUser` sends every page and every server action to `/password-change`, a page outside the application shell, so the flag cannot be walked around by calling an action directly; choosing a password clears it. Every refused sign-in is now audited (`auth.login_failed`, `auth.login_locked`), which was the second half of the question.
- **Deployment.** [deployment/VERCEL.md](../../deployment/VERCEL.md) is the runbook: environment variables, migrations run from a machine (never from the build, so a failed build cannot half-apply a schema), the bootstrap, the project settings, a first-deployment checklist, and what to do when the schema changes. `vercel.json` fixes the framework and the Singapore region; `prisma generate` runs both in `postinstall` and in `build`, because Vercel's dependency cache would otherwise reuse a client generated against an older schema.
- **Backups do not work there.** The Backups page shells out to `pg_dump` and writes to a host folder, which a serverless function has neither of. The page now says so and the action refuses, rather than offering a button that fails; Neon's point-in-time restore takes its place. Retention (T-11) is still undecided.
- **Plan (decided 2026-10-25).** Hobby, with the owner's eyes open: Vercel's plan terms say Hobby is non-commercial and personal, and an internal company tool is a grey area Vercel has not settled publicly. The cost of being wrong is a suspension, not a bill, and the way out is an upgrade to Pro; nothing in the code is Vercel-specific beyond `vercel.json` and the Backups notice. Hobby also keeps Deployment Protection to preview deployments only, so previews of `development` are put behind Vercel Authentication and the production domain stays public, which is harmless because the application shows nothing without a sign-in.
- **Throttle numbers (confirmed 2026-10-25).** Five failures per e-mail, twenty-five per client address, a fifteen-minute window and a lock of fifteen to sixty minutes, as proposed. They are five constants in `src/domain/access/login-throttle.ts`.
- **Branches.** `main` is what Vercel deploys to production; `development` replaced `wip/single-view-master-data` and gives a preview deployment with its own URL and its own environment variables.

## D-040: Dates by day, stage dates tied to Progress, whole-list sorting, Indonesian guidance (2026-10-25)

Four changes the product owner asked for after the Vercel deployment.

- **Dates are shown as a day.** `formatDay` (`src/features/dashboards/format.ts`) shows `17-10-2026`, the calendar day in Asia/Jakarta, instead of `2026-10-17 04:03 UTC`. Only the display changed: stored timestamps, columns, APIs and exports are untouched.
- **Three stage dates, one meaning each.** Opportunity date is `projects.created_at` (Sales correct it on their own projects, never empty, never in the future); Quoted is the quote released date (reaching 30% - Propose); Closed Won is the won date (100%). They follow Progress in both directions: moving Progress fills today's date as before, and entering a Quoted or Won date by hand moves Progress forward (Opportunity to Propose, anything to Closed Won). A date never moves Progress back. Every change is in the change log.
- **Pipeline Growth counts from the creation date**, so every period has numbers. A project's group at a moment is its latest stage-history row at or before it; before its first history row it is Quoted from its quote released date and Closed Won from its won date when the first recorded stage agrees, otherwise Opportunity. The chart says so under it. (This supersedes "no point before the history starts" of D-038.)
- **Overview: Pipeline conversion by salesperson** replaces "Weighted value by salesperson": each Sales PIC's open projects at Propose or beyond over their open projects, highest first, bars on a fixed 0-100 scale, the note says "n of m open", and the bar opens that person's open projects. People with no open project are left out. The weighted numbers stay in the exports and the table.
- **Sorting covers the whole list.** The Projects table's heading links sort every matching project (`searchProjects`: Project ID, End user, Project, Progress, Status, Source, Sales PIC, Technical PIC, Estimated, Target closing; blanks last) before a page is cut out, so Rows per page only changes how many are shown. Before, the generic click-to-sort of `Table` reordered only the rows on screen. A heading that is a link is never sorted that way.
- **Indonesian guidance, English names.** Explanations (module descriptions, field hints, placeholders, validation and refusal messages, empty states, chart and tile notes, the User Guide) are Indonesian. Module, page, field, button, status and role names, identifiers and `where`/`editable` paths in the guide stay English, so a step can be followed on screen word for word. Success confirmations ("Saved and logged", "Password changed.") and a few status words are still English.

## D-041: The SOA phase belongs to the project, not to a BOQ request (2026-10-26)

SOA phases (Assessment, Sizing, POC and any an Admin or Superadmin added, see the technical-sections work) described the stage of the technical work, yet the phase sat on a BOQ request. A project with no open BOQ, or with a BOQ that was completed or cancelled, could not show it, and a second BOQ on the same project could contradict the first. The product owner decided the phase is a project fact.

- **Where it lives.** `projects.phase` (a key of `soa_phases`, foreign key `RESTRICT`) replaces `requests.phase`, which is dropped together with its BOQ-only check. Migration `20261101100000_soa_phase_on_project` first copies, for each project, the phase of its most recently updated BOQ that had one, so nothing already recorded is lost. Switching a phase off in the list still keeps it on the projects that hold it.
- **Who sets it.** The same people as before (`requests.work.boq`: SOA, Admin, Superadmin), through `setProjectPhase` (was `setRequestPhase`), in the Technical tab of the project (a "SOA phase" block); everyone else sees it read-only. A phase can be set on a project with no request at all, and it stays when a BOQ is cancelled. The request page, the request table and the BOQ board no longer show a phase.
- **What it no longer does.** Setting a phase used to start an untouched BOQ (Submitted to In progress). It no longer does: a BOQ changes status only through its own status control, since the phase is not about one request.
- **Audit and notifications.** `project.phase_changed` (entity `project`) replaces `request.phase_changed`; Sales owner and teams are told with a link to the project. Old audit rows and notifications of the earlier kind are left as they are.
- **Tests.** Integration (`notifications`, `flow`, `technical-sections`) and E2E (`work`, `technical-sections`) were rewritten for the project-level phase; the "BOQ nobody touched starts" and "database keeps a phase off RFQ/PO" cases were removed with the behaviour.

## D-042: Superadmin, Admin and SOA can rename a project (2026-10-26)

A project's name was written once, at creation, and nobody could correct it (only the end user, by a Superadmin, through the customer). The product owner asked that Superadmin, Admin and SOA can change it, and that it be a permission.

- **Permission.** `projects.rename` (category project management, "Rename projects") is in the default set of SUPERADMIN, ADMIN and SOA; it shows on `/admin/permissions` and a Superadmin can change it there like any other.
- **Behaviour.** `renameProject` (`src/server/projects/rename.ts`) trims and single-spaces the name (1 to 160 characters), rechecks the stored role inside the transaction, writes one change-log row (field `name`, shown as "Project name", old and new value), the audit event `project.renamed` and a notification to the project's people. Saving the same name writes nothing. The request codes, the project code and the end user are untouched.
- **Where.** A "Nama project" box in the Overview of the project page, shown only with the permission.
- **Also.** The forms that kept showing the old value after a successful save (React 19 clears a form after its action) were rebuilt from the saved value (key on the form), and the PIC Workload chart says it counts only open projects.

## D-043: Change a user's e-mail, export projects in the import format, one Edit window per account (2026-10-27)

- **E-mail.** `users.change-email` (Superadmin only, locked for Superadmin, cannot be granted to another role) lets a Superadmin change the address an account signs in with: `changeUserEmail` lowercases and validates it, refuses an address another account has and the Superadmin's own account (a typo would lock them out), and audits the old and new address (`user.email_changed`). Password and sessions are untouched.
- **Export in the import format.** `/export/projects?format=import` (the Export data window and the Import window both offer it) writes the projects into the import template: same columns and order as `templateHeaders()`, values written the way the import reads them (`importRowOf`). The margin is written as the percentage or the amount, whichever was entered, never both. The file imports back as it is: every Project ID exists, so every row is a duplicate and is skipped. Each export is audited.
- **Users page.** The Actions column has one button, Edit, which opens a window with e-mail (Superadmin), role, password and activate/deactivate. The window stays open after each change so the message can be read.

## D-044: Bulk update of projects from an Excel sheet (2026-10-27)

The product owner asked that the import, given a Project ID, act as a bulk update, including the Sales PIC, the end user and the principals (several per project).

- **Mode.** The Export/Import window offers "Update existing projects" next to "Import new projects" to those holding `projects.bulk-update` (Superadmin and Admin; the permission is in the editor). The intended use: export in the import format, edit, upload. Rows are matched by Project ID; a row with no ID or an unknown one is skipped (it is not created), the same ID twice in a file is a problem.
- **What changes.** A filled cell that differs from the project is a change; an empty cell changes nothing (it never clears a value). End user (moves the project to that customer), project name, description, Sales PIC (an active Sales account, by e-mail or an unambiguous name; the cell that names the current owner is no change), Progress, Status, estimated value, target margin (percentage or amount), quote released and target closing (planned with the same stage-date rules as the project form, `planCommercialChanges`), principals (the cell replaces the whole list; the first is the main one), solution, industry and location. Never changed here: Project ID, project source and its external sales name, the Current and Next action feeds.
- **Safety.** The file is applied whole or not at all, and any problem row refuses it. A project whose Last updated differs from the sheet's new "Last updated" column (written by the export, ISO timestamp) is refused as changed since the export; an empty cell skips that check. A customer, principal or solution that does not exist yet is listed and needs an explicit confirmation before it is created, so a typo cannot add one unnoticed.
- **Trail.** One change-log row per changed field and an audit event per project (`project.commercial_updated` for the commercial fields, `project.bulk_updated` for the rest), one audit event for the file (`import.projects_update`); a Sales PIC change notifies the old and the new owner.
- **Permission note.** Admin may change a Sales PIC through this door only; `projects.reassign` (the Owners card) stays with the Superadmin.
- **Template.** The import template gained a last column, "Last updated" (ignored when importing new projects).

## D-045: SLA as two modules in Indonesian, with the e-mail recipients; the import window in Indonesian (2026-10-30)

- **Two modules.** "SLA Policies" is split into **SLA SOA** (`/admin/settings/soa`) and **SLA Purchasing** (`/admin/settings/purchasing`), one menu entry each, both behind `settings.view` (read for Admin, change for Superadmin, as before). `/admin/settings` redirects to the first. The page, its form, the messages and the template-variable labels are Indonesian; the variable names (`{{request_id}}`) and the template text itself are unchanged.
- **Where the e-mail goes.** Each team has a **To** and a **Cc** in its module (`team_settings.email_to`, `email_cc`, migration `20261102100000_team_email_recipients`). They are validated (an invalid address refuses the save), de-duplicated, and an address in To is not repeated in Cc; the change is audited with the old and new addresses. They are the recipients of the request e-mail panel and the mail draft for every request the team receives (SOA: BOQ; Purchasing: RFQ and PO). An empty To keeps the earlier behaviour: the server's `EMAIL_TO_HIT*` / `EMAIL_CC_HIT*` settings apply, so nothing configured before changes.
- **Form keeps its message.** The page no longer rebuilds the form on every save (the saved message disappeared with it); the form rebuilds its boxes from the saved values instead.
- **Import window.** The Export/Import window (title, steps, column help, results, confirmations) is Indonesian. The column names of the template stay in English because they are the names the importer matches.

## D-046: A customer's industry is chosen from a list that Admin and Superadmin edit (2026-10-30)

The industry was free text, so one industry came in several spellings. It is now a dropdown on the customer window.

- **The list.** Table `industries` (migrations `20261103100000_industries`, `20261103110000_default_industries`). It starts with the ten industries the product owner gave (Public Sector & Government, Manufacturing, Retail & E-Commerce, Healthcare (Kesehatan), Telecommunications, Financial Services, Logistics & Transportation, Education, Hospitality & Tourism, Oil & Gas) and every industry already in use, so no customer is left on a name that is not listed.
- **Who edits it.** Permission `industries.manage`, default Admin and Superadmin (it can be changed in the permission editor). It is on the Master Data page, "Industri customer": add, rename, delete. A name that exists (ignoring case and spacing) is refused; renaming moves every customer and project that carries the name; deleting is refused while a customer or project still uses it. All audited.
- **Who chooses.** Whoever may edit customers picks from the dropdown. `setCustomerIndustry` refuses a name that is not on the list and writes the list's spelling; a customer already on a name that left the list keeps it (saving the same value changes nothing). The customer keeps the name as text, so charts, filters and exports are unchanged.
- **Not covered.** The Excel import and bulk update still take any industry text for a project; they do not check it against the list.

## D-047: Master data page as tabs, with searchable paged tables and one Edit window per name (2026-10-30)

The master data page had grown long (every list, every rename and delete form in the open). It is now tabs: Principal, Solution, Industri, Technical sections and SOA phases (the last three where the permission allows), each with a count.

- **Lists.** Principal, Solution and Industri are tables with a search box and pages of ten. A row shows the name, how many projects use it (customers, for an industry) as a badge or "Belum dipakai", and one **Edit** button.
- **Edit window.** Rename (with a note that it changes everywhere the name is used) and delete in one window; Hapus is off, with the reason, while the name is in use. Same services and rules as before; the window stays open after a rename so its message can be read.
- **Not changed.** Technical sections and SOA phases keep their own row forms inside their tabs.

## D-048: Charts that count projects rank by count (2026-10-30)

The Solution mix is a count of projects, but the slices were chosen by estimated value, so "Component" (the most projects, 21, with little money) fell into "Other". `topSlices` now takes a ranking: the Solution mix and Projects by principal (`byPrincipalCount`) rank by number of projects; Value by principal and Value by industry keep ranking by value. At most seven names show, the rest fold into "Other", and every slice still opens the Projects list.

## D-049: SOA SLA in two tiers, and freeze of the SLA clock for urgent tenders (2026-10-30, decided, not built)

The latest SOA SOP says the BOQ SLA is longer when a project spans many brands (mixed), and that the SLA of the BOQs in hand may be held (frozen) when a tender must be finished fast. This records the design agreed with the product owner. Nothing is implemented yet.

- **Two tiers.** Standard: 1 to 3 working days. Mixed (several brands): 4 to 5 working days. The tier comes from the project's principals (`project_principals`), not from the PIC's judgement: one brand is Standard, two or more is Mixed. Inside a tier the range is set in the SLA SOA module, as the range already is. The tier and the SLA days used are stored on the BOQ when it is created and again when the principals change, so reports do not shift later.
- **Freeze pauses the clock, it does not move the date.** Each freeze is an append-only interval (frozen at, resumed at, reason, the tender BOQ that caused it, who approved). Remaining time = SLA days minus the working time used before the freeze; the new due date = resume time plus the remaining time. Weekends and holidays are skipped, as in the current SLA. Example: a 5-day Mixed BOQ opened Monday, due next Monday; frozen Wednesday 09:00 (2 days used), resumed Friday 09:00: due Wednesday, two working days later, exactly the length of the freeze.
- **Who.** Superadmin, Admin and the SOA team may freeze and resume (a new permission, in the permission editor). **Scope: the whole SOA team**: every open BOQ of the team is frozen together, except the urgent tender's own. A freeze has a maximum length; past it, it escalates to Admin and the owning Sales. The freeze ends by itself when the tender BOQ is completed or put on hold.
- **When a tender needs it.** Slack = tender deadline minus now minus the work left. At zero or below, the SOA lead and Admin are notified with the list of BOQs that can be frozen. With slack above zero no freeze is needed.
- **Escalation ladder** (share of SLA used, frozen time not counted): 50% reminder to the PIC; 80% warning to the PIC and the SOA lead; 100% breach to Admin and the owning Sales with the reason.
- **Honest reporting.** Turnaround and SLA compliance show two figures, calendar and net of freezes, and the frozen days as their own column, so a freeze cannot hide a breach. A Mixed BOQ is judged against its own tier.
- **Open before building:** the longest freeze allowed, and the exact number of working days a Standard BOQ gets by default inside 1 to 3 (and 4 or 5 inside Mixed, for example by the number of brands).

## D-050: Each role fills in its own part of the Excel sheet (2026-10-30)

The Export/Import window was for Admin and Superadmin (update) and Admin and SOA (add). It now serves every role that works on projects, and the sheet is cut by role.

- **Who.** `projects.bulk-update` is also held by Sales and SOA (Admin and Superadmin as before); adding projects (`projects.import`) is unchanged: Admin, SOA and Superadmin. A role that may only update sees one template, "Unduh data project Anda". Project source Other is registered by SOA, Admin or Superadmin, never by Sales.
- **Scope from permissions** (`src/domain/projects/import-scope.ts`, so the permission editor changes the sheet). Everyone gets Project ID, End user, Project name, Description, Current/Next action and Last updated. Commercial columns (Progress to Target closing, including the money) go to `projects.edit.commercial`: Sales, Admin, Superadmin. Principals and Solution go to `projects.edit.technical`; Sales PIC, source and external name to `projects.edit.source`; End user, Project name and Description are changed by `projects.rename` holders. Industry and Location go to Sales and SOA both (and Admin).
- **SOA does not see the money.** Its template and export carry none of the commercial columns, so the estimated value and the margin never reach an SOA file. This applies to the sheet only; the project page is unchanged.
- **Sales sees only its own rows.** The export holds the projects they act on (their own and Other), and the update refuses any other Project ID.
- **Enforced on the server.** A column outside the role's part may be added to the sheet by hand; if its cell differs from the stored value the row is refused with the column named, and nothing changes. A cell equal to the stored value is no change.
- **Industry is the customer's.** The update sets the customer's industry (it wins over the project's), the name must be on the list (any spelling of case and spacing is matched, the list's spelling is written), two rows may not give one customer two industries, and each change is audited as `customer.industry_set`. This replaces the earlier behaviour of writing a project-level industry. The create import still takes any industry text.
- **Tests.** Integration: scope of the columns, SOA refused a commercial change, Sales own rows only and refused a technical column, industry on the customer. E2E: Sales updates its own project from a sheet; SOA is refused a commercial column; the SOA and Sales export headers.

**D-050 addendum, Technical PIC column (2026-10-30).** The sheet gained **Technical PIC (SOA)**, in the technical part (SOA, Admin, Superadmin). The cell holds the name of an active person of the SOA PIC list (any letter case); the cell naming the current PIC is no change; a name not on the list refuses the row; Sales are refused a change. Each change is logged as Technical PIC (SOA). This lets SOA set the Technical PIC, which was Superadmin only (`projects.reassign`) on the project page; the page itself is unchanged. The create import ignores the column.
