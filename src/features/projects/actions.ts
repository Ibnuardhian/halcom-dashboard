"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { COMMERCIAL_KEYS } from "@/domain/projects/commercial";
import { marginFields } from "@/domain/projects/margin";
import { PROJECT_EDITABLE_KEYS, fieldLabel, type ProjectEditableField } from "@/domain/projects/fields";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { redirect } from "next/navigation";
import { deleteProject } from "@/server/projects/delete";
import { reassignProject } from "@/server/projects/reassign";
import { postProjectUpdate, updateCommercialDetails, updateProjectDetails } from "@/server/projects/service";

/**
 * Saves the technical fields a form submitted. Only the known field names are passed on,
 * and only the ones the form actually contained; the service re-checks the permission and rejects
 * anything else.
 */
export async function updateProjectDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const values: Partial<Record<ProjectEditableField, string>> = {};
  for (const key of PROJECT_EDITABLE_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  const result = await updateProjectDetails(getDb(), { id: user.id, role: user.role }, { projectId: formData.get("projectId"), values });
  if (!result.ok) return { ok: false, message: result.message };

  const code = formData.get("projectCode");
  if (typeof code === "string" && /^PRJ-\d{3,}$/.test(code)) revalidatePath(`${PROJECTS_PATH}/${code}`);
  revalidatePath(PROJECTS_PATH);
  if (result.changed.length === 0) return { ok: true, message: "Nothing changed." };
  return { ok: true, message: `Saved and logged: ${result.changed.map(fieldLabel).join(", ")}.` };
}

/** Adds a current-action or next-action entry to a project's feed (SOA and admins). */
export async function postProjectUpdateAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await postProjectUpdate(getDb(), { id: user.id, role: user.role }, {
    projectId: formData.get("projectId"),
    kind: formData.get("kind"),
    body: formData.get("body"),
  });
  if (!result.ok) return { ok: false, message: result.message };

  const code = formData.get("projectCode");
  if (typeof code === "string" && /^PRJ-\d{3,}$/.test(code)) revalidatePath(`${PROJECTS_PATH}/${code}`);
  return { ok: true, message: "Update posted." };
}

/** Saves Sales' commercial fields (value, target margin, target closing) of one project. */
export async function updateCommercialDetailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const values: Record<string, string> = {};
  for (const key of COMMERCIAL_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  // The margin box has a mode (amount or percent); it fills one of the two stored fields and clears the other.
  if (formData.has("marginMode")) Object.assign(values, marginFields(formData.get("marginMode"), formData.get("marginInput")));
  const result = await updateCommercialDetails(getDb(), { id: user.id, role: user.role }, { projectId: formData.get("projectId"), values });
  if (!result.ok) return { ok: false, message: result.message };

  const code = formData.get("projectCode");
  if (typeof code === "string" && /^PRJ-\d{3,}$/.test(code)) revalidatePath(`${PROJECTS_PATH}/${code}`);
  revalidatePath(PROJECTS_PATH);
  if (result.changed.length === 0) return { ok: true, message: "Nothing changed." };
  return { ok: true, message: `Saved and logged: ${result.changed.map(fieldLabel).join(", ")}.` };
}

/** Deletes (hides) a project; superadmin only. On success the person goes back to the project list. */
export async function deleteProjectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await deleteProject(getDb(), { id: user.id, role: user.role }, { projectId: formData.get("projectId"), confirmCode: formData.get("confirmCode") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PROJECTS_PATH);
  revalidatePath("/dashboard", "layout");
  redirect(PROJECTS_PATH);
}

/** Moves a project to other Sales, SOA and Purchasing PICs; superadmin only. Nothing else about the project changes. */
export async function reassignProjectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const pick = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const result = await reassignProject(getDb(), { id: user.id, role: user.role }, {
    projectId: formData.get("projectId"),
    salesOwnerId: pick("salesOwnerId"),
    technicalPicId: pick("technicalPicId"),
    purchasingPicId: pick("purchasingPicId"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  const code = formData.get("projectCode");
  if (typeof code === "string" && /^PRJ-\d{3,}$/.test(code)) revalidatePath(`${PROJECTS_PATH}/${code}`);
  revalidatePath(PROJECTS_PATH);
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: result.changed.length === 0 ? "Nothing changed." : "The project was moved. Its history is unchanged." };
}

/**
 * Clears one technical section of a project (a confirmed removal in the form). Only that field is sent, so no other section is
 * touched; the change log records the text it had. The page is not refreshed, so what the person typed in other sections stays.
 */
export async function removeTechnicalSectionAction(projectId: string, projectCode: string, field: string): Promise<FormState> {
  const user = await requireUser();
  const known = PROJECT_EDITABLE_KEYS.find((key) => key === field);
  if (!known) return { ok: false, message: "That section does not exist." };
  const result = await updateProjectDetails(getDb(), { id: user.id, role: user.role }, { projectId, values: { [known]: "" } });
  if (!result.ok) return { ok: false, message: result.message };
  void projectCode;
  return { ok: true, message: `${fieldLabel(known)} removed. The change log keeps what it said; it shows after the page is reloaded.` };
}
