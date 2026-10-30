"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { MASTER_DATA_PATH, PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { createPhase, createSection, setSectionValues, updatePhase, updateSection } from "@/server/sections/service";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function done(message: string): FormState {
  revalidatePath(MASTER_DATA_PATH);
  revalidatePath(PROJECTS_PATH, "layout");
  return { ok: true, message };
}

/** Adds a technical section (Admin and Superadmin). */
export async function createSectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await createSection(getDb(), { id: user.id, role: user.role }, { label: text(formData, "label"), kind: text(formData, "kind"), options: text(formData, "options") });
  return result.ok ? done("Bagian ditambahkan.") : { ok: false, message: result.message };
}

/** Renames a section, changes its choices, or switches it on or off. */
export async function updateSectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const input: Record<string, unknown> = { id: text(formData, "id"), label: text(formData, "label"), isActive: formData.get("isActive") === "on" };
  if (formData.has("options")) input["options"] = text(formData, "options");
  const result = await updateSection(getDb(), { id: user.id, role: user.role }, input);
  return result.ok ? done("Disimpan.") : { ok: false, message: result.message };
}

/** Adds an SOA phase. */
export async function createPhaseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await createPhase(getDb(), { id: user.id, role: user.role }, { label: text(formData, "label") });
  return result.ok ? done("Phase ditambahkan.") : { ok: false, message: result.message };
}

/** Renames an SOA phase or switches it on or off. */
export async function updatePhaseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await updatePhase(getDb(), { id: user.id, role: user.role }, { key: text(formData, "key"), label: text(formData, "label"), isActive: formData.get("isActive") === "on" });
  return result.ok ? done("Disimpan.") : { ok: false, message: result.message };
}

/** SOA saves what they wrote in the added sections of a project. Every field of the form is `section:<id>`. */
export async function saveSectionValuesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("section:") && typeof value === "string") values[name.slice("section:".length)] = value;
  }
  const result = await setSectionValues(getDb(), { id: user.id, role: user.role }, { projectId: text(formData, "projectId"), values });
  if (!result.ok) return { ok: false, message: result.message };
  const code = text(formData, "projectCode");
  if (/^HIT-PROJ-\d{3,}$/.test(code)) revalidatePath(`${PROJECTS_PATH}/${code}`);
  return { ok: true, message: result.value.changed.length === 0 ? "Tidak ada perubahan." : "Disimpan dan dicatat di change log." };
}
