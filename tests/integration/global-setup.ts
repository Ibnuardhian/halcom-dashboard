import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export const INTEGRATION_DB_PREFIX = "halcom_it_";

/**
 * Integration tests talk to a real database, so they only run inside the disposable
 * `db-test` service (APP_ENV=test), never against the development database.
 * Each run gets its own empty database there, so runs cannot interfere with each other
 * or with the data the E2E stack seeds into `halcom_test`. The throwaway server's data
 * lives in tmpfs and disappears when the container stops; nothing is dropped.
 */
export default async function setup(): Promise<void> {
  const baseUrl = process.env["DATABASE_URL"];
  if (process.env["APP_ENV"] !== "test" || !baseUrl) {
    throw new Error(
      `Integration tests require APP_ENV=test and DATABASE_URL (got APP_ENV="${process.env["APP_ENV"] ?? "unset"}"). ` +
        "Run them with: docker compose --profile test run --rm app-test npm run test:integration",
    );
  }

  const name = `${INTEGRATION_DB_PREFIX}${randomBytes(6).toString("hex")}`; // generated here, so safe to interpolate
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: baseUrl }) });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  process.env["DATABASE_URL"] = url.toString();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
}
