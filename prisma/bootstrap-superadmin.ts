// Creates the very first superadmin of a database that has none (T-8), the one account the seed cannot make because it refuses to
// run outside development and test:
//   BOOTSTRAP_EMAIL=... BOOTSTRAP_NAME=... BOOTSTRAP_PASSWORD=... npm run db:bootstrap-superadmin [-- --dry-run]
//
// Run it once, from a machine that can reach the database (locally against Neon's direct URL, or from a deployment job). It refuses
// as soon as any superadmin exists, so it cannot be used a second time to slip an account in. The password is read from the
// environment, never from the command line, so it stays out of the shell history and the process list; the account has to replace it
// at its first sign-in, and the creation is in the audit log as `user.bootstrapped`.

import { getDb } from "@/lib/db";
import { bootstrapFirstSuperadmin } from "@/server/auth/bootstrap";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const input = { name: process.env["BOOTSTRAP_NAME"] ?? "", email: process.env["BOOTSTRAP_EMAIL"] ?? "", password: process.env["BOOTSTRAP_PASSWORD"] ?? "" };
  if (!input.name || !input.email || !input.password) {
    throw new Error("Set BOOTSTRAP_NAME, BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD in the environment.");
  }

  const db = getDb();
  try {
    const result = await bootstrapFirstSuperadmin(db, input, { dryRun });
    if (!result.ok) throw new Error(result.message);
    if (result.created) {
      console.log(`Created the first superadmin: ${result.email}`);
      console.log("Sign in with it once: the application asks for a new password before anything else opens.");
      return;
    }
    if (result.existing.length > 0) {
      console.log(`This database already has ${result.existing.length} superadmin account(s): ${result.existing.join(", ")}.`);
      console.log("Nothing was created. Add any further account on the Users page.");
      return;
    }
    console.log(`Dry run: would create the superadmin ${input.name} <${input.email}>, which must choose its own password at the first sign-in.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
