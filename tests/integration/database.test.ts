import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { INTEGRATION_DB_PREFIX } from "./global-setup";

describe("database connection", () => {
  afterAll(async () => {
    await getDb().$disconnect();
  });

  it("targets this run's own throwaway database, never a shared one", async () => {
    const rows = await getDb().$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;

    expect(rows[0]?.name).toMatch(new RegExp(`^${INTEGRATION_DB_PREFIX}[0-9a-f]{12}$`));
  });
});
