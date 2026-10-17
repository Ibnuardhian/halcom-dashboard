"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { SETTINGS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
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
    ...(restoreDefaults ? { restoreDefaults: true } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(SETTINGS_PATH);
  if (!result.changed) return { ok: true, message: "Nothing changed." };
  return { ok: true, message: restoreDefaults ? "The default template is back, and the SLA is saved." : "Saved. New emails and SLA dates use these settings." };
}
