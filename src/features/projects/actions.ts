"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { PROJECT_EDITABLE_KEYS, fieldLabel, type ProjectEditableField } from "@/domain/projects/fields";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { postProjectUpdate, updateProjectDetails } from "@/server/projects/service";

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
