"use server";

import { revalidatePath } from "next/cache";
import { isNotificationSeverity } from "@/domain/notifications/severity";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { markAllRead, markRead } from "@/server/notifications/service";

export async function markReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formData.get("id");
  if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) await markRead(getDb(), user.id, id);
  revalidatePath("/notifications");
}

/** Reads every unread notification, or only those of one level when the form names it (the tab the person is on). */
export async function markAllReadAction(formData?: FormData): Promise<void> {
  const user = await requireUser();
  const severity = formData?.get("severity");
  await markAllRead(getDb(), user.id, isNotificationSeverity(severity) ? severity : undefined);
  revalidatePath("/notifications");
}
