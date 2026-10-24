"use server";

import type { FormState } from "@/components/ui/form-status";
import { getDb } from "@/lib/db";
import { changeOwnPassword } from "@/server/auth/account";
import { requireUser } from "@/server/auth/current-user";
import { readSessionToken } from "@/server/auth/session-cookie";

export async function changePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  // The gate page (T-9) is where a handed-over password is replaced, so this action must not be redirected away from it.
  const user = await requireUser({ allowPasswordChange: true });
  const confirmation = formData.get("confirmPassword");
  if (formData.get("newPassword") !== confirmation) {
    return { ok: false, message: "The new password and its confirmation do not match." };
  }
  const result = await changeOwnPassword(getDb(), user.id, await readSessionToken(), {
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  return result.ok
    ? { ok: true, message: "Password changed. Your other sessions were signed out." }
    : { ok: false, message: result.message };
}
