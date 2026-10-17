# CLAUDE.md: project memory

Concise working context for the next session. It is not a substitute for the code, the brief or test
evidence; reconcile it with `git status`, `git log` and a fresh test run before trusting it
(AGENTS.md §2, §10). Last reconciled: 2026-10-17.

Canonical documents: [AGENTS.md](AGENTS.md) (charter) ·
[PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md](PROJECT_BRIEF_TICKETING_PROJECT_TRACKER.md) ·
[README.md](README.md) · [docs/decisions/DECISIONS.md](docs/decisions/DECISIONS.md) ·
[docs/requirements/OPEN_QUESTIONS.md](docs/requirements/OPEN_QUESTIONS.md) ·
[docs/requirements/RBAC.md](docs/requirements/RBAC.md)

## Latest progress

- **Committed** (`66e07fe`): Docker-first foundation. Next.js 16.4.2, Prisma 7.10.1, PostgreSQL 18.6,
  pinned images, dev and prod Compose stacks, health checks, test tooling.
- **Done, not yet committed** (user approved only the first commit): access foundation.
  - Migration `access_foundation`: `users`, `sessions`, `audit_events` (append-only triggers, lower-case email check).
  - Interim email/password sign-in with database sessions; seven roles; permission matrix; a dashboard per
    role plus a shared overview; user management with audit events.
  - Real data exists only on the Admin and Superadmin dashboards. All other widgets say "No data yet".
- **Checks run on the final code:** typecheck, lint (0 warnings) and `next build` exit 0; unit 24/24;
  integration 32/32; E2E 20/20. Production image smoke test passed (migration, health, login page,
  protected routes leak no content). `npm audit --omit=dev`: 0 vulnerabilities. A real login as
  Superadmin and SOA was verified on the dev server (`app`, port 3000).
- **User decision (2026-10-17):** after SOA replies to a `[HITBOQ]` email, the message becomes
  `[HITRFQ]` to Purchasing (D-014). Not implemented; the email module does not exist yet.

## Architecture decisions

D-012 interim auth, D-013 RBAC, D-014 handover email, D-015 Cache Components rules for signed-in pages.
Layering: pure rules in `src/domain`, use cases in `src/server`, UI in `src/features` and `src/app`.
Permissions are checked only through `can()` / `requirePermission()`; services re-check inside the transaction.

## Outstanding issues

- Interim sign-in has no rate limiting, no password-change screen, no production bootstrap for the first
  superadmin (T-7, T-8, T-9). Not safe for real users.
- RBAC assumptions A-1 to A-8 and the handover questions B-1, B-2 await the product owner (T-10).
- Open from the brief §17: SOA/Purchasing completion, SLA targets, visibility policy, Finance fields,
  email mode and distribution lists, export permissions.
- Two temporary images from the production smoke test remain: `halcom-prod-smoke-app` and
  `halcom-prod-smoke-migrate`. A safety check blocked `docker image rm`; the user may remove them.
- `npm audit` still lists one advisory in dev tooling (`braces`, no patch upstream; D-011).

## Next steps

1. Get answers for T-10, B-1, B-2, then design the project and ticket schema (brief §11) as an additive migration.
2. Build projects, BOQ/RFQ/PO requests, status history with audit, then the email composer
   (`[HITBOQ]`, `[HITRFQ]`, `[HITPO]`, draft mode first), then the SOA-to-Purchasing handover (idempotent).
3. Replace the placeholder dashboard widgets with real queries as the data appears.

## Working notes (non-obvious, verified)

- Everything runs through Docker Compose; the host has no usable Node setup. Never use `down -v`.
- Host PostgreSQL 17 owns port 5432, so the container is published on 55432.
- After `npm run build` in the `app` container, the running dev server can serve 404s for new routes:
  `docker compose restart app`.
- `docker compose logs --since` needs a timezone suffix (`...Z`); the host is UTC+7.
- Hostnames ending in `.app` (such as the service `app`) are HSTS-preloaded in Chromium; use the container name.
- Next.js `agentRules: false` keeps `next dev` from editing AGENTS.md. Do not edit AGENTS.md unless asked.
- Session start: `.claude/settings.json` runs a read-only SessionStart hook (git status and recent commits).
  It prints state only; it never migrates, seeds or deletes.
