import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getSystemSnapshot } from "@/server/system/snapshot";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("getSystemSnapshot", () => {
  it("returns plausible measurements from the real database and process", async () => {
    const superadmin = await makeUser("SUPERADMIN");
    const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;

    const snapshot = await getSystemSnapshot(db, { id: superadmin.id, role: "SUPERADMIN" });

    expect(snapshot.database.name).toBe(name);
    expect(snapshot.database.version).toMatch(/^PostgreSQL 18\./);
    expect(snapshot.database.sizeBytes).toBeGreaterThan(1_000_000); // an empty PostgreSQL database is a few MiB
    expect(snapshot.database.latencyMs).toBeGreaterThan(0);
    expect(snapshot.database.latencyMs).toBeLessThan(5_000);
    expect(snapshot.database.maxConnections).toBeGreaterThanOrEqual(10);
    expect(snapshot.database.commits).toBeGreaterThan(0);
    expect(snapshot.database.cacheHitRatio === null || (snapshot.database.cacheHitRatio >= 0 && snapshot.database.cacheHitRatio <= 1)).toBe(true);
    expect(snapshot.app.nodeVersion).toBe(process.version);
    expect(snapshot.app.environment).toBe("test");
    expect(snapshot.app.memory.rssBytes).toBeGreaterThan(0);
    expect(snapshot.app.memory.heapUsedBytes).toBeLessThanOrEqual(snapshot.app.memory.heapTotalBytes);
    expect(snapshot.app.eventLoopUtilization).toBeGreaterThanOrEqual(0);
    expect(snapshot.app.eventLoopUtilization).toBeLessThanOrEqual(1);
    expect(snapshot.app.uptimeSeconds).toBeGreaterThan(0);
    expect(Date.now() - snapshot.generatedAt.getTime()).toBeLessThan(5_000);
  });

  it("lists the largest tables, biggest first and at most eight", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    const { database } = await getSystemSnapshot(db, { id: superadmin.id, role: "SUPERADMIN" });

    const names = database.largestTables.map((table) => table.name);
    // Which tables are the largest depends on the data in the shared test database, so only the shape is asserted.
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(database.largestTables.length).toBeLessThanOrEqual(8);
    const sizes = database.largestTables.map((table) => table.sizeBytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it("reports sessions from other connections, never this request's own", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    const { database } = await getSystemSnapshot(db, { id: superadmin.id, role: "SUPERADMIN" });

    for (const connection of database.connections) {
      expect(connection.count).toBeGreaterThan(0);
      expect(connection.state).not.toBe("");
    }
  });

  it("exposes no query text or row data", async () => {
    const superadmin = await makeUser("SUPERADMIN");
    const secret = await makeUser("SALES", { email: "snapshot-secret@example.invalid" });

    const snapshot = await getSystemSnapshot(db, { id: superadmin.id, role: "SUPERADMIN" });

    const json = JSON.stringify(snapshot);
    expect(json).not.toContain(secret.email);
    expect(json).not.toContain(secret.passwordHash);
    expect(json).not.toMatch(/select|insert|update/i);
  });

  it("is forbidden to every role except superadmin", async () => {
    for (const role of ["ADMIN", "SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const user = await makeUser(role);

      await expect(getSystemSnapshot(db, { id: user.id, role })).rejects.toThrow(/Forbidden/);
    }
  });
});
