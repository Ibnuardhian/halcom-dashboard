"use server";

import { revalidatePath } from "next/cache";
import { suggestMapping, type ColumnMapping } from "@/domain/projects/import";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { notFound } from "next/navigation";
import { can } from "@/domain/access/permissions";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { readXlsx, XLSX_LIMITS } from "@/server/import/xlsx-reader";
import { commitProjectSync, previewProjectSync, type SyncCommitResult, type SyncMode, type SyncPreviewResult } from "@/server/import/xlsx-projects-sync";

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

/** Reads the sheet's headers and a few rows, and finds by name which column holds which field. */
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

/** Checks every row with the chosen mapping and reports what the upload would add and change, row by row; writes nothing. */
export async function previewSyncAction(formData: FormData): Promise<SyncPreviewResult> {
  const user = await requireUser();
  const file = await fileOf(formData);
  if (!file.ok) return { ok: false, code: "INVALID_FILE", message: file.message };
  return previewProjectSync(getDb(), { id: user.id, role: user.role }, { bytes: file.bytes, mapping: mappingOf(formData) });
}

/** Adds the rows without a Project ID and updates the rows with one, in one transaction. Names that would be created need `confirmNew`. */
export async function commitSyncAction(formData: FormData): Promise<SyncCommitResult> {
  const user = await requireUser();
  const file = await fileOf(formData);
  if (!file.ok) return { ok: false, code: "INVALID_FILE", message: file.message };
  const mode: SyncMode = formData.get("mode") === "skip-invalid" ? "skip-invalid" : "atomic";
  const result = await commitProjectSync(getDb(), { id: user.id, role: user.role }, { bytes: file.bytes, fileName: file.name, mapping: mappingOf(formData), mode, confirmNew: formData.get("confirmNew") === "true" });
  if (result.ok) {
    revalidatePath(PROJECTS_PATH);
    revalidatePath(REQUESTS_PATH);
    revalidatePath("/dashboard", "layout");
  }
  return result;
}
