"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { USERS_PATH } from "@/features/navigation/links";
import {
  changeUserRole,
  createUser,
  resetUserPassword,
  setUserActive,
  type UserResult,
} from "@/server/users/service";

export type ActionState = { ok: boolean; message: string } | null;

function toState(result: UserResult<unknown>, successMessage: string): ActionState {
  if (result.ok) {
    revalidatePath(USERS_PATH);
    return { ok: true, message: successMessage };
  }
  return { ok: false, message: result.message };
}

// Each action re-checks the permission on the server; the service then checks the
// target-specific rules inside its transaction.
async function actor() {
  const user = await requirePermission("users.manage");
  return { id: user.id, role: user.role };
}

export async function createUserAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await createUser(getDb(), await actor(), {
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  return toState(result, "User created.");
}

export async function changeRoleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await changeUserRole(getDb(), await actor(), String(formData.get("userId")), formData.get("role"));
  return toState(result, "Role updated.");
}

export async function setActiveAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const activate = formData.get("active") === "true";
  const result = await setUserActive(getDb(), await actor(), String(formData.get("userId")), activate);
  return toState(result, activate ? "User reactivated." : "User deactivated.");
}

export async function resetPasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await resetUserPassword(getDb(), await actor(), String(formData.get("userId")), {
    password: formData.get("password"),
  });
  return toState(result, "Password reset. The user was signed out everywhere.");
}
