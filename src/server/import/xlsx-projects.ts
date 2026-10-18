import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { checkImportRow, checkMapping, projectIdentity, rowToRaw, type ColumnMapping, type ImportRow } from "@/domain/projects/import";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { PROGRESS_LABELS, TRACK_STATUS_LABELS } from "@/domain/projects/progress";
import { SOURCE_LABELS } from "@/domain/projects/source";
import { nextProjectCode } from "@/server/requests/codes";
import { ensureCustomer } from "@/server/requests/master-data";
import { readXlsx, type SheetRows } from "./xlsx-reader";

type Actor = { id: string; role: Role };
type Db = PrismaClient | Prisma.TransactionClient;

const TRANSACTION_TIMEOUT_MS = 120_000;
const COUNTER_SCOPE = "PRJ-";
/** Rows with a problem shown in a result; the counts always cover every row. */
const DETAIL_LIMIT = 300;
const SAMPLE_READY = 15;
const FILE_NAME_MAX = 200;

export type ImportRowStatus = "ready" | "duplicate" | "error";

export type ImportRowReport = {
  /** The row number in the sheet, as Excel shows it. */
  sheetRow: number;
  status: ImportRowStatus;
  endUser: string;
  name: string;
  /** For a duplicate: what it duplicates. For an error: every problem of the row. */
  messages: string[];
};

export type ImportSummary = {
  sheetName: string;
  totalRows: number;
  ready: number;
  duplicates: number;
  errors: number;
  /** Errors and duplicates (up to a limit), then a few ready rows so the person can see what will be created. */
  rows: ImportRowReport[];
  detailTruncated: boolean;
  /** Master data the import would add: names that are not records yet. */
  newPrincipals: string[];
  newSolutions: string[];
};

export type PreviewResult = { ok: true; summary: ImportSummary } | { ok: false; code: "FORBIDDEN" | "INVALID_FILE" | "INVALID_MAPPING"; message: string };

export type CommitMode = "atomic" | "skip-invalid";

export type CommitResult =
  | { ok: true; summary: ImportSummary; created: number; codes: string[]; skippedDuplicates: number; skippedInvalid: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_FILE" | "INVALID_MAPPING" | "HAS_ERRORS" | "NOTHING_TO_IMPORT" | "FAILED"; message: string; summary?: ImportSummary };

type PreparedRow = { sheetRow: number; row: ImportRow; ownerId: string | null; ownerLabel: string | null };

type Prepared = {
  sheet: SheetRows;
  ready: PreparedRow[];
  reports: ImportRowReport[];
  counts: { ready: number; duplicates: number; errors: number };
  newPrincipals: string[];
  newSolutions: string[];
};

/** Reads the file and the mapping and checks every row against the data: owners, duplicates, master data. Writes nothing. */
async function prepare(db: Db, actor: { role: Role }, bytes: Uint8Array, mappingInput: unknown): Promise<{ ok: true; prepared: Prepared } | { ok: false; code: "INVALID_FILE" | "INVALID_MAPPING"; message: string }> {
  const read = readXlsx(bytes);
  if (!read.ok) return { ok: false, code: "INVALID_FILE", message: read.message };
  const checked = checkMapping(mappingInput, read.sheet.headers.length);
  if (!checked.ok) return { ok: false, code: "INVALID_MAPPING", message: checked.message };
  const mapping: ColumnMapping = checked.mapping;

  const [salespeople, projects, principals, solutions] = await Promise.all([
    db.user.findMany({ where: { role: "SALES", isActive: true }, select: { id: true, name: true, email: true } }),
    db.project.findMany({ select: { code: true, endUserCompany: true, name: true, deletedAt: true } }),
    db.principal.findMany({ select: { nameKey: true } }),
    db.solutionCategory.findMany({ select: { nameKey: true } }),
  ]);
  const byEmail = new Map(salespeople.map((person) => [person.email.toLowerCase(), person]));
  const byName = new Map<string, typeof salespeople>();
  for (const person of salespeople) byName.set(nameKey(person.name), [...(byName.get(nameKey(person.name)) ?? []), person]);
  const existingCodes = new Map(projects.map((project) => [project.code, project]));
  const existingIdentities = new Map(projects.filter((project) => !project.deletedAt).map((project) => [projectIdentity(project.endUserCompany, project.name), project.code]));
  const knownPrincipals = new Set(principals.map((principal) => principal.nameKey));
  const knownSolutions = new Set(solutions.map((solution) => solution.nameKey));
  const mayCreateMaster = can(actor.role, "masterdata.manage");

  const ready: PreparedRow[] = [];
  const reports: ImportRowReport[] = [];
  const seenCodes = new Map<string, number>();
  const seenIdentities = new Map<string, number>();
  const newPrincipals = new Map<string, string>();
  const newSolutions = new Map<string, string>();
  const counts = { ready: 0, duplicates: 0, errors: 0 };

  read.sheet.rows.forEach((cells, index) => {
    const sheetRow = read.sheet.rowNumbers[index]!;
    const raw = rowToRaw(cells, mapping);
    const label = { endUser: cleanName(raw.endUser), name: cleanName(raw.name) };
    const result = checkImportRow(raw);
    if (!result.ok) {
      counts.errors += 1;
      reports.push({ sheetRow, status: "error", ...label, messages: result.errors });
      return;
    }
    const row = result.value;
    const problems: string[] = [];

    // The salesperson: an email, or a name that belongs to exactly one active Sales account.
    let ownerId: string | null = null;
    let ownerLabel: string | null = null;
    if (row.sourceType === "INTERNAL_SALES" && row.salesPic) {
      const byMail = byEmail.get(row.salesPic.toLowerCase());
      const named = byName.get(nameKey(row.salesPic)) ?? [];
      if (byMail) {
        ownerId = byMail.id;
        ownerLabel = byMail.name;
      } else if (named.length === 1) {
        ownerId = named[0]!.id;
        ownerLabel = named[0]!.name;
      } else if (named.length > 1) problems.push(`Sales PIC "${row.salesPic}" matches ${named.length} accounts. Write the email address instead.`);
      else problems.push(`Sales PIC "${row.salesPic}" is not an active Sales account.`);
    }

    // Master data: a name that is not a record yet is created only by someone allowed to manage master data.
    const addedPrincipals = row.principals.filter((name) => !knownPrincipals.has(nameKey(name)));
    const addedSolution = row.solution && !knownSolutions.has(nameKey(row.solution)) ? row.solution : null;
    if (!mayCreateMaster) {
      for (const name of addedPrincipals) problems.push(`Principal "${name}" does not exist, and you may not create master data. Ask SOA or an administrator to add it first.`);
      if (addedSolution) problems.push(`Solution "${addedSolution}" does not exist, and you may not create master data.`);
    }

    if (problems.length > 0) {
      counts.errors += 1;
      reports.push({ sheetRow, status: "error", ...label, messages: problems });
      return;
    }

    // Duplicates: the same Project ID or the same end user and project name, in the data or earlier in this file. Never an update.
    const identity = projectIdentity(row.endUser, row.name);
    let duplicate: string | null = null;
    if (row.code && existingCodes.has(row.code)) duplicate = `Project ID ${row.code} already exists (${existingCodes.get(row.code)!.name}).`;
    else if (row.code && seenCodes.has(row.code)) duplicate = `Project ID ${row.code} is already used in row ${seenCodes.get(row.code)} of this file.`;
    else if (existingIdentities.has(identity)) duplicate = `The same end user and project name already exist as ${existingIdentities.get(identity)}.`;
    else if (seenIdentities.has(identity)) duplicate = `The same end user and project name are in row ${seenIdentities.get(identity)} of this file.`;
    if (duplicate) {
      counts.duplicates += 1;
      reports.push({ sheetRow, status: "duplicate", ...label, messages: [duplicate] });
      return;
    }

    if (row.code) seenCodes.set(row.code, sheetRow);
    seenIdentities.set(identity, sheetRow);
    for (const name of addedPrincipals) newPrincipals.set(nameKey(name), name);
    if (addedSolution) newSolutions.set(nameKey(addedSolution), addedSolution);
    counts.ready += 1;
    ready.push({ sheetRow, row, ownerId, ownerLabel });
    reports.push({ sheetRow, status: "ready", ...label, messages: [] });
  });

  return { ok: true, prepared: { sheet: read.sheet, ready, reports, counts, newPrincipals: [...newPrincipals.values()], newSolutions: [...newSolutions.values()] } };
}

function summarise(prepared: Prepared): ImportSummary {
  const problems = prepared.reports.filter((report) => report.status !== "ready");
  const sample = prepared.reports.filter((report) => report.status === "ready").slice(0, SAMPLE_READY);
  return {
    sheetName: prepared.sheet.sheetName,
    totalRows: prepared.sheet.rows.length,
    ...prepared.counts,
    rows: [...problems.slice(0, DETAIL_LIMIT), ...sample],
    detailTruncated: problems.length > DETAIL_LIMIT,
    newPrincipals: prepared.newPrincipals,
    newSolutions: prepared.newSolutions,
  };
}

const FORBIDDEN = "You are not allowed to import projects.";

/** Checks a sheet and reports what an import would do: which rows are ready, which are duplicates, which have problems. Writes nothing. */
export async function previewProjectImport(db: PrismaClient, claimedActor: Actor, input: { bytes: Uint8Array; mapping: unknown }): Promise<PreviewResult> {
  if (!can(claimedActor.role, "projects.import")) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const actor = await db.user.findUnique({ where: { id: claimedActor.id }, select: { role: true, isActive: true } });
  if (!actor?.isActive || !can(actor.role, "projects.import")) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const prepared = await prepare(db, actor, input.bytes, input.mapping);
  if (!prepared.ok) return prepared;
  return { ok: true, summary: summarise(prepared.prepared) };
}

class Abort extends Error {
  constructor(readonly result: CommitResult) {
    super("import aborted");
  }
}

/**
 * Imports the rows that are ready, in one transaction: either all of them are created or, if anything goes wrong, none. The sheet is
 * read and checked again inside the transaction (the preview is only a preview). Duplicates are always skipped and never updated.
 * `atomic` refuses to import anything while any row has a problem; `skip-invalid` imports the ready rows and reports the others.
 */
export async function commitProjectImport(
  db: PrismaClient,
  claimedActor: Actor,
  input: { bytes: Uint8Array; mapping: unknown; fileName: string; mode: CommitMode; /** Tests only: called after each row is written, inside the transaction; throwing must undo everything. */ afterRow?: (index: number) => void | Promise<void> },
): Promise<CommitResult> {
  if (!can(claimedActor.role, "projects.import")) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const fileName = cleanName(input.fileName).slice(0, FILE_NAME_MAX) || "import.xlsx";

  try {
    return await db.$transaction(
      async (tx): Promise<CommitResult> => {
        const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
        if (!actor?.isActive || !can(actor.role, "projects.import")) throw new Abort({ ok: false, code: "FORBIDDEN", message: FORBIDDEN });
        // One import at a time, and no project written by anyone else between the check and the insert.
        await tx.$executeRaw`LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE`;

        const result = await prepare(tx, actor, input.bytes, input.mapping);
        if (!result.ok) throw new Abort(result);
        const { prepared } = result;
        const summary = summarise(prepared);
        if (input.mode === "atomic" && prepared.counts.errors > 0) {
          throw new Abort({ ok: false, code: "HAS_ERRORS", message: `${prepared.counts.errors} row${prepared.counts.errors === 1 ? " has" : "s have"} problems, so nothing was imported. Fix them in the sheet, or import only the valid rows.`, summary });
        }
        if (prepared.ready.length === 0) throw new Abort({ ok: false, code: "NOTHING_TO_IMPORT", message: "There is no new project to import in this sheet.", summary });

        // Explicit Project IDs first: the counter moves past them, so the numbers given to the other rows can never collide.
        const explicit = prepared.ready.map((entry) => entry.row.code).filter((code): code is string => code !== null).map((code) => Number(code.slice(4)));
        if (explicit.length > 0) {
          const highest = Math.max(...explicit);
          await tx.$executeRaw`
            INSERT INTO code_counters (scope, last_value) VALUES (${COUNTER_SCOPE}, ${highest})
            ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value)`;
        }

        const principalIds = new Map<string, string>();
        const solutionIds = new Map<string, string>();
        const findOrCreate = async (kind: "principal" | "solution", name: string): Promise<string> => {
          const key = nameKey(name);
          const cache = kind === "principal" ? principalIds : solutionIds;
          const cached = cache.get(key);
          if (cached) return cached;
          const existing = kind === "principal" ? await tx.principal.findUnique({ where: { nameKey: key }, select: { id: true } }) : await tx.solutionCategory.findUnique({ where: { nameKey: key }, select: { id: true } });
          let id = existing?.id;
          if (!id) {
            if (!can(actor.role, "masterdata.manage")) throw new Error(`${kind} ${name} cannot be created by this account`);
            const data = { name: cleanName(name), nameKey: key };
            const created = kind === "principal" ? await tx.principal.create({ data, select: { id: true } }) : await tx.solutionCategory.create({ data, select: { id: true } });
            id = created.id;
            await tx.auditEvent.create({ data: { actorId: actor.id, action: `${kind}.created`, entityType: kind, entityId: id, after: { name: cleanName(name), via: "import" } } });
          }
          cache.set(key, id);
          return id;
        };

        const codes: string[] = [];
        for (const [position, { row, ownerId }] of prepared.ready.entries()) {
          const code = row.code ?? (await nextProjectCode(tx));
          const customerId = await ensureCustomer(tx, row.endUser);
          const ids = [];
          for (const name of row.principals) ids.push(await findOrCreate("principal", name));
          const solutionCategoryId = row.solution ? await findOrCreate("solution", row.solution) : null;
          const project = await tx.project.create({
            data: {
              code,
              endUserCompany: row.endUser,
              name: row.name,
              description: row.description,
              sourceType: row.sourceType,
              salesOwnerId: row.sourceType === "INTERNAL_SALES" ? ownerId : null,
              externalSourceName: row.sourceType === "OTHER" ? row.externalSourceName : null,
              progress: row.progress,
              trackStatus: row.trackStatus,
              estimatedValue: row.estimatedValue,
              targetMargin: row.targetMarginPercent,
              targetMarginValue: row.targetMarginAmount,
              quoteReleasedAt: row.quoteReleasedAt ? new Date(`${row.quoteReleasedAt}T00:00:00Z`) : null,
              targetDate: row.targetDate ? new Date(`${row.targetDate}T00:00:00Z`) : null,
              customerId,
              principalId: ids[0] ?? null,
              solutionCategoryId,
              industry: row.industry,
              location: row.location,
              currentAction: row.currentAction,
              nextAction: row.nextAction,
              importedFrom: fileName,
            },
            select: { id: true },
          });
          if (ids.length > 0) await tx.projectPrincipal.createMany({ data: ids.map((principalId, position) => ({ projectId: project.id, principalId, position })) });
          const feed = [
            { kind: "CURRENT" as const, body: row.currentAction },
            { kind: "NEXT" as const, body: row.nextAction },
          ].filter((entry): entry is { kind: "CURRENT" | "NEXT"; body: string } => entry.body !== null);
          if (feed.length > 0) await tx.projectAction.createMany({ data: feed.map((entry) => ({ projectId: project.id, authorId: actor.id, ...entry })) });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "project.imported",
              entityType: "project",
              entityId: project.id,
              after: {
                code,
                file: fileName,
                sourceType: row.sourceType,
                progress: PROGRESS_LABELS[row.progress],
                status: TRACK_STATUS_LABELS[row.trackStatus],
                source: SOURCE_LABELS[row.sourceType],
              },
            },
          });
          codes.push(code);
          await input.afterRow?.(position);
        }

        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "import.projects",
            entityType: "import",
            entityId: fileName,
            after: { created: codes.length, duplicatesSkipped: prepared.counts.duplicates, invalidSkipped: prepared.counts.errors, mode: input.mode, sheet: prepared.sheet.sheetName },
          },
        });
        return { ok: true, summary, created: codes.length, codes, skippedDuplicates: prepared.counts.duplicates, skippedInvalid: prepared.counts.errors };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (error instanceof Abort) return error.result;
    // A database error on any row (for example a Project ID taken a moment ago) undoes the whole import.
    const taken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return { ok: false, code: "FAILED", message: taken ? "A Project ID in the sheet was taken while importing, so nothing was imported. Try again." : "The import failed, so nothing was imported. Nothing in the data changed." };
  }
}
