import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { nextProjectCode } from "@/server/requests/codes";
import { ensureCustomer } from "@/server/requests/master-data";
import { nameKey } from "@/domain/projects/pipeline";
import { planRfqImport, RFQ_IMPORT_SOURCE, type PlannedTicket, type RfqPlan, type TicketRow } from "./rfq-tickets";

/** Reads what the plan has to know about the database: the prefixes accounts hold and the counters that exist. */
export async function loadPlanContext(db: PrismaClient): Promise<{ existingPrefixes: Map<string, string>; existingCounters: Map<string, number> }> {
  const [users, counters] = await Promise.all([
    db.user.findMany({ where: { codePrefix: { not: null } }, select: { email: true, codePrefix: true } }),
    db.codeCounter.findMany({ where: { scope: { startsWith: "RFQ-" } }, select: { scope: true, lastValue: true } }),
  ]);
  return {
    existingPrefixes: new Map(users.map((u) => [u.email, u.codePrefix!])),
    existingCounters: new Map(counters.map((c) => [c.scope, c.lastValue])),
  };
}

export async function planFromDatabase(db: PrismaClient, rows: readonly TicketRow[], source: string = RFQ_IMPORT_SOURCE) {
  return planRfqImport(rows, await loadPlanContext(db), source);
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

const AUDITOR = "superadmin@example.invalid";

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
    db.user.findMany({ where: { email: { in: [...plan.accounts.map((a) => a.email), "purchasing@example.invalid", actorEmail] } }, select: { id: true, email: true, codePrefix: true } }),
    db.pic.findMany({ where: { team: "PURCHASING", nameKey: { in: plan.pics.map((p) => p.key) } }, select: { nameKey: true } }),
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
    picsToCreate: plan.pics.filter((p) => !pics.some((x) => x.nameKey === p.key)).map((p) => p.name),
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
      const userId = new Map<string, string>();
      for (const account of plan.accounts) {
        // An account that exists is kept exactly as it is; only a history-only sender that is missing is created (locked, inactive).
        const user = account.historyOnly
          ? await tx.user.upsert({
              where: { email: account.email },
              update: {},
              create: { name: account.name, email: account.email, role: account.role, passwordHash: lockedHash, isActive: false },
              select: { id: true },
            })
          : await tx.user.findUniqueOrThrow({ where: { email: account.email }, select: { id: true } });
        userId.set(account.email, user.id);
      }
      const purchasing = await tx.user.findUnique({ where: { email: "purchasing@example.invalid" }, select: { id: true } });
      const actor = await tx.user.findUnique({ where: { email: actorEmail }, select: { id: true, role: true } });
      if (!purchasing) throw new Error("The Purchasing account purchasing@example.invalid is missing. Run \"npm run db:seed\" first.");
      if (!actor || actor.role !== "SUPERADMIN") throw new Error(`${actorEmail} is not a superadmin; the import is written to the audit log as that account.`);
      for (const account of plan.accounts) {
        if (summary.accountsToCreate.includes(account.email)) {
          await tx.auditEvent.create({ data: { actorId: actor.id, action: "user.created", entityType: "user", entityId: userId.get(account.email)!, after: { email: account.email, role: account.role, isActive: false, reason: `Sender of the ${plan.source}; history only, cannot sign in.` } } });
        }
      }
      hooks.onStep?.("accounts");

      for (const { email, prefix } of plan.prefixes) {
        const current = await tx.user.findUnique({ where: { email }, select: { codePrefix: true } });
        if (current?.codePrefix) continue;
        await tx.user.update({ where: { email }, data: { codePrefix: prefix } });
      }
      hooks.onStep?.("prefixes");

      const picId = new Map<string, string>();
      for (const pic of plan.pics) {
        const row = await tx.pic.upsert({ where: { team_nameKey: { team: "PURCHASING", nameKey: pic.key } }, update: {}, create: { team: "PURCHASING", name: pic.name, nameKey: pic.key }, select: { id: true } });
        picId.set(pic.key, row.id);
        if (summary.picsToCreate.includes(pic.name)) await tx.auditEvent.create({ data: { actorId: actor.id, action: "pic.created", entityType: "pic", entityId: row.id, after: { team: "PURCHASING", name: pic.name } } });
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
            salesOwnerId: project.ownerEmail ? userId.get(project.ownerEmail) ?? (await tx.user.findUniqueOrThrow({ where: { email: project.ownerEmail }, select: { id: true } })).id : null,
            externalSourceName: project.externalSourceName,
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

      for (const ticket of toCreate) {
        await createTicket(tx, ticket, {
          projectId: projectId.get(ticket.projectKey)!,
          requesterId: userId.get(ticket.requesterEmail)!,
          purchasingId: purchasing.id,
          picId: ticket.picName ? picId.get(nameKey(ticket.picName)) ?? null : null,
          actorId: actor.id,
          fileName,
        });
      }
      hooks.onStep?.("requests");

      for (const { scope, last } of plan.counters) {
        await tx.$executeRaw`
          INSERT INTO code_counters (scope, last_value) VALUES (${scope}, ${last})
          ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value)`;
      }
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
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

type TicketIds = { projectId: string; requesterId: string; purchasingId: string; picId: string | null; actorId: string; fileName: string };

async function createTicket(tx: Prisma.TransactionClient, ticket: PlannedTicket, ids: TicketIds): Promise<void> {
  const request = await tx.request.create({
    data: {
      code: ticket.code,
      type: "RFQ",
      projectId: ids.projectId,
      status: ticket.status,
      title: ticket.title,
      description: ticket.description,
      requesterId: ids.requesterId,
      picId: ids.picId,
      submissionKey: ticket.key,
      completedAt: ticket.completedAt,
      respondedAt: ticket.respondedAt,
      emailLink: ticket.emailLink,
      emailMessageId: ticket.messageId,
      emailConversationId: ticket.conversationId,
      importedFrom: ids.fileName,
      createdAt: ticket.createdAt,
      updatedAt: ticket.outcomeAt ?? ticket.createdAt,
    },
    select: { id: true },
  });
  await tx.requestStatusHistory.create({ data: { requestId: request.id, fromStatus: null, toStatus: "SUBMITTED", changedById: ids.requesterId, changedAt: ticket.createdAt, reason: null } });
  if (ticket.outcomeAt) {
    // The Purchasing team answered it; the sheet's "Catatan" is the reason (the cancellation reason of a Failed ticket, or the note of an open one).
    await tx.requestStatusHistory.create({ data: { requestId: request.id, fromStatus: "SUBMITTED", toStatus: ticket.status, changedById: ids.purchasingId, changedAt: ticket.outcomeAt, reason: ticket.note } });
  }
  if (ids.picId) {
    await tx.requestPicAssignment.create({ data: { requestId: request.id, fromPicId: null, toPicId: ids.picId, changedById: ids.purchasingId, changedAt: ticket.outcomeAt ?? ticket.createdAt } });
  }
  await tx.auditEvent.create({ data: { actorId: ids.actorId, action: "request.imported", entityType: "request", entityId: request.id, after: { code: ticket.code, status: ticket.status, source: ids.fileName } } });
}
