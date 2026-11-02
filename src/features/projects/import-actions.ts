"use server";

import { revalidatePath } from "next/cache";
import { suggestMapping, type ColumnMapping } from "@/domain/projects/import";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { notFound } from "next/navigation";
import { can } from "@/domain/access/permissions";
import { getDb } from "@/lib/db";
import { requirePermission, requireUser } from "@/server/auth/current-user";
import { commitProjectImport, previewProjectImport, type CommitMode, type CommitResult, type PreviewResult } from "@/server/import/xlsx-projects";
import { readXlsx, XLSX_LIMITS } from "@/server/import/xlsx-reader";
import { commitProjectUpdate, previewProjectUpdate, type UpdateCommitResult, type UpdatePreviewResult } from "@/server/import/xlsx-projects-update";

// The sheet is posted again with every step and read again on the server each time: nothing from an earlier step is trusted.

export type InspectResult =
  | { ok: true; fileName: string; sheetName: string; headers: string[]; sample: string[][]; rowCount: number; suggested: ColumnMapping }
  | { ok: false; message: string };

async function fileOf(formData: FormData): Promise<{ ok: true; name: string; bytes: Uint8Array } | { ok: false; message: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Pilih berkas .xlsx." };
  if (file.size > XLSX_LIMITS.fileBytes) return { ok: false, message: `Berkas lebih besar dari ${XLSX_LIMITS.fileBytes / 1024 / 1024} MB.` };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, message: "Hanya workbook .xlsx yang bisa diimpor. Simpan sheet sebagai Excel Workbook (.xlsx)." };
  return { ok: true, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function mappingOf(formData: FormData): unknown {
  const raw = formData.get("mapping");
  if (typeof raw !== "string" || raw.length > 4000) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Step 1: reads the sheet's headers and a few rows, and suggests which column holds which field. */
export async function inspectSheetAction(formData: FormData): Promise<InspectResult> {
  // The sheet is only read here; whoever may add or update projects reads it.
  const user = await requireUser();
  if (!can(user.role, "projects.import") && !can(user.role, "projects.bulk-update")) notFound();
  const file = await fileOf(formData);
  if (!file.ok) return file;
  const read = readXlsx(file.bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const { sheet } = read;
  return { ok: true, fileName: file.name, sheetName: sheet.sheetName, headers: sheet.headers, sample: sheet.rows.slice(0, 5), rowCount: sheet.rows.length, suggested: suggestMapping(sheet.headers) };
}

/** Step 2: checks every row with the chosen mapping and reports; writes nothing. */
export async function previewImportAction(formData: FormData): Promise<PreviewResult> {
  const user = await requirePermission("projects.import");
  const file = await fileOf(formData);
  if (!file.ok) return { ok: false, code: "INVALID_FILE", message: file.message };
  return previewProjectImport(getDb(), { id: user.id, role: user.role }, { bytes: file.bytes, mapping: mappingOf(formData) });
}

/** Step 3: imports the new rows in one transaction. */
export async function commitImportAction(formData: FormData): Promise<CommitResult> {
  const user = await requirePermission("projects.import");
  const file = await fileOf(formData);
  if (!file.ok) return { ok: false, code: "INVALID_FILE", message: file.message };
  const mode: CommitMode = formData.get("mode") === "skip-invalid" ? "skip-invalid" : "atomic";
  const result = await commitProjectImport(getDb(), { id: user.id, role: user.role }, { bytes: file.bytes, fileName: file.name, mapping: mappingOf(formData), mode });
  if (result.ok) {
    revalidatePath(PROJECTS_PATH);
    revalidatePath(REQUESTS_PATH);
  }
  return result;
}

/** Update mode, step 2: plans every row against the stored projects and reports what would change; writes nothing. */
export async function previewUpdateAction(formData: FormData): Promise<UpdatePreviewResult> {
  const user = await requirePermission("projects.bulk-update");
  const file = await fileOf(formData);
  if (!file.ok) return { ok: false, code: "INVALID_FILE", message: file.message };
  return previewProjectUpdate(getDb(), { id: user.id, role: user.role }, { bytes: file.bytes, mapping: mappingOf(formData) });
}

/** Update mode, step 3: applies the changes in one transaction. New customer, principal and solution names need `confirmNew`. */
export async function commitUpdateAction(formData: FormData): Promise<UpdateCommitResult> {
  const user = await requirePermission("projects.bulk-update");
  const file = await fileOf(formData);
  if (!file.ok) return { ok: false, code: "INVALID_FILE", message: file.message };
  const result = await commitProjectUpdate(getDb(), { id: user.id, role: user.role }, { bytes: file.bytes, fileName: file.name, mapping: mappingOf(formData), confirmNew: formData.get("confirmNew") === "true" });
  if (result.ok) {
    revalidatePath(PROJECTS_PATH);
    revalidatePath("/dashboard", "layout");
  }
  return result;
}
