import type { PrismaClient } from "@/generated/prisma/client";
import { spendPasswordCheck, verifyPassword } from "./password";
import type { SessionUser } from "./session-store";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Checks credentials. Returns null for every failure (unknown email, wrong password,
 * deactivated account) so callers cannot distinguish them.
 */
export async function authenticate(
  db: PrismaClient,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) {
    await spendPasswordCheck(password);
    return null;
  }
  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches || !user.isActive) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
