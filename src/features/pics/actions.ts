"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { PICS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { createPic, updatePic } from "@/server/pics/service";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Adds a PIC to SOA or Purchasing. */
export async function createPicAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await createPic(getDb(), { id: user.id, role: user.role }, { team: text(formData, "team"), name: text(formData, "name") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PICS_PATH);
  return { ok: true, message: `${result.value.name} ditambahkan.` };
}

/** Renames a PIC. */
export async function renamePicAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await updatePic(getDb(), { id: user.id, role: user.role }, { id: text(formData, "id"), name: text(formData, "name") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PICS_PATH);
  return { ok: true, message: "Tersimpan." };
}

/** Turns a PIC on or off. Requests and history that mention it are kept. */
export async function setPicActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const active = text(formData, "active") === "true";
  const result = await updatePic(getDb(), { id: user.id, role: user.role }, { id: text(formData, "id"), isActive: active });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PICS_PATH);
  return { ok: true, message: active ? "Activated." : "Deactivated." };
}
