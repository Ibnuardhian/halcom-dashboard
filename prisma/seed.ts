// Development/test seed: `npm run db:seed` (README › Database): the role accounts, the development Sales team, principals, solutions and PICs.
// The sample projects and requests are a separate step: `npm run db:seed:sample`.
// Seed data must be synthetic, idempotent (finds or adds; never overwrites) and never destructive:
// no deletes, truncates or resets.

import { getDb } from "@/lib/db";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { seedAccounts, seedMasterDataAndPics } from "@/server/devdata/seed-dev";
import { writeDevAccountsFile } from "./dev-accounts";
import { SEED_PASSWORD_ENV, seedEmailFor } from "./seed-users";

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
  const { created, total } = await seedAccounts(db, password);
  // Principals, solutions and PICs, through the same services the application uses (idempotent).
  await seedMasterDataAndPics(db, seedEmailFor("ADMIN"), (line) => console.log(`  ${line}`));
  // A sign-in cheat sheet for developers, development only (the test database has its own users).
  if (appEnv === "development") await writeDevAccountsFile(db);
  await db.$disconnect();
  console.log(`Seed finished for APP_ENV=${appEnv}: ${created} user(s) created, ${total - created} already existed.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
