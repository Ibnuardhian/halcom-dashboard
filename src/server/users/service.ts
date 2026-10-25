import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can, canAssignRole, canManageUser } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { hashPassword } from "@/server/auth/password";
import { revokeAllSessions } from "@/server/auth/session-store";
import { createUserSchema, resetPasswordSchema, roleSchema, uuidSchema } from "./schemas";

export type Actor = { id: string; role: Role };

const ERROR_MESSAGES = {
  FORBIDDEN: "Anda tidak diizinkan melakukan ini.",
  NOT_FOUND: "User tidak ditemukan.",
  EMAIL_TAKEN: "A user with this email already exists.",
  SELF_CHANGE: "You cannot change your own account here.",
  INVALID_INPUT: "The submitted data is invalid.",
} as const;

export type UserErrorCode = keyof typeof ERROR_MESSAGES;

export type UserResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; code: UserErrorCode; message: string };

function fail(code: UserErrorCode, message: string = ERROR_MESSAGES[code]): UserResult<never> {
  return { ok: false, code, message };
}

function succeed<T>(value: T): UserResult<T> {
  return { ok: true, value };
}

type Tx = Prisma.TransactionClient;

/**
 * Starts an account-administration transaction step: serialises concurrent
 * administration and re-reads the actor from the database. The caller's claimed
 * role is only a fast pre-check; decisions use the stored role, so an actor who was
 * demoted or deactivated a moment ago cannot act on a stale session.
 *
 * Because only a superadmin may change a superadmin and nobody may change their own
 * account here, an active superadmin always remains.
 */
async function beginAdministration(tx: Tx, claimed: Actor): Promise<Actor | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('halcom.user-administration'))`;
  const actor = await tx.user.findUnique({
    where: { id: claimed.id },
    select: { id: true, role: true, isActive: true },
  });
  return actor?.isActive ? { id: actor.id, role: actor.role } : null;
}

function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue | null,
) {
  return tx.auditEvent.create({
    data: {
      actorId: actor.id,
      action,
      entityType: "user",
      entityId,
      before: before ?? Prisma.JsonNull,
      after: after ?? Prisma.JsonNull,
    },
  });
}

export async function createUser(
  db: PrismaClient,
  claimedActor: Actor,
  input: unknown,
): Promise<UserResult<{ id: string }>> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  const { name, email, role, password } = parsed.data;
  if (!canAssignRole(claimedActor.role, role)) return fail("FORBIDDEN");

  const passwordHash = await hashPassword(password); // slow by design: keep it outside the transaction
  try {
    return await db.$transaction(async (tx) => {
      const actor = await beginAdministration(tx, claimedActor);
      if (!actor || !canAssignRole(actor.role, role)) return fail("FORBIDDEN");

      // An administrator chose this password and has to pass it on, so the person replaces it at their first sign-in (T-9).
      const user = await tx.user.create({ data: { name, email, role, passwordHash, mustChangePassword: true } });
      await audit(tx, actor, "user.created", user.id, null, { email, role });
      return succeed({ id: user.id });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("EMAIL_TAKEN");
    }
    throw error;
  }
}

export async function changeUserRole(
  db: PrismaClient,
  claimedActor: Actor,
  userId: string,
  newRole: unknown,
): Promise<UserResult> {
  const id = uuidSchema.safeParse(userId);
  const role = roleSchema.safeParse(newRole);
  if (!id.success || !role.success) return fail("INVALID_INPUT");
  if (!can(claimedActor.role, "users.manage")) return fail("FORBIDDEN");
  if (id.data === claimedActor.id) return fail("SELF_CHANGE");

  return db.$transaction(async (tx) => {
    const actor = await beginAdministration(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN");
    const target = await tx.user.findUnique({ where: { id: id.data } });
    if (!target) return fail("NOT_FOUND");
    if (!canManageUser(actor.role, target.role) || !canAssignRole(actor.role, role.data)) return fail("FORBIDDEN");
    if (target.role === role.data) return succeed(undefined);

    await tx.user.update({ where: { id: target.id }, data: { role: role.data } });
    await audit(tx, actor, "user.role_changed", target.id, { role: target.role }, { role: role.data });
    return succeed(undefined);
  });
}

export async function setUserActive(
  db: PrismaClient,
  claimedActor: Actor,
  userId: string,
  isActive: boolean,
): Promise<UserResult> {
  const id = uuidSchema.safeParse(userId);
  if (!id.success) return fail("INVALID_INPUT");
  if (!can(claimedActor.role, "users.manage")) return fail("FORBIDDEN");
  if (id.data === claimedActor.id) return fail("SELF_CHANGE");

  return db.$transaction(async (tx) => {
    const actor = await beginAdministration(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN");
    const target = await tx.user.findUnique({ where: { id: id.data } });
    if (!target) return fail("NOT_FOUND");
    if (!canManageUser(actor.role, target.role)) return fail("FORBIDDEN");
    if (target.isActive === isActive) return succeed(undefined);

    await tx.user.update({ where: { id: target.id }, data: { isActive } });
    if (!isActive) await revokeAllSessions(tx, target.id);
    await audit(
      tx,
      actor,
      isActive ? "user.reactivated" : "user.deactivated",
      target.id,
      { isActive: target.isActive },
      { isActive },
    );
    return succeed(undefined);
  });
}

/** Admin-initiated password reset. Signs the user out everywhere; the new password is never logged or audited. */
export async function resetUserPassword(
  db: PrismaClient,
  claimedActor: Actor,
  userId: string,
  input: unknown,
): Promise<UserResult> {
  const id = uuidSchema.safeParse(userId);
  const parsed = resetPasswordSchema.safeParse(input);
  if (!id.success) return fail("INVALID_INPUT");
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "users.manage")) return fail("FORBIDDEN");
  if (id.data === claimedActor.id) return fail("SELF_CHANGE");

  const passwordHash = await hashPassword(parsed.data.password);
  return db.$transaction(async (tx) => {
    const actor = await beginAdministration(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN");
    const target = await tx.user.findUnique({ where: { id: id.data } });
    if (!target) return fail("NOT_FOUND");
    if (!canManageUser(actor.role, target.role)) return fail("FORBIDDEN");

    await tx.user.update({ where: { id: target.id }, data: { passwordHash, mustChangePassword: true } });
    await revokeAllSessions(tx, target.id);
    await audit(tx, actor, "user.password_reset", target.id, null, null);
    return succeed(undefined);
  });
}
