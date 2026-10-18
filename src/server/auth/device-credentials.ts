import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { canRememberDevice, DEVICE_CREDENTIAL_TTL_MS, MAX_REMEMBERED_ACCOUNTS } from "@/domain/access/device";
import type { SessionUser } from "./session-store";

type Db = PrismaClient | Prisma.TransactionClient;

/** A salted SHA-256 of the token. The token is 256 bits of randomness, so this only has to stop a database leak from being usable. */
export function hashDeviceToken(salt: string, token: string): string {
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

const newToken = () => randomBytes(32).toString("base64url");
const newSalt = () => randomBytes(16).toString("base64url");

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Remembers `userId` on a browser: stores the salted hash of a new random token and returns the token and the credential id for the
 * cookie. Only for roles that may be remembered (the caller checks). Expired credentials of the user are cleaned up, and a user keeps
 * a bounded number of them.
 */
export async function issueDeviceCredential(db: Db, userId: string, now: Date = new Date()): Promise<{ id: string; token: string }> {
  const token = newToken();
  const salt = newSalt();
  const created = await db.deviceCredential.create({
    data: { userId, salt, tokenHash: hashDeviceToken(salt, token), createdAt: now, expiresAt: new Date(now.getTime() + DEVICE_CREDENTIAL_TTL_MS) },
    select: { id: true },
  });
  await db.deviceCredential.deleteMany({ where: { userId, expiresAt: { lte: now } } });
  const surplus = await db.deviceCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: MAX_REMEMBERED_ACCOUNTS * 2, select: { id: true } });
  if (surplus.length > 0) await db.deviceCredential.deleteMany({ where: { id: { in: surplus.map((row) => row.id) } } });
  return { id: created.id, token };
}

type Entry = { id: string; token: string };

/**
 * The account a cookie entry stands for, or null. Every check reads the stored record, never the cookie: the credential must exist and
 * not be expired, the token must match its salted hash, and the user must still be active and in a role that may be remembered
 * (an account that was deactivated, or became ADMIN or SUPERADMIN, is refused and its credential removed).
 */
export async function verifyDeviceCredential(db: Db, entry: Entry, now: Date = new Date()): Promise<SessionUser | null> {
  const row = await db.deviceCredential.findUnique({
    where: { id: entry.id },
    select: { id: true, salt: true, tokenHash: true, expiresAt: true, user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
  });
  if (!row) return null;
  if (row.expiresAt <= now) {
    await db.deviceCredential.deleteMany({ where: { id: row.id } });
    return null;
  }
  if (!sameHash(row.tokenHash, hashDeviceToken(row.salt, entry.token))) return null;
  if (!row.user.isActive || !canRememberDevice(row.user.role)) {
    await db.deviceCredential.deleteMany({ where: { id: row.id } });
    return null;
  }
  const { id, name, email, role } = row.user;
  return { id, name, email, role };
}

/**
 * Uses a credential to sign in: verifies it, then replaces its token with a new one, so a copied cookie works at most once. Returns the
 * user and the new token for the cookie, or null. Two uses at the same moment cannot both succeed.
 */
export async function consumeDeviceCredential(db: PrismaClient, entry: Entry, now: Date = new Date()): Promise<{ user: SessionUser; token: string } | null> {
  const user = await verifyDeviceCredential(db, entry, now);
  if (!user) return null;
  const row = await db.deviceCredential.findUnique({ where: { id: entry.id }, select: { tokenHash: true } });
  if (!row) return null;
  const token = newToken();
  const salt = newSalt();
  const { count } = await db.deviceCredential.updateMany({
    where: { id: entry.id, tokenHash: row.tokenHash },
    data: { salt, tokenHash: hashDeviceToken(salt, token), lastUsedAt: now },
  });
  return count === 1 ? { user, token } : null;
}

export async function revokeDeviceCredential(db: Db, id: string): Promise<void> {
  await db.deviceCredential.deleteMany({ where: { id } });
}

/** Ends every remembered browser of a user: used when the password changes or is reset and when the account is deactivated. */
export async function revokeUserDeviceCredentials(db: Db, userId: string): Promise<void> {
  await db.deviceCredential.deleteMany({ where: { userId } });
}
