import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { lockMinutesLeft, type ThrottleScope } from "@/domain/access/login-throttle";

type Actor = { id: string; role: Role };

export type LockoutRow = {
  id: string;
  scope: ThrottleScope;
  /** The e-mail that was typed, or the last characters of the hashed address (the address itself is never stored). */
  label: string;
  /** The account's name when the e-mail belongs to one; null for an unknown e-mail or an address. */
  name: string | null;
  failures: number;
  lockedUntil: Date;
  minutesLeft: number;
};

/** Every sign-in lock that is still running, the longest first. For the superadmin who opens them. */
export async function listLockouts(db: PrismaClient, viewer: Actor, now: Date = new Date()): Promise<LockoutRow[]> {
  if (!can(viewer.role, "logins.manage")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.loginAttempt.findMany({ where: { lockedUntil: { gt: now } }, orderBy: { lockedUntil: "desc" } });
  const users = await db.user.findMany({ where: { email: { in: rows.filter((row) => row.scope === "email").map((row) => row.key) } }, select: { email: true, name: true } });
  const names = new Map(users.map((user) => [user.email, user.name]));
  return rows.map((row) => ({
    id: row.id,
    scope: row.scope as ThrottleScope,
    label: row.scope === "email" ? row.key : `…${row.key.slice(-8)}`,
    name: row.scope === "email" ? (names.get(row.key) ?? null) : null,
    failures: row.failures,
    lockedUntil: row.lockedUntil!,
    minutesLeft: lockMinutesLeft(row, now),
  }));
}

export type UnlockResult = { ok: true } | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"; message: string };

/**
 * Opens one lock: the counter is deleted, so the person may try again at once and counts from zero. The signed-in actor is re-read
 * inside the transaction, and who opened which lock is written to the audit log with it.
 */
export async function unlockLockout(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<UnlockResult> {
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Kunci tidak dikenali." };
  if (!can(claimedActor.role, "logins.manage")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "logins.manage")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." } satisfies UnlockResult;
    const row = await tx.loginAttempt.findUnique({ where: { id: parsed.data.id } });
    if (!row) return { ok: false, code: "NOT_FOUND", message: "Kunci ini sudah terbuka." } satisfies UnlockResult;
    await tx.loginAttempt.delete({ where: { id: row.id } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "login.unlocked",
        entityType: "login_attempt",
        entityId: row.id,
        before: { scope: row.scope, key: row.scope === "email" ? row.key : `…${row.key.slice(-8)}`, failures: row.failures, lockedUntil: row.lockedUntil?.toISOString() ?? null } as Prisma.InputJsonValue,
        after: Prisma.JsonNull,
      },
    });
    return { ok: true } satisfies UnlockResult;
  });
}
