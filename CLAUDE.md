# CLAUDE.md: project memory

Concise working context for the next session. It is not a substitute for the code, the brief or test
evidence; reconcile it with `git status`, `git log` and a fresh test run before trusting it
(AGENTS.md §2, §10). Last reconciled: 2026-10-17 (after projects, requests, the sales import and SOA edit log).

Canonical documents: [AGENTS.md](AGENTS.md) (charter) ·
[PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md) ·
[README.md](README.md) · [docs/decisions/DECISIONS.md](docs/decisions/DECISIONS.md) ·
[docs/requirements/OPEN_QUESTIONS.md](docs/requirements/OPEN_QUESTIONS.md) ·
[docs/requirements/RBAC.md](docs/requirements/RBAC.md) · [docs/requirements/PIPELINE.md](docs/requirements/PIPELINE.md)

## Latest progress

- **Committed:** `66e07fe` Docker-first foundation; `276aa46` RBAC, interim sign-in, per-role dashboards.
- **Done, not yet committed** (the user approved only those two commits; ask before committing):
  - Superadmin tools (D-016, D-021): System page, theme switcher, **Backups** (pg_dump to a host folder).
  - **Halcom Dashboard** branding, responsive sidebar shell (D-022), logo and favicon generated from the supplied image.
  - Projects and requests: BOQ / RFQ / PO with numbered IDs (D-018), status history, SOA to Purchasing handover,
    **copy-and-paste email text** (D-017, no sending, Graph question B-3 withdrawn), Audit log, own-password change.
  - Pipeline model and master data (customers, principals, solution categories), the **sales-export import**
    (`npm run db:import-projects`; the 34 projects and 9 named accounts are in the development database) (D-019, PIPELINE.md).
  - **Project updates feed** (D-020): *Current action* (what was done; the page highlights the last two) and *Next action* (what
    follows) are comment-like entries in the append-only `project_actions` (kind, text, author, time); the project keeps the latest
    text of each kind. SOA, admin and superadmin post them. **SOA technical-field editing** with a from/to change log
    (`project_changes`) also exists (slightly beyond what was asked; switch off by removing `projects.edit.technical` from SOA).
    Commercial fields stay read-only. BOM was renamed BOQ everywhere.
- **Migrations (all additive, applied to the dev DB):** `20261017120000_projects_requests`,
  `20261017180000_pipeline_master_data`, `20261017200000_project_change_log` (includes two renames, data kept),
  `20261017220000_project_action_feed` (copies the 60 existing current/next actions into the feed).
- **Checks on the final code:** typecheck and lint (0 warnings) exit 0; unit 97/97; integration 90/90 (includes real `pg_dump`);
  E2E: see the last line of this section. Earlier: production image smoke test passed, `npm audit --omit=dev` 0 vulnerabilities
  (not re-run after the image gained the PostgreSQL client).
- **Not built (asked for in the large dashboard/ticketing spec of 2026-10-17):** SLA tracking, SOA tasks and Kanban, ticket
  priority/comments/attachments/dependencies, Sales targets and pipeline dashboards, KPI charts with drill-down, Finance
  crosscheck, Excel export, Sales editing of commercial fields, customers/principals pages. They need decisions in OPEN_QUESTIONS T-16.

- **Added 2026-10-18 (D-023, not yet committed):** Sales Pipeline dashboard (Table/Charts), Progress and Status (replacing the old stage and
  status, whose columns are deprecated but not dropped), target margin and commercial editing by Sales, one form for project plus
  first request, notifications (bell and `/notifications`), SOA phase on BOQ requests, MailTo button, CSV export with column picker.
  Migrations `20261018100000`, `20261018140000`, `20261018180000` (all additive).

## Architecture decisions

D-012 interim auth, D-013 RBAC, D-014 handover email (delivery part superseded by D-017), D-015 Cache Components rules,
D-016 superadmin tooling, D-017 email copy-paste, D-018 numbering, D-019 pipeline and import, D-020 field-level edits and log,
D-021 backup, D-022 shell and branding.
Layering: pure rules in `src/domain` (`access`, `requests`, `projects`), use cases in `src/server`
(`requests`, `projects`, `import`, `system`, `auth`, `users`), UI in `src/features` and `src/app`.
Permissions are checked only through `can()` / `requirePermission()`; services re-check the stored actor inside the transaction.
A page that needs a field-level rule (SOA edits) goes through a service that whitelists field names and rejects other keys.

## Outstanding issues

- Interim sign-in has no rate limiting, no forced first-login change, no production bootstrap for the first
  superadmin (T-7, T-8, T-9). Not safe for real users.
- Open with the product owner (OPEN_QUESTIONS): T-10 remaining RBAC assumptions (A-9 visibility, A-10 commercial values,
  A-11 admin support), T-11 backup retention/encryption, T-12 further superadmin tools, T-13 numbering scope, T-14 currency,
  T-15 Purchasing PICs and roles of the people named in the export, T-16 SLA / sales target / progress rules.
- The export names no Purchasing person, so no Purchasing account was created beyond the role account.
- Two temporary images from the production smoke test remain: `halcom-prod-smoke-app` and `halcom-prod-smoke-migrate`.
  A safety check blocked `docker image rm`; the user may remove them.
- `npm audit` still lists one advisory in dev tooling (`braces`, no patch upstream; D-011).

## Next steps

1. Ask the user to confirm T-16 (SLA rules, sales target definition, project progress, commercial visibility), then build in
   this order, each with tests: Sales commercial fields and targets, SOA tasks and Kanban with SLA timing, dashboards and charts
   with drill-down, Finance crosscheck, Excel export.
2. Get the user's approval to commit the uncommitted work (suggest several commits: shell and branding, requests and email,
   pipeline and import, SOA editing).
3. Production blockers: T-7, T-8, T-9.

## Working notes (non-obvious, verified)

- Everything runs through Docker Compose; the host has no usable Node setup. Never use `down -v`.
- Host PostgreSQL 17 owns port 5432, so the container is published on 55432.
- **After a migration the running dev server holds the old Prisma client** (`reading 'findMany'` of undefined): run
  `docker compose restart app`. Same after `npm run build` in the `app` container (404 for new routes).
- **`app-test` has file polling turned off** (`NEXT_DEV_POLL_INTERVAL_MS: ""`). With polling, Next dev restart-looped under
  Docker Desktop and every page reloaded endlessly, so E2E sign-in failed. After editing source or adding routes, recreate it:
  `docker compose --profile test up -d --force-recreate app-test`. The dev `app` still polls and works.
- **Run nothing else in Docker during an E2E run** (not even `docker compose run app npm audit`): every `docker compose run app`
  executes `prisma generate`, which rewrites `src/generated` on the shared bind mount and made `app-test` reload pages, so
  25 sign-ins timed out. Also do not edit source while it runs: `app-test` compiles pages lazily. A full E2E run takes about 4 minutes
  (use a background command; foreground commands stop at 10 minutes). If a run is aborted, `test-results/` can be owned by root:
  delete `test-results` and `playwright-report` (generated output) before the next run.
- Prefer the Edit tool for edits. Node edit scripts that contain nested backticks fail silently, and heredocs with some quoting
  fail as a whole in this shell; check `git diff --stat` after a scripted edit.
- `docker compose logs --since` needs a timezone suffix (`...Z`); the host is UTC+7.
- Hostnames ending in `.app` (such as the service `app`) are HSTS-preloaded in Chromium; use the container name.
- Browse the dev server only at http://localhost:3000: other host names are blocked for dev resources, so the page is not
  interactive. Playwright needs the same (use the `e2e` service, which shares `app-test`'s network).
- A form clicked before hydration is ignored or becomes a plain reload; E2E retries sign-in (`signInAs`) and theme picks.
  React 19 clears a form's fields after every submit, so tests refill them.
- Project numbers are one sequence (`PRJ-001`...); the import raises the counter to the highest imported number, so integration
  tests that share a database must not assert "previous + 1" for project codes.
- Next.js `agentRules: false` keeps `next dev` from editing AGENTS.md. Do not edit AGENTS.md unless asked.
- Session start: `.claude/settings.json` runs a read-only SessionStart hook (git status and recent commits).
  It prints state only; it never migrates, seeds or deletes.
- `prisma/data/` (the sales export, real customer data) and `backups/` and `DEV_ACCOUNTS.md` are git-ignored and Docker-ignored.
