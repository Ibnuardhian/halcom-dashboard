import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { classifyProject } from "@/domain/devdata/test-data";

/**
 * Development data cleanup: obsolete accounts and the test projects of one day (D-032).
 *
 * `planDevCleanup` only reads. `applyDevCleanup` redoes the plan inside one transaction, refuses to continue if it no longer matches
 * the plan that was reviewed, and then changes exactly what the plan lists. Nothing is truncated or reset.
 *  - A test project is deleted the way the application deletes a project: it is marked deleted and hidden from every list and chart
 *    while its requests and history stay (those tables are append-only, so a hard delete is impossible by design).
 *  - An obsolete account with no references anywhere is deleted. One that history still refers to (audit trail, request history,
 *    projects) is deactivated: it can no longer sign in, and the history keeps resolving to its name.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type CleanupOptions = {
  /** The day to look at, as YYYY-MM-DD. */
  date: string;
  /** The IANA time zone the day is read in. The application shows UTC. */
  timeZone: string;
  /** Accounts marked obsolete (the registry in prisma/seed-users.ts). Nothing outside this list is ever removed. */
  obsoleteEmails: readonly string[];
  /** Only accounts with this e-mail suffix may be removed: the synthetic development accounts. */
  syntheticSuffix?: string;
};

export type Reference = { table: string; column: string; count: number };

export type AccountPlan = {
  email: string;
  id: string | null;
  name: string | null;
  role: string | null;
  isActive: boolean;
  references: Reference[];
  action: "delete" | "deactivate" | "keep" | "missing";
  reason: string;
};

export type RequestRow = { id: string; code: string; type: string; status: string; createdAt: Date };

export type TestProjectPlan = {
  id: string;
  code: string;
  name: string;
  customer: string;
  createdAt: Date;
  evidence: string[];
  requests: RequestRow[];
  /** Rows that stay exactly as they are (append-only history) and rows that go with the project's requests. */
  history: { statusHistory: number; picAssignments: number; projectChanges: number; projectActions: number; auditEvents: number };
  /** Notifications that only point at this project or its requests; they are removed because the page behind them is gone. */
  notificationIds: string[];
};

export type UntouchedRecord = { kind: "project" | "request"; code: string; createdAt: Date; reason: string };

export type CleanupPlan = {
  window: { date: string; timeZone: string; start: Date; end: Date };
  accounts: AccountPlan[];
  testProjects: TestProjectPlan[];
  /** Records from the chosen day that were looked at and are not confirmed test data. */
  untouched: UntouchedRecord[];
  /** Projects that look like test data (placeholder company) but were created on another day. Reported only. */
  lookalikes: UntouchedRecord[];
};

/** Start and end of a calendar day in a time zone, computed by the database so daylight saving and offsets are right. */
async function dayWindow(db: Db, date: string, timeZone: string): Promise<{ start: Date; end: Date }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date must be YYYY-MM-DD (got "${date}").`);
  const [row] = await db.$queryRaw<{ start: Date; end: Date }[]>`
    SELECT (${date}::date)::timestamp AT TIME ZONE ${timeZone} AS start,
           ((${date}::date + 1))::timestamp AT TIME ZONE ${timeZone} AS "end"`;
  if (!row) throw new Error("Could not compute the day window.");
  return row;
}

/** Every column that points at users(id), found in the catalog so a table added later is never missed. */
async function userReferences(db: Db): Promise<{ table: string; column: string; restrict: boolean }[]> {
  const rows = await db.$queryRaw<{ tbl: string; col: string; del: string }[]>`
    SELECT cl.relname AS tbl, a.attname AS col, c.confdeltype::text AS del
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
    ORDER BY cl.relname, a.attname`;
  return rows.map((row) => ({ table: row.tbl, column: row.col, restrict: row.del !== "c" }));
}

async function countWhere(db: Db, table: string, column: string, id: string): Promise<number> {
  // Table and column names come from the catalog query above, never from input; the id is a bound parameter.
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = $1::uuid`, id);
  return Number(rows[0]?.n ?? 0);
}

async function planAccounts(db: Db, options: CleanupOptions): Promise<AccountPlan[]> {
  const suffix = options.syntheticSuffix ?? "@example.invalid";
  const refs = await userReferences(db);
  const plans: AccountPlan[] = [];
  for (const email of options.obsoleteEmails) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, isActive: true } });
    if (!user) {
      plans.push({ email, id: null, name: null, role: null, isActive: false, references: [], action: "missing", reason: "no such account (already removed)" });
      continue;
    }
    const base = { email, id: user.id, name: user.name, role: user.role, isActive: user.isActive };
    const references: Reference[] = [];
    for (const ref of refs) {
      const count = await countWhere(db, ref.table, ref.column, user.id);
      if (count > 0) references.push({ table: ref.table, column: ref.column, count });
    }
    const restrictRefs = references.filter((ref) => refs.find((r) => r.table === ref.table && r.column === ref.column)?.restrict);
    const liveSessions = await db.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } });

    if (!email.endsWith(suffix)) plans.push({ ...base, references, action: "keep", reason: `not a synthetic ${suffix} account` });
    else if (user.role === "SUPERADMIN" || user.role === "ADMIN") plans.push({ ...base, references, action: "keep", reason: "administrator accounts are never removed by this script" });
    else if (liveSessions > 0) plans.push({ ...base, references, action: "keep", reason: `signed in right now (${liveSessions} live session${liveSessions === 1 ? "" : "s"}), so not confirmed unused` });
    else if (restrictRefs.length > 0) {
      const text = restrictRefs.map((ref) => `${ref.table}.${ref.column} x${ref.count}`).join(", ");
      plans.push(
        user.isActive
          ? { ...base, references, action: "deactivate", reason: `history refers to it (${text}); deleting would break the audit trail, so it is deactivated` }
          : { ...base, references, action: "keep", reason: `already inactive; history refers to it (${text})` },
      );
    } else plans.push({ ...base, references, action: "delete", reason: "nothing refers to it except its own sessions and notifications" });
  }
  return plans;
}

async function planProjects(db: Db, window: { start: Date; end: Date }): Promise<Pick<CleanupPlan, "testProjects" | "untouched" | "lookalikes">> {
  const projects = await db.project.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      createdAt: true,
      importedFrom: true,
      submissionKey: true,
      deletedAt: true,
      customer: { select: { name: true } },
      requests: { select: { id: true, code: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { code: "asc" },
  });

  const testProjects: TestProjectPlan[] = [];
  const untouched: UntouchedRecord[] = [];
  const lookalikes: UntouchedRecord[] = [];
  const inWindow = (date: Date) => date >= window.start && date < window.end;

  for (const project of projects) {
    const verdict = classifyProject({ ...project, customerName: project.customer?.name ?? null }, window);
    if (!verdict.test) {
      if (inWindow(project.createdAt) && !project.deletedAt) untouched.push({ kind: "project", code: project.code, createdAt: project.createdAt, reason: verdict.reason });
      else if (!project.deletedAt && !project.importedFrom && project.submissionKey && /^PT [A-Z]{4}$/.test(project.customer?.name ?? "")) {
        lookalikes.push({ kind: "project", code: project.code, createdAt: project.createdAt, reason: `looks like test data ("${project.customer?.name}") but was created on another day` });
      }
      // A request of the chosen day on a project that is not test data stays too, and is said so.
      if (!project.deletedAt) {
        for (const request of project.requests.filter((r) => inWindow(r.createdAt))) {
          untouched.push({ kind: "request", code: request.code, createdAt: request.createdAt, reason: `belongs to ${project.code}, which is not confirmed test data` });
        }
      }
      continue;
    }

    const requestIds = project.requests.map((request) => request.id);
    // The links a notification carries: /projects/<code> and /request/<code>, exactly.
    const hrefs = [`/projects/${project.code}`, ...project.requests.map((request) => `/request/${request.code}`)];
    const [statusHistory, picAssignments, projectChanges, projectActions, auditEvents, notifications] = await Promise.all([
      db.requestStatusHistory.count({ where: { requestId: { in: requestIds } } }),
      db.requestPicAssignment.count({ where: { requestId: { in: requestIds } } }),
      db.projectChange.count({ where: { projectId: project.id } }),
      db.projectAction.count({ where: { projectId: project.id } }),
      db.auditEvent.count({ where: { OR: [{ entityType: "project", entityId: project.id }, { entityType: "request", entityId: { in: requestIds } }] } }),
      db.notification.findMany({ where: { href: { in: hrefs } }, select: { id: true } }),
    ]);
    testProjects.push({
      id: project.id,
      code: project.code,
      name: project.name,
      customer: project.customer?.name ?? "",
      createdAt: project.createdAt,
      evidence: verdict.evidence,
      requests: project.requests,
      history: { statusHistory, picAssignments, projectChanges, projectActions, auditEvents },
      notificationIds: notifications.map((notification) => notification.id).sort(),
    });
  }
  return { testProjects, untouched, lookalikes };
}

/** Read-only: what the cleanup would do. Nothing is written. */
export async function planDevCleanup(db: Db, options: CleanupOptions): Promise<CleanupPlan> {
  const window = await dayWindow(db, options.date, options.timeZone);
  const [accounts, projects] = await Promise.all([planAccounts(db, options), planProjects(db, window)]);
  return { window: { date: options.date, timeZone: options.timeZone, ...window }, accounts, ...projects };
}

/** What identifies a plan: the things it would change. Used to refuse an apply whose data moved since the review. */
export function planFingerprint(plan: CleanupPlan): string {
  return JSON.stringify({
    accounts: plan.accounts.map((account) => [account.email, account.id, account.action]),
    projects: plan.testProjects.map((project) => [project.id, project.requests.map((request) => request.id).sort(), project.notificationIds]),
  });
}

export type ApplyHooks = {
  /** Called after each step with its name, inside the transaction. A test throws from here to prove everything rolls back. */
  onStep?: (step: string) => void;
};

export type ApplySummary = {
  projectsDeleted: number;
  requestsHidden: number;
  notificationsRemoved: number;
  accountsDeleted: string[];
  accountsDeactivated: string[];
};

/**
 * Applies a reviewed plan in one transaction. The plan is computed again inside it; if anything differs, nothing is changed.
 * `actorEmail` is the development superadmin the audit events are written as.
 */
export async function applyDevCleanup(db: PrismaClient, reviewed: CleanupPlan, options: CleanupOptions, actorEmail: string, hooks: ApplyHooks = {}): Promise<ApplySummary> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE`;
      const actor = await tx.user.findUnique({ where: { email: actorEmail }, select: { id: true, role: true, isActive: true } });
      if (!actor?.isActive || actor.role !== "SUPERADMIN") throw new Error(`${actorEmail} is not an active superadmin; the cleanup is written to the audit log as that account.`);

      const current = await planDevCleanup(tx, options);
      if (planFingerprint(current) !== planFingerprint(reviewed)) throw new Error("The data changed since the dry run was made. Run the dry run again and review it.");

      const now = new Date();
      for (const project of current.testProjects) {
        await tx.project.update({ where: { id: project.id }, data: { deletedAt: now, deletedById: actor.id } });
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "project.deleted",
            entityType: "project",
            entityId: project.id,
            before: { code: project.code, name: project.name, endUserCompany: project.customer, requests: project.requests.map((request) => request.code), reason: `development test data of ${current.window.date}`, evidence: project.evidence },
          },
        });
      }
      hooks.onStep?.("projects");

      const notificationIds = current.testProjects.flatMap((project) => project.notificationIds);
      const removed = notificationIds.length ? (await tx.notification.deleteMany({ where: { id: { in: notificationIds } } })).count : 0;
      hooks.onStep?.("notifications");

      const accountsDeleted: string[] = [];
      const accountsDeactivated: string[] = [];
      for (const account of current.accounts) {
        if (!account.id) continue;
        if (account.action === "delete") {
          await tx.auditEvent.create({
            data: { actorId: actor.id, action: "user.removed", entityType: "user", entityId: account.id, before: { name: account.name, email: account.email, role: account.role, reason: account.reason } },
          });
          // Sessions, remembered devices and notifications go with the account (they cascade); everything else was checked to be zero.
          await tx.user.delete({ where: { id: account.id } });
          accountsDeleted.push(account.email);
        } else if (account.action === "deactivate") {
          await tx.user.update({ where: { id: account.id }, data: { isActive: false } });
          await tx.session.deleteMany({ where: { userId: account.id } });
          await tx.deviceCredential.deleteMany({ where: { userId: account.id } });
          await tx.auditEvent.create({
            data: { actorId: actor.id, action: "user.deactivated", entityType: "user", entityId: account.id, before: { email: account.email, isActive: true }, after: { isActive: false, reason: account.reason } },
          });
          accountsDeactivated.push(account.email);
        }
      }
      hooks.onStep?.("accounts");

      // Verify inside the transaction: a mismatch rolls everything back.
      const hidden = await tx.project.count({ where: { id: { in: current.testProjects.map((project) => project.id) }, deletedAt: { not: null } } });
      if (hidden !== current.testProjects.length) throw new Error("Verification failed: not every test project is marked deleted.");
      const leftover = await tx.user.count({ where: { email: { in: accountsDeleted } } });
      if (leftover !== 0) throw new Error("Verification failed: a removed account still exists.");

      return {
        projectsDeleted: current.testProjects.length,
        requestsHidden: current.testProjects.reduce((sum, project) => sum + project.requests.length, 0),
        notificationsRemoved: removed,
        accountsDeleted,
        accountsDeactivated,
      };
    },
    { timeout: 60_000 },
  );
}
