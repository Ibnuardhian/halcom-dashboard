import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/domain/access/roles";

type Db = PrismaClient | Prisma.TransactionClient;

/** Absolute lifetime of a login. Not extended by activity (assumption in docs/requirements/RBAC.md). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionUser = { id: string; name: string; email: string; role: Role };

/** Only this hash is stored, so a database leak does not expose usable cookies. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: hashSessionToken(token), userId, createdAt: now, expiresAt },
  });
  // Housekeeping only: expired sessions are already unusable.
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  return { token, expiresAt };
}

/** Resolves a cookie token to its user. Expired sessions and deactivated users resolve to null. */
export async function findSessionUser(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { expiresAt: true, user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
  });
  if (!session || session.expiresAt <= now || !session.user.isActive) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
