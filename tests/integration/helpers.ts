import { randomBytes } from "node:crypto";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/server/auth/password";

export const TEST_PASSWORD = "integration-test-password";

let cachedHash: Promise<string> | undefined;

/** Hashing is deliberately slow, so every fixture user shares one hash of TEST_PASSWORD. */
export function testPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return cachedHash;
}

export function uniqueEmail(label = "user"): string {
  return `${label}-${randomBytes(4).toString("hex")}@example.invalid`;
}

export async function makeUser(role: Role, overrides: { email?: string; isActive?: boolean } = {}) {
  return getDb().user.create({
    data: {
      name: `Test ${role}`,
      email: overrides.email ?? uniqueEmail(role.toLowerCase()),
      passwordHash: await testPasswordHash(),
      role,
      isActive: overrides.isActive ?? true,
    },
  });
}
