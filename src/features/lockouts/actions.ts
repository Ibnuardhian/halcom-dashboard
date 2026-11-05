"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { LOCKOUTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { unlockLockout } from "@/server/auth/lockouts";

/** Opens one sign-in lock. */
export async function unlockAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = formData.get("id");
  const result = await unlockLockout(getDb(), { id: user.id, role: user.role }, { id: typeof id === "string" ? id : "" });
  revalidatePath(LOCKOUTS_PATH);
  return result.ok ? { ok: true, message: "Kunci dibuka." } : { ok: false, message: result.message };
}
