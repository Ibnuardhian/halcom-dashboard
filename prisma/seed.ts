// Development/test seed: `npm run db:seed` (README › Database).
// Seed data must be synthetic, idempotent (upserts only) and never destructive:
// no deletes, truncates or resets.

import { ROLES } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { writeDevAccountsFile } from "./dev-accounts";
import { SEED_PASSWORD_ENV, seedEmailFor, seedNameFor } from "./seed-users";

const SEEDABLE_ENVIRONMENTS = new Set(["development", "test"]);

async function main(): Promise<void> {
  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !SEEDABLE_ENVIRONMENTS.has(appEnv)) {
    throw new Error(
      `Refusing to seed: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}").`,
    );
  }
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Set ${SEED_PASSWORD_ENV} in .env (at least ${PASSWORD_MIN_LENGTH} characters).`);
  }

  const db = getDb();
  let created = 0;
  for (const role of ROLES) {
    const email = seedEmailFor(role);
    // `update: {}` keeps existing accounts untouched, including passwords changed since.
    const before = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (before) continue;
    await db.user.upsert({
      where: { email },
      update: {},
      create: { name: seedNameFor(role), email, role, passwordHash: await hashPassword(password) },
    });
    created += 1;
  }
  // A sign-in cheat sheet for developers, development only (the test database has its own users).
  if (appEnv === "development") await writeDevAccountsFile(db, password);
  await db.$disconnect();
  console.log(`Seed finished for APP_ENV=${appEnv}: ${created} user(s) created, ${ROLES.length - created} already existed.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
