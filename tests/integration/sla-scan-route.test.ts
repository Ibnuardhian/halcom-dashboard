import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/sla-scan/route";
import { getDb } from "@/lib/db";

const SECRET = "a-long-enough-cron-secret-0123456789";
const call = (authorization?: string) => POST(new NextRequest("http://localhost/api/internal/sla-scan", { method: "POST", headers: authorization ? { authorization } : {} }));

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe("POST /api/internal/sla-scan", () => {
  it("does not exist while CRON_SECRET is not set, or is too short to be a secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(`Bearer ${SECRET}`)).status).toBe(404);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(404);
  });

  it("refuses a missing or wrong secret without saying anything else", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const authorization of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET.slice(0, -1)]) {
      const response = await call(authorization);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    }
  });

  it("runs the scan for the right secret and answers with counts only", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["checked", "closed", "dangers", "warnings"]);
    // The scan reads every open request of the shared test database: take back the alerts it wrote for other tests' requests.
    await getDb().notification.deleteMany({ where: { kind: { in: ["sla.due_soon", "sla.overdue"] } } });
  });
});
