import { progressFromStage, trackStatusFromStatus } from "@/domain/projects/progress";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { ensureCustomer, ensurePrincipal, ensureSolutionCategory } from "@/server/requests/master-data";
import { nameKey } from "@/domain/projects/pipeline";
import { accountEmailFor, peopleFrom, type ProjectImportRow } from "./projects-csv";

export type ImportSummary = {
  dryRun: boolean;
  usersToCreate: string[];
  usersExisting: string[];
  projectsToCreate: string[];
  projectsExisting: string[];
  customers: number;
  principals: number;
  solutionCategories: number;
};

const COUNTER_SCOPE = "PRJ-";
const TRANSACTION_TIMEOUT_MS = 120_000;

function codeNumber(code: string): number {
  return Number(code.slice(4));
}

/**
 * Loads parsed sales-export rows. Everything is written in one transaction, so a failure imports
 * nothing. It only adds: a project whose code already exists is left exactly as it is, an existing user
 * keeps its role and password, and nothing is deleted or overwritten. Re-running is safe.
 *
 * A dry run reports what would happen and writes nothing.
 */
export async function importProjects(
  db: PrismaClient,
  rows: readonly ProjectImportRow[],
  options: { source: string; password: string; dryRun?: boolean },
): Promise<ImportSummary> {
  const people = peopleFrom(rows);
  const existingUsers = await db.user.findMany({ where: { email: { in: people.map((p) => p.email) } }, select: { email: true } });
  const existingEmails = new Set(existingUsers.map((u) => u.email));
  const existingProjects = await db.project.findMany({ where: { code: { in: rows.map((r) => r.code) } }, select: { code: true } });
  const existingCodes = new Set(existingProjects.map((p) => p.code));

  // Master data that is new to this database, by normalised name (counting table sizes would also count
  // rows that other sessions add at the same time).
  const newOnes = async (names: (string | null)[], existing: (keys: string[]) => Promise<{ nameKey: string }[]>) => {
    const keys = [...new Set(names.filter((n): n is string => n !== null).map(nameKey))];
    const found = new Set((await existing(keys)).map((row) => row.nameKey));
    return keys.filter((key) => !found.has(key)).length;
  };
  const [customers, principals, solutionCategories] = await Promise.all([
    newOnes(rows.map((r) => r.customer), (keys) => db.customer.findMany({ where: { nameKey: { in: keys } }, select: { nameKey: true } })),
    newOnes(rows.map((r) => r.principal), (keys) => db.principal.findMany({ where: { nameKey: { in: keys } }, select: { nameKey: true } })),
    newOnes(rows.map((r) => r.solution), (keys) => db.solutionCategory.findMany({ where: { nameKey: { in: keys } }, select: { nameKey: true } })),
  ]);

  const summary: ImportSummary = {
    dryRun: options.dryRun === true,
    usersToCreate: people.filter((p) => !existingEmails.has(p.email)).map((p) => `${p.name} (${p.role})`),
    usersExisting: people.filter((p) => existingEmails.has(p.email)).map((p) => p.name),
    projectsToCreate: rows.filter((r) => !existingCodes.has(r.code)).map((r) => r.code),
    projectsExisting: rows.filter((r) => existingCodes.has(r.code)).map((r) => r.code),
    customers,
    principals,
    solutionCategories,
  };
  if (options.dryRun) return summary;

  // Password hashing is slow by design, so it happens before the transaction opens.
  const hashes = new Map<string, string>();
  for (const person of people) if (!existingEmails.has(person.email)) hashes.set(person.email, await hashPassword(options.password));

  await db.$transaction(
    async (tx) => {
      const userIds = new Map<string, string>();
      for (const person of people) {
        const user = await tx.user.upsert({
          where: { email: person.email },
          update: {}, // an existing account keeps its role and password
          create: { name: person.name, email: person.email, role: person.role, passwordHash: hashes.get(person.email) ?? "" },
          select: { id: true },
        });
        userIds.set(person.email, user.id);
      }

      const ordered = [...rows].sort((a, b) => codeNumber(a.code) - codeNumber(b.code));
      for (const row of ordered) {
        if (existingCodes.has(row.code)) continue;
        const [customerId, principalId, solutionCategoryId] = await Promise.all([
          ensureCustomer(tx, row.customer),
          row.principal ? ensurePrincipal(tx, row.principal) : null,
          row.solution ? ensureSolutionCategory(tx, row.solution) : null,
        ]);
        const project = await tx.project.create({
          data: {
            code: row.code,
            endUserCompany: row.customer,
            name: row.name,
            description: row.description,
            progress: progressFromStage(row.stage),
            trackStatus: trackStatusFromStatus(row.status),
            targetDate: row.targetClosing,
            salesOwnerId: userIds.get(accountEmailFor(row.salesPic))!,
            technicalPicId: row.technicalPic ? userIds.get(accountEmailFor(row.technicalPic)) : null,
            customerId,
            principalId,
            solutionCategoryId,
            industry: row.industry,
            location: row.location,
            estimatedValue: row.estimatedValue,
            probability: row.probability,
            finalValue: row.finalValue,
            wonDate: row.wonDate,
            lostReason: row.lostReason,
            lostNotes: row.lostNotes,
            competitor: row.competitor,
            competitionStatus: row.competitionStatus,
            requirement: row.requirement,
            assessmentStatus: row.assessmentStatus,
            solutionProposed: row.solutionProposed,
            architectureStatus: row.architectureStatus,
            sizingStatus: row.sizingStatus,
            boqStatus: row.boqStatus,
            quotationStatus: row.quotationStatus,
            proposalStatus: row.proposalStatus,
            pocStatus: row.pocStatus,
            technicalChallenge: row.technicalChallenge,
            technicalBlocker: row.technicalBlocker,
            technicalNotes: row.technicalNotes,
            scopeEstimate: row.scopeEstimate,
            currentAction: row.currentAction,
            nextAction: row.nextAction,
            stakeholders: row.stakeholders,
            customFields: row.customFields === null ? Prisma.JsonNull : (row.customFields as Prisma.InputJsonValue),
            importedFrom: options.source,
          },
          select: { id: true },
        });
        // The export's current and next action become the first entries of the project's update feed (no author).
        const feed = [
          { kind: "CURRENT" as const, body: row.currentAction },
          { kind: "NEXT" as const, body: row.nextAction },
        ].filter((entry): entry is { kind: "CURRENT" | "NEXT"; body: string } => entry.body !== null);
        if (feed.length > 0) await tx.projectAction.createMany({ data: feed.map((entry) => ({ projectId: project.id, ...entry })) });
        await tx.auditEvent.create({
          data: {
            action: "project.imported",
            entityType: "project",
            entityId: project.id,
            before: Prisma.JsonNull,
            after: { code: row.code, source: options.source },
          },
        });
      }

      // New projects created in the application continue after the highest imported code.
      const highest = Math.max(0, ...rows.map((r) => codeNumber(r.code)));
      await tx.$executeRaw`
        INSERT INTO code_counters (scope, last_value) VALUES (${COUNTER_SCOPE}, ${highest})
        ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value)`;

      await tx.auditEvent.create({
        data: {
          action: "import.projects",
          entityType: "import",
          entityId: options.source,
          before: Prisma.JsonNull,
          after: {
            projectsCreated: summary.projectsToCreate.length,
            projectsSkipped: summary.projectsExisting.length,
            usersCreated: summary.usersToCreate.length,
          },
        },
      });
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
  return summary;
}
