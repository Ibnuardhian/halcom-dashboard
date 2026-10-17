"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { MASTER_KINDS, type MasterKind } from "@/domain/projects/master-data";
import { MASTER_DATA_PATH, PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { createMasterRecord, deleteMasterRecord, renameMasterRecord, setProjectMasterData } from "@/server/masterdata/service";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const kindOf = (value: string): MasterKind | "" => MASTER_KINDS.find((kind) => kind === value) ?? "";

export type CreateResult = { ok: true; id: string; name: string } | { ok: false; message: string; existing?: { id: string; name: string } };

/** Creates a Principal or Solution from the dropdown's explicit "Create" action. A name that exists comes back as the existing record. */
export async function createMasterRecordAction(kind: string, name: string): Promise<CreateResult> {
  const user = await requireUser();
  const result = await createMasterRecord(getDb(), { id: user.id, role: user.role }, { kind, name });
  if (!result.ok) return { ok: false, message: result.message, ...(result.existing ? { existing: result.existing } : {}) };
  revalidatePath(MASTER_DATA_PATH);
  return { ok: true, id: result.value.id, name: result.value.name };
}

/** Saves the Principal and Solution picked on a project. */
export async function setProjectMasterDataAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setProjectMasterData(getDb(), { id: user.id, role: user.role }, {
    projectId: text(formData, "projectId"),
    principalId: text(formData, "principalId"),
    solutionId: text(formData, "solutionId"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  const code = text(formData, "projectCode");
  if (/^PRJ-\d{3,}$/.test(code)) revalidatePath(`${PROJECTS_PATH}/${code}`);
  revalidatePath(PROJECTS_PATH);
  return { ok: true, message: result.value.changed.length === 0 ? "Nothing changed." : "Saved and logged." };
}

/** Renames a Principal or Solution on the master data page. */
export async function renameMasterRecordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await renameMasterRecord(getDb(), { id: user.id, role: user.role }, { kind: kindOf(text(formData, "kind")), id: text(formData, "id"), name: text(formData, "name") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(MASTER_DATA_PATH);
  revalidatePath(PROJECTS_PATH);
  return { ok: true, message: "Renamed." };
}

/** Deletes an unused Principal or Solution. */
export async function deleteMasterRecordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await deleteMasterRecord(getDb(), { id: user.id, role: user.role }, { kind: kindOf(text(formData, "kind")), id: text(formData, "id") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(MASTER_DATA_PATH);
  return { ok: true, message: "Deleted." };
}
