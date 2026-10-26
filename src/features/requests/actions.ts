"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form-status";
import { marginFields } from "@/domain/projects/margin";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { assignRequestPic } from "@/server/pics/service";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing, requestRevision, setRequestDates, setRequestPhase, stopFlow } from "@/server/requests/service";

// Each action checks the sign-in (and, where one permission fits, that permission) on the server;
// the service then re-checks the actor and the record-specific rules inside its transaction.

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export async function createProjectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  // Who may register a project depends on its source, so the service decides; it re-checks the stored role.
  const user = await requireUser();
  const requestType = text(formData, "requestType");
  const result = await createProject(getDb(), { id: user.id, role: user.role }, {
    endUserCompany: text(formData, "endUserCompany"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    targetDate: text(formData, "targetDate"),
    sourceType: text(formData, "sourceType"),
    externalSourceName: text(formData, "externalSourceName"),
    externalContact: text(formData, "externalContact"),
    externalReference: text(formData, "externalReference"),
    sourceNotes: text(formData, "sourceNotes"),
    salesOwnerId: text(formData, "salesOwnerId"),
    progress: text(formData, "progress"),
    trackStatus: text(formData, "trackStatus"),
    estimatedValue: text(formData, "estimatedValue"),
    ...marginFields(formData.get("marginMode"), formData.get("marginInput")),
    // "" means no request; otherwise the project is created together with its first BOQ, RFQ or PO.
    request: requestType
      ? {
          type: requestType,
          title: text(formData, "requestTitle"),
          description: text(formData, "requestDescription"),
          requiredBy: text(formData, "requestRequiredBy"),
        }
      : null,
    submissionKey: text(formData, "submissionKey"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PROJECTS_PATH);
  if (result.value.requestCode) {
    revalidatePath(REQUESTS_PATH);
    redirect(`/request/${result.value.requestCode}`);
  }
  redirect(`${PROJECTS_PATH}/${result.value.code}`);
}

export async function createRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  // BOQ for a project from another source is raised by SOA, everything else by Sales: the service decides per project.
  const user = await requireUser();
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

/**
 * Moves a request to another column of the board (the only place SOA and Purchasing change a status). The service re-checks who may
 * move this type of request, that the move is allowed from where the request is, and that a reason came with a cancellation or reopening.
 */
export async function moveRequestAction(requestId: string, to: string, reason?: string): Promise<NonNullable<FormState>> {
  const user = await requireUser();
  const result = await changeRequestStatus(getDb(), { id: user.id, role: user.role }, { requestId, to, reason: reason ?? null });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message: `${result.value.code} moved.` };
}

export async function handOverAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const actor = { id: user.id, role: user.role };
  if (text(formData, "decision") === "stop") {
    const stopped = await stopFlow(getDb(), actor, { sourceId: text(formData, "sourceId"), note: text(formData, "note") });
    if (!stopped.ok) return { ok: false, message: stopped.message };
    revalidatePath(`/request/${stopped.value.code}`);
    revalidatePath(REQUESTS_PATH);
    return { ok: true, message: "Recorded: this request does not continue to the next step. You can still continue later." };
  }
  const result = await handOverToPurchasing(getDb(), actor, {
    sourceId: text(formData, "sourceId"),
    targetType: text(formData, "targetType"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(REQUESTS_PATH);
  redirect(`/request/${result.value.code}`);
}

/** SOA or Purchasing hands a request to one of their PICs (or takes it back with an empty choice). */
export async function assignPicAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await assignRequestPic(getDb(), { id: user.id, role: user.role }, { requestId: text(formData, "requestId"), picId: text(formData, "picId") ?? "" });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message: result.value.picId ? "PIC saved." : "PIC cleared." };
}

/** SOA labels a BOQ request Assessment, Sizing or POC (or clears the label). */
export async function setPhaseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setRequestPhase(getDb(), { id: user.id, role: user.role }, { requestId: text(formData, "requestId"), phase: text(formData, "phase") ?? "" });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message: "Phase saved." };
}

/** Sales send a completed BOQ back to SOA for a revision. The service checks who may, that the BOQ is completed, and that a reason came. */
export async function setRequestDatesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setRequestDates(getDb(), { id: user.id, role: user.role }, {
    requestId: text(formData, "requestId"),
    createdAt: text(formData, "createdAt"),
    completedAt: text(formData, "completedAt"),
    requesterId: text(formData, "requesterId"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  revalidatePath(PROJECTS_PATH);
  return { ok: true, message: `The dates of ${result.value.code} were saved.` };
}

export async function requestRevisionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await requestRevision(getDb(), { id: user.id, role: user.role }, { requestId: text(formData, "requestId"), reason: text(formData, "reason") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  revalidatePath("/notifications");
  return { ok: true, message: `${result.value.code} is now in Revision. SOA has been told.` };
}
