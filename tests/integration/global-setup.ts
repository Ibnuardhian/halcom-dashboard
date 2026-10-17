import { execFileSync } from "node:child_process";

// Integration tests talk to a real database, so they only run against the
// disposable `db-test` service (APP_ENV=test), never the development database.
export default function setup(): void {
  if (process.env["APP_ENV"] !== "test") {
    throw new Error(
      `Integration tests require APP_ENV=test (got "${process.env["APP_ENV"] ?? "unset"}"). ` +
        "Run them with: docker compose --profile test run --rm app-test npm run test:integration",
    );
  }
  // Apply the committed migrations to the empty test database.
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
}
