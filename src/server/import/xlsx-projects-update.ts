import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { COMMERCIAL_FIELDS, type CommercialChange } from "@/domain/projects/commercial";
import { fieldLabel } from "@/domain/projects/fields";
import { effectiveIndustry } from "@/domain/customers/industry";
import { checkImportRow, checkMapping, rowToRaw, type ColumnMapping, type ImportRow, type RawImportRow } from "@/domain/projects/import";
import { importScope } from "@/domain/projects/import-scope";
import { principalNamesOf } from "@/domain/projects/master-data";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { salesActsOn, SOURCE_LABELS } from "@/domain/projects/source";
import { notify } from "@/server/notifications/service";
import { setActor } from "@/server/projects/actor-context";
import { planCommercialChanges, writeCommercialChanges, type CommercialSubmission } from "@/server/projects/commercial-plan";
import { ensureCustomer, ensurePrincipal, ensureSolutionCategory } from "@/server/requests/master-data";
import { readXlsx } from "./xlsx-reader";

/**
 * Updating existing projects from a sheet (the export in the import format, edited). Rows are matched by Project ID. A cell that is
 * empty changes nothing; a filled cell that differs from the project is a change. Project ID, project source, external sales name and
 * the Current/Next action feeds are never changed here. The whole file is applied or none of it, and a project changed since the
 * export (its Last updated differs) is refused.
 */

type Actor = { id: string; role: Role };
type Db = PrismaClient | Prisma.TransactionClient;

const PERMISSION = "projects.bulk-update";
const FORBIDDEN = "Anda tidak diizinkan memperbarui proyek secara massal.";
const TRANSACTION_TIMEOUT_MS = 120_000;
const DETAIL_LIMIT = 300;
const FILE_NAME_MAX = 200;

export type UpdateRowStatus = "update" | "unchanged" | "skipped" | "error";
export type UpdateChange = { label: string; from: string | null; to: string | null };
export type UpdateRowReport = { sheetRow: number; status: UpdateRowStatus; code: string; endUser: string; name: string; changes: UpdateChange[]; messages: string[] };

export type UpdateSummary = {
  sheetName: string;
  totalRows: number;
  toUpdate: number;
  unchanged: number;
  skipped: number;
  errors: number;
  /** Errors and skipped rows first, then every project to update (up to a limit). */
  rows: UpdateRowReport[];
  detailTruncated: boolean;
  /** Names that are not records yet: saving would create them, so the person has to confirm. */
  newCustomers: string[];
  newPrincipals: string[];
  newSolutions: string[];
};

export type UpdatePreviewResult = { ok: true; summary: UpdateSummary } | { ok: false; code: "FORBIDDEN" | "INVALID_FILE" | "INVALID_MAPPING"; message: string };

export type UpdateCommitResult =
  | { ok: true; summary: UpdateSummary; updated: number; unchanged: number; skipped: number; codes: string[] }
  | { ok: false; code: "FORBIDDEN" | "INVALID_FILE" | "INVALID_MAPPING" | "HAS_ERRORS" | "NEEDS_CONFIRMATION" | "NOTHING_TO_UPDATE" | "FAILED"; message: string; summary?: UpdateSummary };

type Applied = {
  endUser?: { name: string };
  name?: string;
  description?: string;
  salesOwner?: { id: string; label: string };
  principals?: string[];
  solution?: string;
  technicalPic?: { id: string; name: string };
  /** The customer's industry (the list's spelling), or the project's own when it has no customer. */
  industry?: { customerId: string | null; name: string };
  location?: string;
};

type Planned = {
  report: UpdateRowReport;
  projectId: string;
  submitted: CommercialSubmission;
  commercialChanges: CommercialChange[];
  applied: Applied;
  oldSalesOwnerId: string | null;
};

type Prepared = {
  fileRows: number;
  sheetName: string;
  reports: UpdateRowReport[];
  planned: Planned[];
  counts: { toUpdate: number; unchanged: number; skipped: number; errors: number };
  newCustomers: string[];
  newPrincipals: string[];
  newSolutions: string[];
};

const text = (value: string | null | undefined) => (value ?? "").trim();

/** Reads the file and plans every row against the stored projects. Writes nothing. */
async function prepare(db: Db, actor: { id: string; role: Role }, bytes: Uint8Array, mappingInput: unknown): Promise<{ ok: true; prepared: Prepared } | { ok: false; code: "INVALID_FILE" | "INVALID_MAPPING"; message: string }> {
  const read = readXlsx(bytes);
  if (!read.ok) return { ok: false, code: "INVALID_FILE", message: read.message };
  const checked = checkMapping(mappingInput, read.sheet.headers.length);
  if (!checked.ok) return { ok: false, code: "INVALID_MAPPING", message: checked.message };
  const mapping: ColumnMapping = checked.mapping;
  if (mapping.code === null) return { ok: false, code: "INVALID_MAPPING", message: "Pilih kolom Project ID: update mencocokkan baris dengan Project ID." };

  const raws = read.sheet.rows.map((cells) => rowToRaw(cells, mapping));
  const codes = [...new Set(raws.map((raw) => raw.code.trim().toUpperCase()).filter((code) => code !== ""))];
  const [projects, salespeople, customers, principals, solutions, industries, soaPics] = await Promise.all([
    db.project.findMany({
      where: { code: { in: codes }, deletedAt: null },
      include: {
        salesOwner: { select: { id: true, name: true, email: true } },
        principal: { select: { name: true } },
        principals: { orderBy: { position: "asc" }, select: { principal: { select: { name: true } } } },
        solutionCategory: { select: { name: true } },
        customer: { select: { id: true, industry: true } },
        soaPic: { select: { name: true } },
      },
    }),
    db.user.findMany({ where: { role: "SALES", isActive: true }, select: { id: true, name: true, email: true } }),
    db.customer.findMany({ select: { nameKey: true } }),
    db.principal.findMany({ select: { nameKey: true } }),
    db.solutionCategory.findMany({ select: { nameKey: true } }),
    db.industry.findMany({ select: { name: true, nameKey: true } }),
    db.pic.findMany({ where: { team: "SOA", isActive: true }, select: { id: true, name: true, nameKey: true } }),
  ]);
  const byCode = new Map(projects.map((project) => [project.code, project]));
  const byEmail = new Map(salespeople.map((person) => [person.email.toLowerCase(), person]));
  const byName = new Map<string, typeof salespeople>();
  for (const person of salespeople) byName.set(nameKey(person.name), [...(byName.get(nameKey(person.name)) ?? []), person]);
  const knownCustomers = new Set(customers.map((row) => row.nameKey));
  const knownPrincipals = new Set(principals.map((row) => row.nameKey));
  const knownSolutions = new Set(solutions.map((row) => row.nameKey));
  const mayCreateMaster = can(actor.role, "masterdata.manage");
  const scope = importScope(actor.role);
  // A salesperson updates the projects they act on; a role that may also edit the source (SOA, Admin) updates any.
  const ownOnly = scope.commercial && !scope.owner;
  const soaPicByName = new Map(soaPics.map((pic) => [pic.nameKey, pic]));
  const listedIndustries = new Map(industries.map((industry) => [industry.nameKey, industry.name]));
  // One customer takes one industry per file: its rows must agree.
  const industryOfCustomer = new Map<string, string>();

  const reports: UpdateRowReport[] = [];
  const planned: Planned[] = [];
  const counts = { toUpdate: 0, unchanged: 0, skipped: 0, errors: 0 };
  const seenCodes = new Map<string, number>();
  const newCustomers = new Map<string, string>();
  const newPrincipals = new Map<string, string>();
  const newSolutions = new Map<string, string>();

  read.sheet.rows.forEach((_, index) => {
    const sheetRow = read.sheet.rowNumbers[index]!;
    const raw: RawImportRow = raws[index]!;
    const label = { sheetRow, code: raw.code.trim().toUpperCase(), endUser: cleanName(raw.endUser), name: cleanName(raw.name), changes: [] as UpdateChange[] };
    const fail = (messages: string[]) => {
      counts.errors += 1;
      reports.push({ ...label, status: "error", messages });
    };
    const skip = (message: string) => {
      counts.skipped += 1;
      reports.push({ ...label, status: "skipped", messages: [message] });
    };

    if (label.code === "") return skip("Tanpa Project ID, jadi bukan update. Project baru diimpor lewat mode impor.");
    const project = byCode.get(label.code);
    if (!project) return skip(`Project ID ${label.code} tidak ditemukan, jadi bukan update.`);
    if (seenCodes.has(label.code)) return fail([`Project ID ${label.code} sudah dipakai di baris ${seenCodes.get(label.code)} berkas ini.`]);
    seenCodes.set(label.code, sheetRow);
    if (ownOnly && !salesActsOn(project, actor.id)) return fail(["Project ini bukan milik Anda, jadi tidak bisa diperbarui. Hapus barisnya dari berkas."]);
    // An import row must name its Sales PIC and source; an update row may leave them empty (nothing changes), so the stored values
    // stand in for the empty cells while the row is read and checked.
    const checkedRow = checkImportRow({
      ...raw,
      source: raw.source || SOURCE_LABELS[project.sourceType],
      salesPic: raw.salesPic || project.salesOwner?.email || "",
      externalSourceName: raw.externalSourceName || project.externalSourceName || "",
    });
    if (!checkedRow.ok) return fail(checkedRow.errors);
    const row: ImportRow = checkedRow.value;

    const problems: string[] = [];
    // A project changed after the export would have its newer edits overwritten by an older sheet.
    if (text(raw.lastUpdated) !== "") {
      const exportedAt = new Date(text(raw.lastUpdated));
      if (Number.isNaN(exportedAt.getTime())) problems.push(`Last updated "${raw.lastUpdated}" tidak bisa dibaca. Pakai kolom dari hasil export.`);
      else if (exportedAt.getTime() !== project.updatedAt.getTime()) problems.push(`Proyek berubah sejak diexport (terakhir diubah ${project.updatedAt.toISOString()}). Export ulang, lalu edit lagi.`);
    }
    if (text(raw.source) !== "" && row.sourceType !== project.sourceType) problems.push("Project source tidak bisa diubah lewat update. Ubah di halaman proyek.");

    const changes: UpdateChange[] = [];
    const applied: Applied = {};

    const endUser = cleanName(raw.endUser);
    if (endUser !== project.endUserCompany) {
      applied.endUser = { name: endUser };
      changes.push({ label: "End user", from: project.endUserCompany, to: endUser });
      if (!knownCustomers.has(nameKey(endUser))) newCustomers.set(nameKey(endUser), endUser);
    }
    if (row.name !== project.name) {
      applied.name = row.name;
      changes.push({ label: fieldLabel("name"), from: project.name, to: row.name });
    }
    if (text(raw.description) !== "" && row.description !== (project.description ?? null)) {
      applied.description = row.description ?? "";
      changes.push({ label: "Description", from: project.description, to: row.description });
    }

    if (text(raw.salesPic) !== "") {
      if (project.sourceType !== "INTERNAL_SALES") problems.push("Proyek dari source Other tidak punya Sales PIC internal.");
      // The export writes the owner's name, which two accounts can share: the cell that names the current owner is no change.
      else if (nameKey(text(raw.salesPic)) === nameKey(project.salesOwner?.name ?? "") || text(raw.salesPic).toLowerCase() === (project.salesOwner?.email ?? "").toLowerCase()) {
        // unchanged
      }
      else {
        const wanted = text(raw.salesPic);
        const byMail = byEmail.get(wanted.toLowerCase());
        const named = byName.get(nameKey(wanted)) ?? [];
        const owner = byMail ?? (named.length === 1 ? named[0]! : null);
        if (!owner) problems.push(named.length > 1 ? `Sales PIC "${wanted}" cocok dengan ${named.length} akun. Tulis alamat emailnya.` : `Sales PIC "${wanted}" bukan akun Sales yang aktif.`);
        else if (owner.id !== project.salesOwnerId) {
          const show = (person: { name: string; email: string }) => `${person.name} (${person.email})`;
          applied.salesOwner = { id: owner.id, label: show(owner) };
          changes.push({ label: fieldLabel("salesOwner"), from: project.salesOwner ? show(project.salesOwner) : null, to: show(owner) });
        }
      }
    }

    // Commercial fields: planned with the same rules as the project form (stage dates follow Progress).
    const submitted: CommercialSubmission = {};
    if (text(raw.progress) !== "") submitted.progress = row.progress;
    if (text(raw.status) !== "") submitted.trackStatus = row.trackStatus;
    if (text(raw.estimatedValue) !== "") submitted.estimatedValue = row.estimatedValue;
    if (text(raw.targetMarginPercent) !== "") {
      submitted.targetMargin = row.targetMarginPercent;
      submitted.targetMarginValue = null;
    } else if (text(raw.targetMarginAmount) !== "") {
      submitted.targetMarginValue = row.targetMarginAmount;
      submitted.targetMargin = null;
    }
    if (text(raw.quoteReleasedAt) !== "") submitted.quoteReleasedAt = row.quoteReleasedAt;
    if (text(raw.targetDate) !== "") submitted.targetDate = row.targetDate;
    const commercialChanges = planCommercialChanges(project, submitted);
    for (const change of commercialChanges) changes.push({ label: COMMERCIAL_FIELDS[change.field].label, from: change.from, to: change.to });

    if (text(raw.principals) !== "") {
      const current = principalNamesOf(project);
      if (row.principals.map(nameKey).join("|") !== current.map(nameKey).join("|")) {
        applied.principals = row.principals;
        changes.push({ label: fieldLabel("principal"), from: current.join("; ") || null, to: row.principals.join("; ") });
        for (const name of row.principals) if (!knownPrincipals.has(nameKey(name))) newPrincipals.set(nameKey(name), name);
      }
    }
    if (row.solution && nameKey(row.solution) !== nameKey(project.solutionCategory?.name ?? "")) {
      applied.solution = row.solution;
      changes.push({ label: fieldLabel("solution"), from: project.solutionCategory?.name ?? null, to: row.solution });
      if (!knownSolutions.has(nameKey(row.solution))) newSolutions.set(nameKey(row.solution), row.solution);
    }
    // The Technical PIC is a person of the SOA PIC list, written by name; the cell naming the current one is no change.
    if (text(raw.technicalPic) !== "" && nameKey(text(raw.technicalPic)) !== nameKey(project.soaPic?.name ?? "")) {
      const pic = soaPicByName.get(nameKey(text(raw.technicalPic)));
      if (!pic) problems.push(`Technical PIC "${text(raw.technicalPic)}" bukan PIC SOA yang aktif.`);
      else {
        applied.technicalPic = { id: pic.id, name: pic.name };
        changes.push({ label: fieldLabel("technicalPic"), from: project.soaPic?.name ?? null, to: pic.name });
      }
    }
    // The industry is the customer's (it wins over the project's own), chosen from the list; the cell naming the current one is no change.
    const currentIndustry = effectiveIndustry(project.customer?.industry, project.industry);
    if (row.industry && nameKey(row.industry) !== nameKey(currentIndustry ?? "")) {
      const listed = listedIndustries.get(nameKey(row.industry));
      const customerKey = applied.endUser ? `new:${nameKey(applied.endUser.name)}` : (project.customerId ?? `project:${project.id}`);
      if (!listed) problems.push(`Industri "${row.industry}" tidak ada di daftar. Pakai nama persis dari daftar, atau minta Admin menambahkannya di Master Data.`);
      else if (industryOfCustomer.has(customerKey) && industryOfCustomer.get(customerKey) !== listed) problems.push(`Customer ${endUser} diberi dua industri berbeda di berkas ini.`);
      else {
        industryOfCustomer.set(customerKey, listed);
        applied.industry = { customerId: applied.endUser ? null : project.customerId, name: listed };
        changes.push({ label: "Industry", from: currentIndustry, to: listed });
      }
    }
    if (row.location && row.location !== (project.location ?? null)) {
      applied.location = row.location;
      changes.push({ label: "Location", from: project.location, to: row.location });
    }

    // A column outside the role's part of the sheet may be present (added by hand) but never changes anything: it is refused by name.
    const outside: [boolean, string][] = [
      [!scope.identity && Boolean(applied.endUser || applied.name !== undefined || applied.description !== undefined), "End user, Project name atau Description"],
      [!scope.owner && Boolean(applied.salesOwner), "Sales PIC"],
      [!scope.commercial && commercialChanges.length > 0, "kolom commercial (Progress sampai Target closing)"],
      [!scope.technical && Boolean(applied.principals || applied.solution || applied.technicalPic), "Principals, Solution atau Technical PIC"],
      [!scope.place && Boolean(applied.industry || applied.location !== undefined), "Industry atau Location"],
    ];
    for (const [denied, name] of outside) if (denied) problems.push(`Peran Anda tidak boleh mengubah ${name}. Kosongkan atau kembalikan sel itu ke isi semula.`);
    if (!mayCreateMaster && (applied.principals?.some((name) => !knownPrincipals.has(nameKey(name))) || (applied.solution && !knownSolutions.has(nameKey(applied.solution))))) {
      problems.push("Principal atau solution baru hanya boleh dibuat oleh yang berhak mengelola master data.");
    }
    if (problems.length > 0) return fail(problems);
    if (changes.length === 0) {
      counts.unchanged += 1;
      reports.push({ ...label, status: "unchanged", messages: [] });
      return;
    }
    counts.toUpdate += 1;
    const report: UpdateRowReport = { ...label, status: "update", changes, messages: [] };
    reports.push(report);
    planned.push({ report, projectId: project.id, submitted, commercialChanges, applied, oldSalesOwnerId: project.salesOwnerId });
  });

  return {
    ok: true,
    prepared: { fileRows: read.sheet.rows.length, sheetName: read.sheet.sheetName, reports, planned, counts, newCustomers: [...newCustomers.values()], newPrincipals: [...newPrincipals.values()], newSolutions: [...newSolutions.values()] },
  };
}

function summarise(prepared: Prepared): UpdateSummary {
  const attention = prepared.reports.filter((report) => report.status === "error" || report.status === "skipped");
  const updates = prepared.reports.filter((report) => report.status === "update");
  return {
    sheetName: prepared.sheetName,
    totalRows: prepared.fileRows,
    ...prepared.counts,
    rows: [...attention.slice(0, DETAIL_LIMIT), ...updates.slice(0, DETAIL_LIMIT)],
    detailTruncated: attention.length > DETAIL_LIMIT || updates.length > DETAIL_LIMIT,
    newCustomers: prepared.newCustomers,
    newPrincipals: prepared.newPrincipals,
    newSolutions: prepared.newSolutions,
  };
}

async function allowed(db: Db, claimed: Actor) {
  if (!can(claimed.role, PERMISSION)) return null;
  const actor = await db.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && can(actor.role, PERMISSION) ? actor : null;
}

/** Checks a sheet and reports which projects an update would change, and how. Writes nothing. */
export async function previewProjectUpdate(db: PrismaClient, claimedActor: Actor, input: { bytes: Uint8Array; mapping: unknown }): Promise<UpdatePreviewResult> {
  const actor = await allowed(db, claimedActor);
  if (!actor) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const result = await prepare(db, actor, input.bytes, input.mapping);
  if (!result.ok) return result;
  return { ok: true, summary: summarise(result.prepared) };
}

class Abort extends Error {
  constructor(readonly result: UpdateCommitResult) {
    super("update aborted");
  }
}

/**
 * Applies the update in one transaction: every project is changed or none. The sheet is read and planned again inside the transaction
 * (the preview is only a preview). A file with any problem row is refused, and names that would be created (customer, principal,
 * solution) need `confirmNew`, so a typo cannot add a customer unnoticed. Each changed project gets its change-log rows and an audit event.
 */
export async function commitProjectUpdate(db: PrismaClient, claimedActor: Actor, input: { bytes: Uint8Array; mapping: unknown; fileName: string; confirmNew: boolean }): Promise<UpdateCommitResult> {
  if (!can(claimedActor.role, PERMISSION)) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const fileName = cleanName(input.fileName).slice(0, FILE_NAME_MAX) || "update.xlsx";

  try {
    return await db.$transaction(
      async (tx): Promise<UpdateCommitResult> => {
        const actor = await allowed(tx, claimedActor);
        if (!actor) throw new Abort({ ok: false, code: "FORBIDDEN", message: FORBIDDEN });
        await setActor(tx, actor.id);
        // One import or update at a time, and no project written by anyone else between the check and the write.
        await tx.$executeRaw`LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE`;

        const result = await prepare(tx, actor, input.bytes, input.mapping);
        if (!result.ok) throw new Abort(result);
        const { prepared } = result;
        const summary = summarise(prepared);
        if (prepared.counts.errors > 0) {
          throw new Abort({ ok: false, code: "HAS_ERRORS", message: `${prepared.counts.errors} baris bermasalah, jadi tidak ada proyek yang diperbarui. Perbaiki di sheet, lalu coba lagi.`, summary });
        }
        if (prepared.planned.length === 0) throw new Abort({ ok: false, code: "NOTHING_TO_UPDATE", message: "Tidak ada perubahan untuk disimpan dari sheet ini.", summary });
        const added = [...prepared.newCustomers, ...prepared.newPrincipals, ...prepared.newSolutions];
        if (added.length > 0 && !input.confirmNew) {
          throw new Abort({ ok: false, code: "NEEDS_CONFIRMATION", message: `Nama berikut belum ada dan akan dibuat: ${added.join(", ")}. Periksa penulisannya, lalu konfirmasi.`, summary });
        }

        const codes: string[] = [];
        for (const plan of prepared.planned) {
          const project = await tx.project.findUniqueOrThrow({ where: { id: plan.projectId } });
          if (plan.commercialChanges.length > 0) await writeCommercialChanges(tx, actor.id, project, plan.submitted, plan.commercialChanges);

          const { applied } = plan;
          const data: Prisma.ProjectUncheckedUpdateInput = {};
          const log: { field: string; from: string | null; to: string | null }[] = [];
          if (applied.endUser) {
            data.endUserCompany = applied.endUser.name;
            data.customerId = await ensureCustomer(tx, applied.endUser.name);
            log.push({ field: "endUserCompany", from: project.endUserCompany, to: applied.endUser.name });
          }
          if (applied.name !== undefined) {
            data.name = applied.name;
            log.push({ field: "name", from: project.name, to: applied.name });
          }
          if (applied.description !== undefined) {
            data.description = applied.description;
            log.push({ field: "description", from: project.description, to: applied.description });
          }
          if (applied.salesOwner) {
            data.salesOwnerId = applied.salesOwner.id;
            const shown = plan.report.changes.find((change) => change.label === fieldLabel("salesOwner"));
            log.push({ field: "salesOwner", from: shown?.from ?? null, to: applied.salesOwner.label });
          }
          if (applied.principals) {
            const before = plan.report.changes.find((change) => change.label === fieldLabel("principal"))?.from ?? null;
            const ids: string[] = [];
            for (const name of applied.principals) ids.push(await ensurePrincipal(tx, name));
            await tx.projectPrincipal.deleteMany({ where: { projectId: project.id } });
            if (ids.length > 0) await tx.projectPrincipal.createMany({ data: ids.map((principalId, position) => ({ projectId: project.id, principalId, position })) });
            data.principalId = ids[0] ?? null;
            log.push({ field: "principal", from: before, to: applied.principals.join("; ") });
          }
          if (applied.solution) {
            data.solutionCategoryId = await ensureSolutionCategory(tx, applied.solution);
            log.push({ field: "solution", from: plan.report.changes.find((change) => change.label === fieldLabel("solution"))?.from ?? null, to: applied.solution });
          }
          if (applied.technicalPic) {
            data.soaPicId = applied.technicalPic.id;
            log.push({ field: "technicalPic", from: plan.report.changes.find((change) => change.label === fieldLabel("technicalPic"))?.from ?? null, to: applied.technicalPic.name });
          }
          if (applied.industry) {
            // The customer carries the industry (the new customer, when the end user changes in the same row); a project without one keeps its own.
            const customerId = applied.industry.customerId ?? (data.customerId as string | null | undefined) ?? null;
            const before = plan.report.changes.find((change) => change.label === "Industry")?.from ?? null;
            if (customerId) {
              await tx.customer.update({ where: { id: customerId }, data: { industry: applied.industry.name } });
              await tx.auditEvent.create({ data: { actorId: actor.id, action: "customer.industry_set", entityType: "customer", entityId: customerId, before: { industry: before }, after: { industry: applied.industry.name, file: fileName } } });
            } else data.industry = applied.industry.name;
            log.push({ field: "industry", from: before, to: applied.industry.name });
          }
          if (applied.location !== undefined) {
            data.location = applied.location;
            log.push({ field: "location", from: project.location, to: applied.location });
          }

          if (log.length > 0) {
            await tx.project.update({ where: { id: project.id }, data });
            const now = new Date();
            await tx.projectChange.createMany({ data: log.map((change) => ({ projectId: project.id, changedById: actor.id, field: change.field, fromValue: change.from, toValue: change.to, changedAt: now })) });
            await tx.auditEvent.create({
              data: {
                actorId: actor.id,
                action: "project.bulk_updated",
                entityType: "project",
                entityId: project.id,
                before: Object.fromEntries(log.map((change) => [change.field, change.from])) as Prisma.InputJsonValue,
                after: { ...Object.fromEntries(log.map((change) => [change.field, change.to])), file: fileName } as Prisma.InputJsonValue,
              },
            });
          }
          if (applied.salesOwner) {
            await notify(tx, {
              actorId: actor.id,
              recipientIds: [applied.salesOwner.id, ...(plan.oldSalesOwnerId ? [plan.oldSalesOwnerId] : [])],
              kind: "project.reassigned",
              title: `${project.code} has new owners`,
              body: `${applied.endUser?.name ?? project.endUserCompany}: Sales PIC ${plan.report.changes.find((change) => change.label === fieldLabel("salesOwner"))?.from ?? "none"} → ${applied.salesOwner.label}`,
              href: `/projects/${project.code}`,
            });
          }
          codes.push(project.code);
        }

        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "import.projects_update",
            entityType: "import",
            entityId: fileName,
            after: { updated: codes.length, unchanged: prepared.counts.unchanged, skipped: prepared.counts.skipped, sheet: prepared.sheetName, newCustomers: prepared.newCustomers, newPrincipals: prepared.newPrincipals, newSolutions: prepared.newSolutions },
          },
        });
        return { ok: true, summary, updated: codes.length, unchanged: prepared.counts.unchanged, skipped: prepared.counts.skipped, codes };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    if (error instanceof Abort) return error.result;
    return { ok: false, code: "FAILED", message: "Pembaruan gagal, jadi tidak ada proyek yang berubah." };
  }
}
