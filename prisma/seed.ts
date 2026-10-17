// Development/test seed: `npm run db:seed` (README › Database).
// Seed data must be synthetic, idempotent (upserts only) and never destructive:
// no deletes, truncates or resets.

const SEEDABLE_ENVIRONMENTS = new Set(["development", "test"]);

function main(): void {
  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !SEEDABLE_ENVIRONMENTS.has(appEnv)) {
    throw new Error(
      `Refusing to seed: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}").`,
    );
  }

  // No domain models exist yet. Add idempotent upserts of synthetic records here
  // once the schema is agreed.
  console.log(`Seed finished for APP_ENV=${appEnv}: no domain models yet, nothing to seed.`);
}

main();
