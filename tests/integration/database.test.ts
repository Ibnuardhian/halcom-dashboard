import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

describe("database connection", () => {
  afterAll(async () => {
    await getDb().$disconnect();
  });

  it("targets the disposable test database", async () => {
    const rows = await getDb().$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;

    expect(rows).toEqual([{ name: "halcom_test" }]);
  });
});
