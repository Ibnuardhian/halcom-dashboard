"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { markAllRead, markRead } from "@/server/notifications/service";

export async function markReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = formData.get("id");
  if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) await markRead(getDb(), user.id, id);
  revalidatePath("/notifications");
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(getDb(), user.id);
  revalidatePath("/notifications");
}
