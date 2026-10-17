"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { BACKUPS_PATH } from "@/features/navigation/links";
import { formatBytes } from "@/features/system/format";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { createBackup } from "@/server/system/backup";

export async function createBackupAction(): Promise<FormState> {
  const user = await requirePermission("system.backup");
  const result = await createBackup(getDb(), { id: user.id, role: user.role });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(BACKUPS_PATH);
  return { ok: true, message: `Backup written: ${result.file.name} (${formatBytes(result.file.sizeBytes)}).` };
}
