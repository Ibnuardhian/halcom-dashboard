// Sample projects and requests for development: `npm run db:seed:sample` (README › Database). Run `npm run db:seed` first.
// Repeatable: every record has a fixed idempotency key, so a second run adds nothing. Only adds; never deletes, resets or overwrites.

import { getDb } from "@/lib/db";
import { seedSampleDataset } from "@/server/devdata/seed-dev";
import { writeDevAccountsFile } from "./dev-accounts";

const SEEDABLE_ENVIRONMENTS = new Set(["development", "test"]);

async function main(): Promise<void> {
  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !SEEDABLE_ENVIRONMENTS.has(appEnv)) {
    throw new Error(`Refusing to seed: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}").`);
  }
  const db = getDb();
  try {
    const result = await seedSampleDataset(db, (line) => console.log(`  ${line}`));
    if (appEnv === "development") await writeDevAccountsFile(db);
    console.log(`Sample dataset finished for APP_ENV=${appEnv}: ${result.created} of ${result.projects} sample project(s) created.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
