import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { nextProjectCode } from "@/server/requests/codes";
import { ensureCustomer } from "@/server/requests/master-data";
import { nameKey } from "@/domain/projects/pipeline";
import { planRfqImport, RFQ_IMPORT_SOURCE, type PlannedTicket, type RfqPlan, type TicketRow } from "./rfq-tickets";

type Tx = Prisma.TransactionClient;

/**
 * Reads what the plan has to know about the database: the prefixes accounts already hold, the counters that exist and, for a rebuild, the
 * codes the tickets of this import already have (they are kept while they still fit the ticket's prefix).
 */
export async function loadPlanContext(db: PrismaClient, rebuildSource?: string): Promise<{ existingPrefixes: Map<string, string>; existingCounters: Map<string, number>; existingCodes: Map<string, string> }> {
  const [users, counters, requests] = await Promise.all([
    db.user.findMany({ where: { codePrefix: { not: null } }, select: { email: true, codePrefix: true } }),
    db.codeCounter.findMany({ where: { scope: { startsWith: "RFQ-" } }, select: { scope: true, lastValue: true } }),
    rebuildSource === undefined ? Promise.resolve([]) : db.request.findMany({ where: { importedFrom: rebuildSource, submissionKey: { not: null } }, select: { submissionKey: true, code: true } }),
  ]);
  return {
    existingPrefixes: new Map(users.map((u) => [u.email, u.codePrefix!])),
    existingCounters: new Map(counters.map((c) => [c.scope, c.lastValue])),
    existingCodes: new Map(requests.map((r) => [r.submissionKey!, r.code])),
  };
}

export async function planFromDatabase(db: PrismaClient, rows: readonly TicketRow[], source: string = RFQ_IMPORT_SOURCE, options: { rebuild?: boolean } = {}) {
  return planRfqImport(rows, await loadPlanContext(db, options.rebuild ? source : undefined), source);
}

export type RfqImportSummary = {
  dryRun: boolean;
  accountsToCreate: string[];
  prefixesToSet: { email: string; prefix: string }[];
  picsToCreate: string[];
  projectsToCreate: number;
  projectsExisting: number;
  requestsToCreate: { code: string; status: string }[];
  requestsExisting: string[];
};

export type RfqImportHooks = { onStep?: (step: string) => void };

/** A password nobody knows: the accounts the import creates only exist so history can name them, and cannot sign in (inactive, too). */
async function lockedPasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("hex"));
}

const AUDITOR = "superadmin@halcominovasi.co.id";
const PURCHASING_LOGIN = "purchasing@halcominovasi.co.id";

type Environment = {
  actor: { id: string; role: string };
  purchasingId: string;
  userId: Map<string, string>;
  picId: Map<string, string>;
  projectId: Map<string, string>;
};

const picKey = (team: string, name: string) => `${team}:${nameKey(name)}`;

/** Accounts, prefixes, PICs and projects the tickets hang on. Existing ones are kept as they are. */
async function prepare(tx: Tx, plan: RfqPlan, summary: RfqImportSummary, lockedHash: string, actorEmail: string, fileName: string, hooks: RfqImportHooks): Promise<Environment> {
  const userId = new Map<string, string>();
  for (const account of plan.accounts) {
    // An account that exists is kept exactly as it is; only a history-only sender that is missing is created (locked, inactive).
    const user = account.historyOnly
      ? await tx.user.upsert({ where: { email: account.email }, update: {}, create: { name: account.name, email: account.email, role: account.role, passwordHash: lockedHash, isActive: false }, select: { id: true } })
      : await tx.user.findUniqueOrThrow({ where: { email: account.email }, select: { id: true } });
    userId.set(account.email, user.id);
  }
  const purchasing = await tx.user.findUnique({ where: { email: PURCHASING_LOGIN }, select: { id: true } });
  const actor = await tx.user.findUnique({ where: { email: actorEmail }, select: { id: true, role: true } });
  if (!purchasing) throw new Error(`The Purchasing account ${PURCHASING_LOGIN} is missing. Run "npm run db:seed" first.`);
  if (!actor || actor.role !== "SUPERADMIN") throw new Error(`${actorEmail} is not a superadmin; the import is written to the audit log as that account.`);
  for (const account of plan.accounts) {
    if (summary.accountsToCreate.includes(account.email)) {
      await tx.auditEvent.create({ data: { actorId: actor.id, action: "user.created", entityType: "user", entityId: userId.get(account.email)!, after: { email: account.email, role: account.role, isActive: false, reason: `Sender of the ${plan.source}; history only, cannot sign in.` } } });
    }
  }
  hooks.onStep?.("accounts");

  for (const { email, prefix } of plan.prefixes) {
    const current = await tx.user.findUnique({ where: { email }, select: { codePrefix: true } });
    if (!current?.codePrefix) await tx.user.update({ where: { email }, data: { codePrefix: prefix } });
  }
  hooks.onStep?.("prefixes");

  const picId = new Map<string, string>();
  for (const pic of plan.pics) {
    const row = await tx.pic.upsert({ where: { team_nameKey: { team: pic.team, nameKey: pic.key } }, update: {}, create: { team: pic.team, name: pic.name, nameKey: pic.key }, select: { id: true } });
    picId.set(picKey(pic.team, pic.name), row.id);
    if (summary.picsToCreate.includes(pic.name)) await tx.auditEvent.create({ data: { actorId: actor.id, action: "pic.created", entityType: "pic", entityId: row.id, after: { team: pic.team, name: pic.name } } });
  }
  hooks.onStep?.("pics");

  const projectId = new Map<string, string>();
  for (const project of plan.projects) {
    const found = await tx.project.findUnique({ where: { submissionKey: project.key }, select: { id: true } });
    if (found) {
      projectId.set(project.key, found.id);
      continue;
    }
    const customerId = await ensureCustomer(tx, project.customer);
    const code = await nextProjectCode(tx);
    const created = await tx.project.create({
      data: {
        code,
        endUserCompany: project.customer,
        name: project.name,
        customerId,
        sourceType: project.ownerEmail ? "INTERNAL_SALES" : "OTHER",
        salesOwnerId: project.ownerEmail ? (userId.get(project.ownerEmail) ?? (await tx.user.findUniqueOrThrow({ where: { email: project.ownerEmail }, select: { id: true } })).id) : null,
        externalSourceName: project.externalSourceName,
        technicalPicId: project.technicalPicEmail ? userId.get(project.technicalPicEmail)! : null,
        submissionKey: project.key,
        importedFrom: fileName,
        createdAt: project.createdAt,
        updatedAt: project.createdAt,
      },
      select: { id: true },
    });
    projectId.set(project.key, created.id);
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "project.imported", entityType: "project", entityId: created.id, after: { code, source: fileName } } });
  }
  hooks.onStep?.("projects");
  return { actor, purchasingId: purchasing.id, userId, picId, projectId };
}

async function raiseCounters(tx: Tx, plan: RfqPlan): Promise<void> {
  for (const { scope, last } of plan.counters) {
    await tx.$executeRaw`
      INSERT INTO code_counters (scope, last_value) VALUES (${scope}, ${last})
      ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value)`;
  }
}

/** The status history and PIC assignment of a ticket, written from the plan. */
async function writeHistory(tx: Tx, requestId: string, ticket: PlannedTicket, env: Environment, purchasingPicId: string | null): Promise<void> {
  const requesterId = env.userId.get(ticket.requesterEmail)!;
  await tx.requestStatusHistory.create({ data: { requestId, fromStatus: null, toStatus: "SUBMITTED", changedById: requesterId, changedAt: ticket.createdAt, reason: null } });
  // The Purchasing team took it up and answered it; the sheet's note is the reason of the last move.
  for (const step of ticket.steps) {
    await tx.requestStatusHistory.create({ data: { requestId, fromStatus: step.from, toStatus: step.to, changedById: env.purchasingId, changedAt: step.at, reason: step.reason } });
  }
  if (purchasingPicId) {
    await tx.requestPicAssignment.create({ data: { requestId, fromPicId: null, toPicId: purchasingPicId, changedById: env.purchasingId, changedAt: ticket.steps[0]?.at ?? ticket.createdAt } });
  }
}

const requestFields = (ticket: PlannedTicket, env: Environment, fileName: string) => ({
  code: ticket.code,
  title: ticket.title,
  description: ticket.description,
  status: ticket.status,
  requesterId: env.userId.get(ticket.requesterEmail)!,
  picId: ticket.picName ? (env.picId.get(picKey("PURCHASING", ticket.picName)) ?? null) : null,
  raisedByPicId: ticket.raisedByPic ? (env.picId.get(picKey("SOA", ticket.raisedByPic)) ?? null) : null,
  completedAt: ticket.completedAt,
  importedFrom: fileName,
  createdAt: ticket.createdAt,
  updatedAt: ticket.steps.at(-1)?.at ?? ticket.createdAt,
});

/**
 * Applies a plan in one transaction. It only adds: a ticket whose key is already in the database is skipped, an existing account, PIC,
 * customer or prefix is kept as it is, and nothing is updated or deleted. The status history, the PIC assignment and the audit events of
 * each ticket are written with it. Any failure rolls everything back.
 */
export async function importRfqTickets(
  db: PrismaClient,
  plan: RfqPlan,
  options: { dryRun?: boolean; actorEmail?: string; fileName?: string } = {},
  hooks: RfqImportHooks = {},
): Promise<RfqImportSummary> {
  const actorEmail = options.actorEmail ?? AUDITOR;
  const fileName = options.fileName ?? plan.source;
  const [users, pics, requests] = await Promise.all([
    db.user.findMany({ where: { email: { in: [...plan.accounts.map((a) => a.email), PURCHASING_LOGIN, actorEmail] } }, select: { id: true, email: true, codePrefix: true } }),
    db.pic.findMany({ select: { team: true, nameKey: true } }),
    db.request.findMany({ where: { OR: [{ submissionKey: { in: plan.tickets.map((t) => t.key) } }, { code: { in: plan.tickets.map((t) => t.code) } }] }, select: { code: true, submissionKey: true } }),
  ]);
  const haveUser = new Set(users.map((u) => u.email));
  const haveKey = new Set(requests.map((r) => r.submissionKey));
  const haveCode = new Set(requests.map((r) => r.code));
  const existingProjects = new Set((await db.project.findMany({ where: { submissionKey: { in: plan.projects.map((p) => p.key) } }, select: { submissionKey: true } })).map((p) => p.submissionKey));
  // A key found by code but not by key is somebody else's request with that code: say so instead of overwriting.
  const clash = plan.tickets.find((t) => haveCode.has(t.code) && !haveKey.has(t.key));
  if (clash) throw new Error(`Request code ${clash.code} (line ${clash.line}) already exists for another request.`);

  const toCreate = plan.tickets.filter((t) => !haveKey.has(t.key));
  const summary: RfqImportSummary = {
    dryRun: options.dryRun === true,
    accountsToCreate: plan.accounts.filter((a) => a.historyOnly && !haveUser.has(a.email)).map((a) => a.email),
    prefixesToSet: plan.prefixes.filter((p) => !users.find((u) => u.email === p.email)?.codePrefix),
    picsToCreate: plan.pics.filter((p) => !pics.some((x) => x.team === p.team && x.nameKey === p.key)).map((p) => p.name),
    projectsToCreate: plan.projects.filter((p) => !existingProjects.has(p.key)).length,
    projectsExisting: plan.projects.filter((p) => existingProjects.has(p.key)).length,
    requestsToCreate: toCreate.map((t) => ({ code: t.code, status: t.status })),
    requestsExisting: plan.tickets.filter((t) => haveKey.has(t.key)).map((t) => t.code),
  };
  const missing = plan.accounts.filter((a) => !a.historyOnly && !haveUser.has(a.email));
  if (missing.length > 0) throw new Error(`The account ${missing.map((a) => a.email).join(", ")} is missing. Run "npm run db:seed" first.`);
  if (options.dryRun) return summary;

  // Hashing is slow by design, so it happens before the transaction opens.
  const lockedHash = summary.accountsToCreate.length > 0 ? await lockedPasswordHash() : "";

  await db.$transaction(
    async (tx) => {
      const env = await prepare(tx, plan, summary, lockedHash, actorEmail, fileName, hooks);
      for (const ticket of toCreate) {
        const fields = requestFields(ticket, env, fileName);
        const request = await tx.request.create({ data: { ...fields, type: "RFQ", projectId: env.projectId.get(ticket.projectKey)!, submissionKey: ticket.key }, select: { id: true } });
        await writeHistory(tx, request.id, ticket, env, fields.picId);
        await tx.auditEvent.create({ data: { actorId: env.actor.id, action: "request.imported", entityType: "request", entityId: request.id, after: { code: ticket.code, status: ticket.status, source: fileName } } });
      }
      hooks.onStep?.("requests");
      await raiseCounters(tx, plan);
      await tx.auditEvent.create({
        data: {
          actorId: env.actor.id,
          action: "import.rfq_tickets",
          entityType: "import",
          entityId: fileName,
          before: Prisma.JsonNull,
          after: { requestsCreated: toCreate.length, requestsSkipped: summary.requestsExisting.length, projectsCreated: summary.projectsToCreate, accountsCreated: summary.accountsToCreate.length },
        },
      });
    },
    { timeout: 120_000 },
  );
  return summary;
}

/** Accounts an earlier version of this import made senders; they now only appear in history, so their code prefix is given back. */
const RETIRED_SENDER_ACCOUNTS: readonly string[] = [];

export type RebuildSummary = { recoded: { code: string; was: string }[]; added: number; historyRowsReplaced: number; prefixesReleased: string[] };

/**
 * Brings tickets this import made earlier up to the current plan, for a development database. It exists because the plan changed after the
 * first load (the response date became an In progress step; SOA people became PICs of the shared SOA login), and the status history is
 * append-only: the history of those requests, and only theirs, is replaced inside one transaction in which the two append-only triggers
 * are switched off and on again. A request that anything but the import touched (an audit event of another kind) stops the rebuild.
 */
export async function rebuildRfqTickets(
  db: PrismaClient,
  plan: RfqPlan,
  options: { actorEmail?: string; fileName?: string } = {},
  hooks: RfqImportHooks = {},
): Promise<RebuildSummary> {
  const actorEmail = options.actorEmail ?? AUDITOR;
  const fileName = options.fileName ?? plan.source;
  const existing = await db.request.findMany({ where: { submissionKey: { in: plan.tickets.map((t) => t.key) } }, select: { id: true, code: true, submissionKey: true, importedFrom: true } });
  const byKey = new Map(existing.map((r) => [r.submissionKey!, r]));
  for (const request of existing) {
    if (request.importedFrom !== fileName) throw new Error(`${request.code} was not made by this import (${request.importedFrom ?? "the application"}); nothing was changed.`);
    const touched = await db.auditEvent.count({ where: { entityType: "request", entityId: request.id, NOT: { action: "request.imported" } } });
    if (touched > 0) throw new Error(`${request.code} was changed in the application since it was imported; nothing was changed.`);
  }
  const newAccounts: string[] = [];
  for (const account of plan.accounts) {
    const found = await db.user.findUnique({ where: { email: account.email }, select: { id: true } });
    if (found) continue;
    if (!account.historyOnly) throw new Error(`The account ${account.email} is missing. Run "npm run db:seed" first.`);
    newAccounts.push(account.email);
  }
  const lockedHash = newAccounts.length > 0 ? await lockedPasswordHash() : "";

  return db.$transaction(
    async (tx) => {
      const known = await tx.pic.findMany({ select: { team: true, nameKey: true } });
      const summary: RfqImportSummary = {
        dryRun: false,
        accountsToCreate: newAccounts,
        prefixesToSet: [],
        picsToCreate: plan.pics.filter((p) => !known.some((x) => x.team === p.team && x.nameKey === p.key)).map((p) => p.name),
        projectsToCreate: 0,
        projectsExisting: 0,
        requestsToCreate: [],
        requestsExisting: [],
      };
      const env = await prepare(tx, plan, summary, lockedHash, actorEmail, fileName, hooks);

      // The append-only triggers are off only inside this transaction, and only while the rows of these requests are replaced.
      await tx.$executeRawUnsafe('ALTER TABLE "request_status_history" DISABLE TRIGGER "request_status_history_no_update_delete"');
      await tx.$executeRawUnsafe('ALTER TABLE "request_pic_assignments" DISABLE TRIGGER "request_pic_assignments_no_update_delete"');
      const recoded: RebuildSummary["recoded"] = [];
      let replaced = 0;
      let added = 0;
      for (const ticket of plan.tickets) {
        const found = byKey.get(ticket.key);
        const fields = requestFields(ticket, env, fileName);
        if (!found) {
          const request = await tx.request.create({ data: { ...fields, type: "RFQ", projectId: env.projectId.get(ticket.projectKey)!, submissionKey: ticket.key }, select: { id: true } });
          await writeHistory(tx, request.id, ticket, env, fields.picId);
          await tx.auditEvent.create({ data: { actorId: env.actor.id, action: "request.imported", entityType: "request", entityId: request.id, after: { code: ticket.code, status: ticket.status, source: fileName } } });
          added += 1;
          continue;
        }
        replaced += (await tx.requestStatusHistory.deleteMany({ where: { requestId: found.id } })).count;
        await tx.requestPicAssignment.deleteMany({ where: { requestId: found.id } });
        await tx.request.update({ where: { id: found.id }, data: fields });
        await writeHistory(tx, found.id, ticket, env, fields.picId);
        // The project follows the plan too: who raised it decides its source.
        const project = plan.projects.find((p) => p.key === ticket.projectKey)!;
        await tx.project.update({
          where: { id: env.projectId.get(ticket.projectKey)! },
          data: {
            sourceType: project.ownerEmail ? "INTERNAL_SALES" : "OTHER",
            salesOwnerId: project.ownerEmail ? (env.userId.get(project.ownerEmail) ?? (await tx.user.findUniqueOrThrow({ where: { email: project.ownerEmail }, select: { id: true } })).id) : null,
            externalSourceName: project.externalSourceName,
            technicalPicId: project.technicalPicEmail ? env.userId.get(project.technicalPicEmail)! : null,
            createdAt: project.createdAt,
          },
        });
        if (found.code !== ticket.code) recoded.push({ code: ticket.code, was: found.code });
      }
      await tx.$executeRawUnsafe('ALTER TABLE "request_status_history" ENABLE TRIGGER "request_status_history_no_update_delete"');
      await tx.$executeRawUnsafe('ALTER TABLE "request_pic_assignments" ENABLE TRIGGER "request_pic_assignments_no_update_delete"');
      hooks.onStep?.("requests");

      const released: string[] = [];
      for (const email of RETIRED_SENDER_ACCOUNTS) {
        const user = await tx.user.findUnique({ where: { email }, select: { id: true, codePrefix: true, _count: { select: { requestsCreated: true } } } });
        if (user?.codePrefix && user._count.requestsCreated === 0) {
          await tx.user.update({ where: { id: user.id }, data: { codePrefix: null } });
          released.push(`${email} (${user.codePrefix})`);
        }
      }
      await raiseCounters(tx, plan);
      await tx.auditEvent.create({
        data: {
          actorId: env.actor.id,
          action: "import.rfq_tickets_rebuilt",
          entityType: "import",
          entityId: fileName,
          after: { requests: plan.tickets.length, historyRowsReplaced: replaced, recoded, added, prefixesReleased: released },
        },
      });
      return { recoded, added, historyRowsReplaced: replaced, prefixesReleased: released };
    },
    { timeout: 120_000 },
  );
}
