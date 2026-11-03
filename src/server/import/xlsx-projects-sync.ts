import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { checkMapping, rowToRaw, type RawImportRow } from "@/domain/projects/import";
import { cleanName } from "@/domain/projects/pipeline";
import { notify } from "@/server/notifications/service";
import { setActor } from "@/server/projects/actor-context";
import { readXlsx } from "./xlsx-reader";
import { prepareNew, writeNewProjects, type Prepared as NewPrepared } from "./xlsx-projects";
import { prepareUpdate, writeUpdates, type Prepared as UpdatePrepared, type UpdateChange } from "./xlsx-projects-update";

/**
 * One upload that adds and updates projects. Each row is told apart by its Project ID: an ID that exists is an update of that project, an
 * empty ID is a new project. An ID that does not exist is skipped, never created (a typo must not add a project). The rules of each kind
 * are the ones of the new-project import and of the update, which this only runs side by side on their own rows; everything is written in
 * one transaction.
 */

type Actor = { id: string; role: Role };
type Db = PrismaClient | Prisma.TransactionClient;

const IMPORT = "projects.import";
const UPDATE = "projects.bulk-update";
const FORBIDDEN = "Anda tidak diizinkan menambah atau memperbarui proyek lewat berkas.";
const TRANSACTION_TIMEOUT_MS = 120_000;
const DETAIL_LIMIT = 300;
const FILE_NAME_MAX = 200;
const NOTIFY_CODES = 8;

export type SyncRowStatus = "new" | "update" | "unchanged" | "skipped" | "duplicate" | "error";

export type SyncRowReport = {
  /** The row number in the sheet, as Excel shows it. */
  sheetRow: number;
  status: SyncRowStatus;
  /** The Project ID in the sheet: empty for a new project (its number is given when it is written). */
  code: string;
  endUser: string;
  name: string;
  /** For an update: what changes, from and to. */
  changes: UpdateChange[];
  /** For a problem or a skipped row: why. */
  messages: string[];
};

export type SyncSummary = {
  sheetName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  duplicates: number;
  errors: number;
  /** Problem rows first, then the new and the updated ones (each up to a limit); unchanged rows are only counted. */
  rows: SyncRowReport[];
  detailTruncated: boolean;
  /** Names that are not records yet and would be created. */
  newCustomers: string[];
  newPrincipals: string[];
  newSolutions: string[];
};

export type SyncPreviewResult = { ok: true; summary: SyncSummary } | { ok: false; code: "FORBIDDEN" | "INVALID_FILE" | "INVALID_MAPPING"; message: string };

/** `atomic`: nothing is written while any row has a problem. `skip-invalid`: the rows that are fine are written and the others reported. */
export type SyncMode = "atomic" | "skip-invalid";

export type SyncCommitResult =
  | {
      ok: true;
      summary: SyncSummary;
      created: { code: string; endUser: string; name: string }[];
      updated: { code: string; endUser: string; name: string; changes: UpdateChange[] }[];
      unchanged: number;
      skipped: number;
      duplicates: number;
      skippedInvalid: number;
    }
  | { ok: false; code: "FORBIDDEN" | "INVALID_FILE" | "INVALID_MAPPING" | "HAS_ERRORS" | "NOTHING_TO_DO" | "NEEDS_CONFIRMATION" | "FAILED"; message: string; summary?: SyncSummary };

type Plan = {
  sheetName: string;
  totalRows: number;
  fresh: NewPrepared | null;
  changed: UpdatePrepared | null;
  reports: SyncRowReport[];
  counts: { created: number; updated: number; unchanged: number; skipped: number; duplicates: number; errors: number };
  newCustomers: string[];
  newPrincipals: string[];
  newSolutions: string[];
};

const NOT_FOUND = (code: string) => `Project ID ${code} tidak ditemukan, jadi baris ini dilewati. Periksa penulisannya, atau kosongkan Project ID agar baris ini menjadi project baru.`;

/** Reads the file and plans every row: which are new, which update a project, which are skipped or have problems. Writes nothing. */
async function plan(db: Db, actor: Actor, bytes: Uint8Array, mappingInput: unknown): Promise<{ ok: true; plan: Plan } | { ok: false; code: "INVALID_FILE" | "INVALID_MAPPING"; message: string }> {
  const read = readXlsx(bytes);
  if (!read.ok) return { ok: false, code: "INVALID_FILE", message: read.message };
  const checked = checkMapping(mappingInput, read.sheet.headers.length);
  if (!checked.ok) return { ok: false, code: "INVALID_MAPPING", message: checked.message };
  const mapping = checked.mapping;

  const mayAdd = can(actor.role, IMPORT);
  const mayUpdate = can(actor.role, UPDATE);
  // Without a Project ID column every row is new.
  const isUpdateRow = (raw: RawImportRow) => mapping.code !== null && raw.code.trim() !== "";

  const reports: SyncRowReport[] = [];
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0, duplicates: 0, errors: 0 };

  // A row of a kind this account may not do is a problem of that row; the rest of the file is still checked.
  read.sheet.rows.forEach((cells, index) => {
    const raw = rowToRaw(cells, mapping);
    const update = isUpdateRow(raw);
    if (update ? mayUpdate : mayAdd) return;
    counts.errors += 1;
    reports.push({
      sheetRow: read.sheet.rowNumbers[index]!,
      status: "error",
      code: raw.code.trim().toUpperCase(),
      endUser: cleanName(raw.endUser),
      name: cleanName(raw.name),
      changes: [],
      messages: [update ? "Anda tidak boleh memperbarui project lewat berkas." : "Anda tidak boleh menambah project baru lewat berkas. Isi Project ID project yang sudah ada."],
    });
  });

  let fresh: NewPrepared | null = null;
  if (mayAdd) {
    const result = await prepareNew(db, actor, bytes, mappingInput, (raw) => !isUpdateRow(raw));
    if (!result.ok) return result;
    fresh = result.prepared;
    counts.created = fresh.counts.ready;
    counts.duplicates = fresh.counts.duplicates;
    counts.errors += fresh.counts.errors;
    for (const report of fresh.reports) {
      reports.push({ sheetRow: report.sheetRow, status: report.status === "ready" ? "new" : report.status, code: "", endUser: report.endUser, name: report.name, changes: [], messages: report.messages });
    }
  }

  let changed: UpdatePrepared | null = null;
  if (mayUpdate && mapping.code !== null) {
    const result = await prepareUpdate(db, actor, bytes, mappingInput, isUpdateRow);
    if (!result.ok) return result;
    changed = result.prepared;
    counts.updated = changed.counts.toUpdate;
    counts.unchanged = changed.counts.unchanged;
    counts.skipped = changed.counts.skipped;
    counts.errors += changed.counts.errors;
    for (const report of changed.reports) {
      // The only row the update skips here is one whose Project ID does not exist.
      const messages = report.status === "skipped" ? [NOT_FOUND(report.code)] : report.messages;
      reports.push({ sheetRow: report.sheetRow, status: report.status, code: report.code, endUser: report.endUser, name: report.name, changes: report.changes, messages });
    }
  }

  reports.sort((a, b) => a.sheetRow - b.sheetRow);
  const union = (...lists: (string[] | undefined)[]) => [...new Set(lists.flatMap((list) => list ?? []))];
  return {
    ok: true,
    plan: {
      sheetName: read.sheet.sheetName,
      totalRows: read.sheet.rows.length,
      fresh,
      changed,
      reports,
      counts,
      newCustomers: changed?.newCustomers ?? [],
      newPrincipals: union(fresh?.newPrincipals, changed?.newPrincipals),
      newSolutions: union(fresh?.newSolutions, changed?.newSolutions),
    },
  };
}

function summarise(plan: Plan): SyncSummary {
  const attention = plan.reports.filter((report) => report.status === "error" || report.status === "skipped" || report.status === "duplicate");
  const created = plan.reports.filter((report) => report.status === "new");
  const updated = plan.reports.filter((report) => report.status === "update");
  return {
    sheetName: plan.sheetName,
    totalRows: plan.totalRows,
    ...plan.counts,
    rows: [...attention.slice(0, DETAIL_LIMIT), ...created.slice(0, DETAIL_LIMIT), ...updated.slice(0, DETAIL_LIMIT)],
    detailTruncated: attention.length > DETAIL_LIMIT || created.length > DETAIL_LIMIT || updated.length > DETAIL_LIMIT,
    newCustomers: plan.newCustomers,
    newPrincipals: plan.newPrincipals,
    newSolutions: plan.newSolutions,
  };
}

async function allowed(db: Db, claimed: Actor) {
  if (!can(claimed.role, IMPORT) && !can(claimed.role, UPDATE)) return null;
  const actor = await db.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && (can(actor.role, IMPORT) || can(actor.role, UPDATE)) ? actor : null;
}

/** Checks a sheet and reports what the upload would do, row by row. Writes nothing. */
export async function previewProjectSync(db: PrismaClient, claimedActor: Actor, input: { bytes: Uint8Array; mapping: unknown }): Promise<SyncPreviewResult> {
  const actor = await allowed(db, claimedActor);
  if (!actor) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const result = await plan(db, actor, input.bytes, input.mapping);
  if (!result.ok) return result;
  return { ok: true, summary: summarise(result.plan) };
}

class Abort extends Error {
  constructor(readonly result: SyncCommitResult) {
    super("sync aborted");
  }
}

/**
 * Writes the upload in one transaction: the new projects, then the updates. The sheet is read and planned again inside the transaction (the
 * preview is only a preview). Names that would be created (customer, principal, solution) need `confirmNew`, so a typo cannot add one
 * unnoticed. Each Sales owner gets one notification that lists their projects that were added or changed.
 */
export async function commitProjectSync(
  db: PrismaClient,
  claimedActor: Actor,
  input: { bytes: Uint8Array; mapping: unknown; fileName: string; mode: SyncMode; confirmNew: boolean; /** Tests only: called after each new project is written, inside the transaction; throwing must undo everything. */ afterRow?: (index: number) => void | Promise<void> },
): Promise<SyncCommitResult> {
  if (!can(claimedActor.role, IMPORT) && !can(claimedActor.role, UPDATE)) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const fileName = cleanName(input.fileName).slice(0, FILE_NAME_MAX) || "projects.xlsx";

  try {
    return await db.$transaction(
      async (tx): Promise<SyncCommitResult> => {
        const actor = await allowed(tx, claimedActor);
        if (!actor) throw new Abort({ ok: false, code: "FORBIDDEN", message: FORBIDDEN });
        await setActor(tx, actor.id);
        // One import at a time, and no project written by anyone else between the check and the write.
        await tx.$executeRaw`LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE`;

        const result = await plan(tx, actor, input.bytes, input.mapping);
        if (!result.ok) throw new Abort(result);
        const { plan: planned } = result;
        const summary = summarise(planned);
        if (input.mode === "atomic" && planned.counts.errors > 0) {
          throw new Abort({ ok: false, code: "HAS_ERRORS", message: `${planned.counts.errors} baris bermasalah, jadi tidak ada yang disimpan. Perbaiki di sheet, atau simpan hanya baris yang valid.`, summary });
        }
        const toAdd = planned.fresh?.ready ?? [];
        const toChange = planned.changed?.planned ?? [];
        if (toAdd.length + toChange.length === 0) throw new Abort({ ok: false, code: "NOTHING_TO_DO", message: "Tidak ada project baru atau perubahan untuk disimpan dari sheet ini.", summary });
        const added = [...planned.newCustomers, ...planned.newPrincipals, ...planned.newSolutions];
        if (added.length > 0 && !input.confirmNew) {
          throw new Abort({ ok: false, code: "NEEDS_CONFIRMATION", message: `Nama berikut belum ada dan akan dibuat: ${added.join(", ")}. Periksa penulisannya, lalu konfirmasi.`, summary });
        }

        const newCodes = planned.fresh ? await writeNewProjects(tx, actor, planned.fresh, fileName, input.afterRow) : [];
        const updatedCodes = planned.changed ? await writeUpdates(tx, actor, planned.changed, fileName) : [];

        // One notification per Sales owner: what was added for them and what was changed on their projects.
        const perOwner = new Map<string, { created: string[]; updated: string[] }>();
        const entry = (ownerId: string) => perOwner.get(ownerId) ?? perOwner.set(ownerId, { created: [], updated: [] }).get(ownerId)!;
        toAdd.forEach(({ ownerId }, index) => ownerId && entry(ownerId).created.push(newCodes[index]!));
        toChange.forEach((change, index) => {
          const ownerId = change.applied.salesOwner?.id ?? change.oldSalesOwnerId;
          if (ownerId) entry(ownerId).updated.push(updatedCodes[index]!);
        });
        for (const [ownerId, codes] of perOwner) {
          const list = (label: string, items: string[]) => (items.length > 0 ? `${label}: ${items.slice(0, NOTIFY_CODES).join(", ")}${items.length > NOTIFY_CODES ? ` dan ${items.length - NOTIFY_CODES} lainnya` : ""}` : null);
          await notify(tx, {
            actorId: actor.id,
            recipientIds: [ownerId],
            kind: "project.imported",
            title: `Import project: ${codes.created.length} baru, ${codes.updated.length} diperbarui`,
            body: [list("Baru", codes.created), list("Diperbarui", codes.updated)].filter(Boolean).join(". "),
            href: "/projects",
          });
        }

        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "import.projects_sync",
            entityType: "import",
            entityId: fileName,
            after: { created: newCodes.length, updated: updatedCodes.length, unchanged: planned.counts.unchanged, skipped: planned.counts.skipped, duplicates: planned.counts.duplicates, invalidSkipped: planned.counts.errors, mode: input.mode, sheet: planned.sheetName },
          },
        });

        return {
          ok: true,
          summary,
          created: toAdd.map(({ row }, index) => ({ code: newCodes[index]!, endUser: row.endUser, name: row.name })),
          updated: toChange.map((change, index) => ({ code: updatedCodes[index]!, endUser: change.report.endUser, name: change.report.name, changes: change.report.changes })),
          unchanged: planned.counts.unchanged,
          skipped: planned.counts.skipped,
          duplicates: planned.counts.duplicates,
          skippedInvalid: planned.counts.errors,
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (error instanceof Abort) return error.result;
    // A database error on any row (for example a Project ID taken a moment ago) undoes everything.
    const taken = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return { ok: false, code: "FAILED", message: taken ? "Ada Project ID yang terpakai saat menyimpan, jadi tidak ada yang disimpan. Coba lagi." : "Penyimpanan gagal, jadi tidak ada yang disimpan. Tidak ada data yang berubah." };
  }
}
