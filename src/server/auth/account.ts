import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword, verifyPassword } from "./password";
import { hashSessionToken } from "./session-store";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Masukkan kata sandi Anda saat ini.").max(PASSWORD_MAX_LENGTH),
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
  if (!user?.isActive) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, code: "WRONG_PASSWORD", message: "Kata sandi saat ini salah." };
  }
  if (currentPassword === newPassword) {
    return { ok: false, code: "SAME_PASSWORD", message: "Pilih kata sandi yang berbeda dari yang sekarang." };
  }

  const passwordHash = await hashPassword(newPassword); // slow by design: outside the transaction
  const changed = await db.$transaction(async (tx) => {
    // Only change the hash we verified: a concurrent change between the check and now must not be overwritten.
    // The password is now the person's own, so the first-sign-in gate (T-9) is done with.
    const updated = await tx.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash }, data: { passwordHash, mustChangePassword: false } });
    if (updated.count !== 1) return false;
    await tx.session.deleteMany({
      where: { userId: user.id, ...(keepToken ? { tokenHash: { not: hashSessionToken(keepToken) } } : {}) },
    });
    // A browser that remembered this account must not get in with the old password's trust.
    await tx.deviceCredential.deleteMany({ where: { userId: user.id } });
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
  if (!changed) return { ok: false, code: "CONFLICT", message: "Kata sandi Anda diubah di tempat lain. Coba lagi." };
  return { ok: true };
}
