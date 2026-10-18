# Roles, Permissions and Dashboards (RBAC)

Status: **implemented foundation, matrix proposed.** The permission matrix below is an engineering
proposal built from the brief (§5 roles, §12 access principles) and the request on 2026-10-17 for
"RBAC per role including superadmin and admin, a dashboard per role, and a shared dashboard".
The visibility policy itself is still an open business decision (brief §17). Treat every row marked
*assumption* as unconfirmed.

Single source of truth in code: [permissions.ts](../../src/domain/access/permissions.ts). UI and server
both call `can()`; the menu is derived from it, and
[access.test.ts](../../tests/unit/access.test.ts) pins the matrix.

## Roles

| Role | Purpose |
|---|---|
| `SUPERADMIN` | Owns the system. Manages every account including admins and other superadmins. |
| `ADMIN` | Administers operational users and has read-only oversight of the operational dashboards. |
| `SALES` | Creates requests to SOA and Purchasing (brief §5.1). |
| `SOA` | Triages and completes BOQs, then hands over to Purchasing (§5.2). |
| `PURCHASING` | Processes RFQ and PO requests (§5.3). |
| `FINANCE` | Read-only cross-check (§5.4). |
| `MANAGEMENT` | Read-only dashboards (§5.6, optional role in the brief). |

## Implemented permissions

| Permission | SUPERADMIN | ADMIN | SALES | SOA | PURCHASING | FINANCE | MANAGEMENT |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `dashboard.shared.view` (shared overview) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `dashboard.superadmin.view` | ✔ | – | – | – | – | – | – |
| `dashboard.admin.view` | ✔ | ✔ | – | – | – | – | – |
| `dashboard.sales.view` | ✔ | ✔ | ✔ | – | – | – | – |
| `dashboard.soa.view` | ✔ | ✔ | – | ✔ | – | – | – |
| `dashboard.purchasing.view` | ✔ | ✔ | – | – | ✔ | – | – |
| `dashboard.finance.view` | ✔ | ✔ | – | – | – | ✔ | – |
| `dashboard.management.view` | ✔ | ✔ | – | – | – | – | ✔ |
| `users.view` | ✔ | ✔ | – | – | – | – | – |
| `users.manage` (create, change role, deactivate, reset password) | ✔ | ✔ | – | – | – | – | – |
| `users.manage-privileged` (act on ADMIN and SUPERADMIN accounts) | ✔ | – | – | – | – | – | – |
| `audit.view` | ✔ | ✔ | – | – | – | – | – |
| `system.monitor` (System page: performance monitoring) | ✔ | – | – | – | – | – | – |
| `system.backup` (Backups page: create a database dump in the host folder) | ✔ | – | – | – | – | – | – |
| `theme.switch` (theme switcher in the header) | ✔ | – | – | – | – | – | – |
| `projects.view`, `requests.view` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `projects.create`, `requests.create` (project and BOQ / RFQ / PO request) | ✔ | ✔ | ✔ | – | – | – | – |
| `requests.email` (email text for copy and paste) | ✔ | ✔ | ✔ | ✔ | – | – | – |
| `requests.work.boq` (change status of BOQ requests) | ✔ | ✔ | – | ✔ | – | – | – |
| `requests.work.purchasing` (change status of RFQ and PO requests) | ✔ | ✔ | – | – | ✔ | – | – |
| `requests.handover` (hand a completed BOQ over to Purchasing as RFQ or PO) | ✔ | ✔ | – | ✔ | – | – | – |
| `projects.edit.technical` (technical fields; each change logged with from and to) | ✔ | ✔ | – | ✔ | – | – | – |
| `projects.post-update` (add current-action and next-action entries to the project feed) | ✔ | ✔ | – | ✔ | – | – | – |
| `projects.create.external` (register a project whose sales is Other) | ✔ | ✔ | ✔ | ✔ | – | – | – |
| `projects.edit.source` (edit the sales name of an Other project; hand it to an internal Sales PIC) | ✔ | ✔ | ✔ | ✔ | – | – | – |
| `projects.assign-sales` (SOA: register an Internal Sales project for a salesperson they pick) | ✔ | – | – | ✔ | – | – | – |
| `projects.import` (import projects from an Excel sheet) | ✔ | ✔ | – | ✔ | – | – | – |
| `pics.manage` (create, rename, deactivate the PICs of SOA and Purchasing) | ✔ | ✔ | – | – | – | – | – |
| `customers.view` (Customers page) | ✔ | ✔ | ✔ | – | – | – | – |
| `requests.create.external` (SOA: raise a BOQ on a project whose source is Other) | ✔ | ✔ | – | ✔ | – | – | – |
| `targets.edit` (own sales targets) | ✔ | – | ✔ | – | – | – | – |
| `handoffs.view` (Purchasing Handoff list) | ✔ | ✔ | – | ✔ | – | – | – |
| `reports.technical.view` (monthly BOQ report) | ✔ | ✔ | – | ✔ | – | – | ✔ |
| `finance.crosscheck.view` (read-only crosscheck and its CSV) | ✔ | ✔ | – | – | – | ✔ | ✔ |
| `permissions.view` (this matrix, read-only) | ✔ | ✔ | – | – | – | – | – |
| `settings.view` (SLA policies, read-only) / `settings.manage` (edit) | ✔ / ✔ | ✔ / – | – | – | – | – | – |

Rules enforced in [service.ts](../../src/server/users/service.ts), inside one transaction with the audit event:

- An admin can create, edit, deactivate and reset passwords only for operational roles, and can assign
  only operational roles. Only a superadmin can touch `ADMIN` or `SUPERADMIN` accounts.
- Nobody can change their own role, status or password through user management, so an active superadmin
  always remains.
- The actor is re-read from the database inside the transaction, so a demoted or deactivated user cannot
  act on a session that still claims the old role.
- Deactivating a user and resetting a password both end all of that user's sessions.
- Every change writes an append-only `audit_events` row (database triggers reject UPDATE, DELETE and TRUNCATE).

## Dashboards

| Dashboard | Route | Content today |
|---|---|---|
| Overview (shared) | `/dashboard` | Pipeline tiles and charts, request counts (real data) |
| Superadmin | `/dashboard/superadmin` | **Real data:** accounts by role and status, recent audit events |
| Admin | `/dashboard/admin` | **Real data:** same widgets |
| Sales | `/dashboard/sales` | **Real data:** pipeline, target versus achievement, requests by status, overdue and upcoming (D-023, D-026) |
| SOA, Purchasing | `/dashboard/soa`, `/dashboard/purchasing` | **Real data (D-026):** open, backlog, overdue, SLA compliance, workload, waiting and processing time, bottlenecks |
| Finance | `/dashboard/finance` | **Real data (D-026):** pipeline values, RFQ and PO references, crosscheck flags |
| Management | `/dashboard/management` | Planned widgets, "no data yet" |

Superadmin only (D-016):

| Tool | Route or control | Content |
|---|---|---|
| System monitoring (`system.monitor`) | `/admin/system` | Application figures (uptime, memory, event loop, VM load) and database figures (size, round trip, cache hit ratio, commits and rollbacks, connections, largest tables). Counts, sizes and timings only; no query text or row data. |
| Theme switcher (`theme.switch`) | Header selector | Light, Dark or System, stored per browser. The permission only controls who sees the control. |
| Database backup (`system.backup`) | `/admin/backups` | Creates a `pg_dump` in the host folder and lists existing ones; never deletes or restores (D-021). |

The planned widgets come from brief §5 and §9 ([definitions.ts](../../src/features/dashboards/definitions.ts)).
They show no numbers, because projects and tickets do not exist yet and the brief forbids fabricated
analytics (§18). They fill in when the project and ticket modules are built.

## Assumptions to confirm

| ID | Assumption | Alternative |
|---|---|---|
| A-1 | One role per user. | Multiple roles per user (brief §11 `user_roles`). |
| A-2 | **Confirmed 2026-10-17.** Admin may view every operational dashboard (read-only oversight) but not the superadmin dashboard. | Admin sees only its own dashboard. |
| A-3 | **Confirmed 2026-10-17.** Only a superadmin manages admin accounts; admins add and manage the other operational users. | Admins may manage each other. |
| A-4 | All roles may open the shared overview. Which figures it may show to Sales or Finance is undecided (brief §17: visibility). | Restrict by role or by project ownership. |
| A-5 | **Changed by D-026.** Sessions last 12 hours idle, are renewed while the person works, and end at most 7 days after sign-in. | Other limits (env `SESSION_TTL_HOURS`, `SESSION_MAX_HOURS`), or SSO session lifetime. |
| A-6 | Passwords need 12 to 128 characters; there is no complexity rule or rotation. | Company password policy, or SSO only. |
| A-7 | Management is included as an optional read-only role. | Remove it. |
| A-8 | The UI language is English, matching the brief. | Indonesian, or both. |
| A-9 | Every role can read every project and request (no row-level visibility policy yet; brief §17). | Restrict by role, team or project ownership. |
| A-10 | Every role can read commercial values (estimated and final value, probability). SOA and Purchasing see them read-only. | Hide values from some roles; the `projects.view` check would gain a commercial variant. |
| A-11 | Admin and superadmin may support Sales (create projects and requests) and work on both BOQ and purchasing requests. | Admins read only. |

## Proposed permissions for the next modules (not implemented)

Added to the matrix only when the feature that checks them exists (AGENTS.md §5).

| Capability | Proposed roles | Brief reference |
|---|---|---|
| Create project, submit BOQ / RFQ / PO request | SALES (SUPERADMIN, ADMIN for support) | §5.1, §6 |
| Triage, update, attach and complete BOQ; hand over to Purchasing | SOA | §5.2, §6.1 |
| Update RFQ / PO requests, record purchasing references | PURCHASING | §5.3 |
| Read projects, tickets, BOQ and PO references (read-only) | FINANCE | §5.4, §10 |
| Read dashboards and drill into tickets | MANAGEMENT | §5.6, §9 |
| Export `.xlsx` per dataset | Per dataset, undecided | §6.5, §17 |
| View email delivery log | ADMIN, SUPERADMIN | §6.5 |
| Configure SLA policies, request types, master data | ADMIN, SUPERADMIN | §5.5 |
