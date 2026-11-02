"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { parseCellKey } from "@/domain/access/permission-catalog";
import { PERMISSIONS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { savePermissionChanges } from "@/server/permissions/service";

/**
 * Saves the permission editor. The form lists the cells it showed as editable (`rendered`) and the ones ticked (`grant`); a cell that
 * is shown but not ticked is revoked, a cell the form did not show is left alone, so a stale page cannot revoke a permission it never listed.
 * Only a user who holds `permissions.manage` gets this far, and the service checks the stored account again.
 */
export async function savePermissionsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission("permissions.manage");
  const rendered = String(formData.get("rendered") ?? "").split(" ").filter(Boolean);
  const ticked = new Set(formData.getAll("grant").map(String));
  const changes = rendered.map((cell) => {
    return { ...parseCellKey(cell), granted: ticked.has(cell) };
  });
  if (changes.length === 0) return { ok: false, message: "Belum ada perubahan untuk disimpan." };

  const result = await savePermissionChanges(getDb(), { id: user.id, role: user.role }, { changes });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/", "layout");
  revalidatePath(PERMISSIONS_PATH);
  return { ok: true, message: result.changed === 0 ? "No changes to save." : `Saved ${result.changed} change${result.changed === 1 ? "" : "s"}.` };
}
