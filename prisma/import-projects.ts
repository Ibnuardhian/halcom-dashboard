// Loads a sales-export CSV into the development or test database:
//   docker compose run --rm app npm run db:import-projects -- [file.csv] [--dry-run]
// It only adds (README › Importing projects): existing projects, users and passwords are never changed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { importProjects } from "@/server/import/import-projects";
import { parseProjectsCsv } from "@/server/import/projects-csv";
import { writeDevAccountsFile } from "./dev-accounts";
import { SEED_PASSWORD_ENV } from "./seed-users";

const DEFAULT_FILE = "prisma/data/projects_export_2026-10-17.csv";
const IMPORTABLE_ENVIRONMENTS = new Set(["development", "test"]);

async function main(): Promise<void> {
  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !IMPORTABLE_ENVIRONMENTS.has(appEnv)) {
    throw new Error(
      `Refusing to import: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}"). A production import needs its own reviewed procedure.`,
    );
  }
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_FILE;
  const password = process.env[SEED_PASSWORD_ENV];
  if (!dryRun && (!password || password.length < PASSWORD_MIN_LENGTH)) {
    throw new Error(`Set ${SEED_PASSWORD_ENV} in .env (at least ${PASSWORD_MIN_LENGTH} characters): it is the password of the new accounts.`);
  }

  const { rows, problems } = parseProjectsCsv(await readFile(file, "utf8"));
  if (problems.length > 0) {
    console.error(`${file} has ${problems.length} problem(s); nothing was imported:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const summary = await importProjects(db, rows, { source: path.basename(file), password: password ?? "", dryRun });
  console.log(`${summary.dryRun ? "Dry run (nothing written)" : "Imported"}: ${path.basename(file)}, ${rows.length} project(s) in the file.`);
  console.log(`  projects: ${summary.projectsToCreate.length} new, ${summary.projectsExisting.length} already present (left untouched)`);
  console.log(`  users:    ${summary.usersToCreate.length} new${summary.usersToCreate.length ? ` [${summary.usersToCreate.join(", ")}]` : ""}, ${summary.usersExisting.length} already present`);
  console.log(`  master data ${summary.dryRun ? "to add" : "added"}: ${summary.customers} customer(s), ${summary.principals} principal(s), ${summary.solutionCategories} solution categorie(s)`);
  if (!summary.dryRun && appEnv === "development") await writeDevAccountsFile(db, password!);
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
