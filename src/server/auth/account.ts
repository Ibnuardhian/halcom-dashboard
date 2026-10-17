import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword, verifyPassword } from "./password";
import { hashSessionToken } from "./session-store";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `The new password must be at most ${PASSWORD_MAX_LENGTH} characters.`),
});

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; code: "INVALID_INPUT" | "WRONG_PASSWORD" | "SAME_PASSWORD" | "FORBIDDEN" | "CONFLICT"; message: string };

/**
 * Lets a signed-in user change their own password. Every other session of the user ends; the
 * session that made the change (`keepToken`) stays signed in. The passwords are never logged or audited.
 */
export async function changeOwnPassword(
  db: PrismaClient,
  userId: string,
  keepToken: string | undefined,
  input: unknown,
): Promise<ChangePasswordResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true, isActive: true } });
  if (!user?.isActive) return { ok: false, code: "FORBIDDEN", message: "You are not allowed to do that." };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, code: "WRONG_PASSWORD", message: "The current password is incorrect." };
  }
  if (currentPassword === newPassword) {
    return { ok: false, code: "SAME_PASSWORD", message: "Choose a password different from the current one." };
  }

  const passwordHash = await hashPassword(newPassword); // slow by design: outside the transaction
  const changed = await db.$transaction(async (tx) => {
    // Only change the hash we verified: a concurrent change between the check and now must not be overwritten.
    const updated = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash } });
    if (updated.count !== 1) return false;
    await tx.session.deleteMany({
      where: { userId: user.id, ...(keepToken ? { tokenHash: { not: hashSessionToken(keepToken) } } : {}) },
    });
    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "user.password_changed",
        entityType: "user",
        entityId: user.id,
        before: Prisma.JsonNull,
        after: Prisma.JsonNull,
      },
    });
    return true;
  });
  if (!changed) return { ok: false, code: "CONFLICT", message: "Your password was changed elsewhere. Try again." };
  return { ok: true };
}
