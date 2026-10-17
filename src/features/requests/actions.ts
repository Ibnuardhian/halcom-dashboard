"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form-status";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requirePermission, requireUser } from "@/server/auth/current-user";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";

// Each action checks the sign-in (and, where one permission fits, that permission) on the server;
// the service then re-checks the actor and the record-specific rules inside its transaction.

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export async function createProjectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission("projects.create");
  const result = await createProject(getDb(), { id: user.id, role: user.role }, {
    endUserCompany: text(formData, "endUserCompany"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    targetDate: text(formData, "targetDate"),
    submissionKey: text(formData, "submissionKey"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PROJECTS_PATH);
  redirect(`${PROJECTS_PATH}/${result.value.code}`);
}

export async function createRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission("requests.create");
  const result = await createRequest(getDb(), { id: user.id, role: user.role }, {
    projectId: text(formData, "projectId"),
    type: text(formData, "type"),
    title: text(formData, "title"),
    description: text(formData, "description"),
    requiredBy: text(formData, "requiredBy"),
    submissionKey: text(formData, "submissionKey"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(REQUESTS_PATH);
  redirect(`/request/${result.value.code}`);
}

export async function changeStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await changeRequestStatus(getDb(), { id: user.id, role: user.role }, {
    requestId: text(formData, "requestId"),
    to: text(formData, "to"),
    reason: text(formData, "reason"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message: "Status updated." };
}

export async function handOverAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await handOverToPurchasing(getDb(), { id: user.id, role: user.role }, {
    sourceId: text(formData, "sourceId"),
    targetType: text(formData, "targetType"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(REQUESTS_PATH);
  redirect(`/request/${result.value.code}`);
}
