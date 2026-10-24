# Plan: align seed accounts and tests with the Neon / local databases

Status: **seed, importer and the tests that use them were moved to the new accounts on 2026-10-23 (D-037)**, as the product owner asked ("update the seed to @halcominovasi.co.id"). Decision 1 went the other way from the recommendation for the seed-coupled tests (they use the new domain); fixtures that only need some address keep `@example.invalid`. Decision 2: the minimum password length is now 8. Decision 3: still true, the seed never runs against Neon.

## Why

On 2026-10-22 the Neon and local development databases were edited by hand and now agree with each other, but the code still
describes the old accounts:

| Topic | Databases now | Code / tests still say |
|---|---|---|
| E-mail domain | `@halcominovasi.co.id` | `@example.invalid` |
| Names | `Admin`, `Sales`, `SOA`... | `Dev Admin`, `Dev Sales`... |
| SOA login | `support@halcominovasi.co.id` | `soa@example.invalid` |
| Accounts removed | `sales@`, `gusti@`, `adityo@`, `ibnu.ardhiansyah@` | still seeded / imported (`gusti`, `adityo`, `ibnu.ardhiansyah` in `rfq-tickets.ts`, `seed-users.ts`) |
| PICs removed | "SOA PIC 1/2", "Purchasing PIC 1" | still seeded by `seedMasterDataAndPics` |
| Password | `halcom123` (9 characters, set directly in the database) | seed requires `SEED_USER_PASSWORD` of at least 12 characters |

Risks if nothing changes: `npm run db:seed` on Neon would create the old `@example.invalid` accounts again as duplicates, and any
test run against the current local database fails at sign-in.

## Decisions needed first

1. **Test data stays separate.** Recommended: the tests keep running against `db-test` (tmpfs) with their own synthetic accounts, so a
   real domain never appears in test fixtures. Only the *seed for real databases* moves to `@halcominovasi.co.id`.
   Alternative: change everything to the new domain (about 150 occurrences in 30 files, listed below).
2. **Password.** The 12-character minimum (`PASSWORD_MIN_LENGTH`) cannot accept `halcom123`. Options: keep the rule and set the Neon
   password by hand as now (recommended), or lower the minimum (a policy change that also weakens every password a user chooses).
3. **Seed on Neon.** Should `db:seed` be allowed against Neon at all? Today it refuses outside `APP_ENV` development/test. Recommended:
   no; Neon is filled by migrations plus the generated import SQL, and accounts are created on the Users page.
4. **Historic accounts** (`gusti`, `adityo`, `ibnu.ardhiansyah`) are gone from both databases. The RFQ import must stop creating them.
   Decide who stands in as requester for the RFQ-G tickets (done by hand: Satrio) and as Technical PIC (done by hand: `support@`).

## Work items (after the decisions)

### A. Seed and import code
- `src/domain/devdata/accounts.ts`: `seedEmailFor`, `seedNameFor`, `DEV_SALES_ACCOUNTS`. New domain; names without "Dev ";
  the SOA role maps to `support@`.
- `prisma/seed-users.ts` (8 hits): list of obsolete accounts, notes.
- `src/server/devdata/seed-dev.ts` (7), `src/server/devdata/cleanup.ts`, `prisma/cleanup-dev-data.ts`, `prisma/dev-accounts.ts`
  (it filters on `endsWith "@example.invalid"`).
- `src/server/import/rfq-tickets.ts`, `rfq-tickets-db.ts`, `rfq-tickets-sql.ts`: drop the history-only accounts; map the senders
  to existing accounts; make the generated SQL need `purchasing@`, `support@`, `satrio@`, `dzaki@` only.
- `src/server/projects/owner-remap.ts` (4), `src/server/import/projects-csv.ts` (2).
- Remove "SOA PIC 1/2" and "Purchasing PIC 1" from the PIC seed.
- `compose.yaml` (test service mail addresses, 5 hits) - low priority, test only.

### B. Tests (about 30 files)
- Unit: `dev-accounts.test.ts` (12), `rfq-tickets.test.ts` (8), `import.test.ts` (6), `export-mailto.test.ts` (4),
  `device-policy.test.ts`, `request-domain.test.ts`.
- Integration: `seed-dev.test.ts` (10), `code-prefix-and-rfq-import.test.ts` (4), `dev-cleanup.test.ts` (2) and one hit each in
  `auth`, `helpers`, `owner-remap`, `purchasing-rfq`, `requests-service`, `revision-request`, `system-snapshot`.
- E2E: `work.spec.ts` (8), `rbac.spec.ts` (2), `admin-tools.spec.ts`; the visible-name checks "Dev Sales" / "Dev Finance" in
  `modules.spec.ts`, `purchasing-rfq.spec.ts`, `work.spec.ts`; `tests/e2e/helpers.ts` sign-in helper.
- Add a test that fails when a seed e-mail uses a domain other than the configured one, so the code and databases cannot drift again.

### C. Documentation
- `README.md`, `docs/decisions/DECISIONS.md` (new decision), `CLAUDE.md`, `deployment/*.md`, `.env.example` (seed password note).

## Order of work
1. Decisions above.
2. Change the single source (`accounts.ts`) and `seed-users.ts`; run unit tests and fix them.
3. Import code and generated SQL; regenerate `halcom_import_all.sql` and compare with what Neon holds.
4. Integration tests on `db-test`; then E2E in the clean-up order recorded in `CLAUDE.md` ("RESUME HERE").
5. Seed a throw-away database and diff its accounts against Neon (names, e-mails, roles, prefixes).
6. Update docs, commit in separate commits (code, tests, docs), push.

## Test checklist
- [ ] `npm run typecheck` and `npm run lint` clean
- [ ] Unit tests green
- [ ] Integration tests green on `db-test`
- [ ] E2E: `rbac`, `work`, `modules`, `admin-tools`, `purchasing-rfq`, `revision`, `guide`, `customer-industry`, `request-page`
- [ ] Fresh database: `db:migrate:deploy` + seed + import SQL gives the same accounts as Neon
- [ ] `db:seed` run twice creates no duplicates
- [ ] Sign in as every role with the chosen password; the Users page shows the expected names
- [ ] Neon and local `select email, role, is_active from users` are identical

## Done by hand on 2026-10-22 (for reference; no code behind it)
- Both databases: accounts renamed to `@halcominovasi.co.id`, "Dev " removed, `soa@` became `support@`.
- Deleted: `sales@`, `gusti@`, `adityo@`, `ibnu.ardhiansyah@` (35 Technical PIC links moved to `support@`; 4 RFQ-G tickets and their
  history rows moved from Gusti to Satrio, which needed the append-only trigger switched off for one transaction).
- Deleted PICs "SOA PIC 1", "SOA PIC 2", "Purchasing PIC 1".
- Password of all active accounts set to `halcom123` directly in the databases.
