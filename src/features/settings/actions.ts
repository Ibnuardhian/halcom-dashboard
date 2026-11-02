"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { PROJECTS_PATH, SETTINGS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { saveProjectColumns, saveTaxBasis } from "@/server/settings/app-settings";
import { saveTeamSetting } from "@/server/settings/team-settings";

/** Saves one team's SLA and email template (superadmin only; the service checks it again). */
export async function saveTeamSettingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const restoreDefaults = formData.get("restoreDefaults") === "1";
  const result = await saveTeamSetting(getDb(), { id: user.id, role: user.role }, {
    role: text("role"),
    sla: text("sla"),
    emailSubject: text("emailSubject"),
    emailBody: text("emailBody"),
    emailTo: text("emailTo"),
    emailCc: text("emailCc"),
    ...(restoreDefaults ? { restoreDefaults: true } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`${SETTINGS_PATH}/soa`);
  revalidatePath(`${SETTINGS_PATH}/purchasing`);
  if (!result.changed) return { ok: true, message: "Tidak ada perubahan." };
  return { ok: true, message: restoreDefaults ? "Template bawaan dikembalikan, dan SLA disimpan." : "Tersimpan. Email dan tanggal SLA berikutnya memakai pengaturan ini." };
}

/** Saves the columns the Projects table shows (superadmin only; the service checks it again). */
export async function saveProjectColumnsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await saveProjectColumns(getDb(), { id: user.id, role: user.role }, formData.getAll("column"));
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PROJECTS_PATH);
  return { ok: true, message: result.changed ? "Tersimpan. Semua pengguna melihat kolom ini." : "Tidak ada perubahan." };
}

/** Saves whether the Estimated PO value and the margin include PPN, and the rate (superadmin only; the service checks it again). */
export async function saveTaxBasisAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const rate = String(formData.get("taxRatePercent") ?? "").trim().replace(",", ".");
  const result = await saveTaxBasis(getDb(), { id: user.id, role: user.role }, {
    valueIncludesTax: formData.get("valueIncludesTax") === "1",
    marginIncludesTax: formData.get("marginIncludesTax") === "1",
    taxRatePercent: rate === "" ? Number.NaN : Number(rate),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/", "layout");
  return { ok: true, message: result.changed ? "Tersimpan. Margin dan gross profit dihitung ulang dengan basis ini." : "Tidak ada perubahan." };
}
