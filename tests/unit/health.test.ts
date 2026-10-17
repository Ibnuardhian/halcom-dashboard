import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealthReport } from "@/server/health";

describe("getHealthReport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports ok when the database responds", async () => {
    await expect(getHealthReport(async () => [{ "?column?": 1 }])).resolves.toEqual({
      status: "ok",
      checks: { database: "ok" },
    });
  });

  it("reports unavailable without leaking failure details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const report = await getHealthReport(async () => {
      throw new Error("password authentication failed for user halcom at db:5432");
    });

    expect(report).toEqual({ status: "unavailable", checks: { database: "unavailable" } });
    expect(JSON.stringify(report)).not.toMatch(/password|halcom|5432/);
    expect(log).toHaveBeenCalledOnce();
  });
});
