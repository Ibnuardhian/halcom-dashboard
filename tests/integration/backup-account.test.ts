import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { changeOwnPassword } from "@/server/auth/account";
import { authenticate } from "@/server/auth/authenticate";
import { createSession, findSessionUser } from "@/server/auth/session-store";
import { createBackup, listBackups, pgEnvFromUrl, type Exec } from "@/server/system/backup";
import { makeUser, TEST_PASSWORD } from "./helpers";

const db = getDb();
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "halcom-backup-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

describe("createBackup", () => {
  it("writes a restorable dump of the real database, lists it and records an audit event", async () => {
    const superadmin = await actorOf("SUPERADMIN");

    const result = await createBackup(db, superadmin, { dir, now: new Date("2026-10-17T15:30:00Z") });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.name).toBe("halcom-20261017-153000Z.dump");
    expect(result.file.sizeBytes).toBeGreaterThan(1000);
    const header = (await readFile(path.join(dir, result.file.name))).subarray(0, 5).toString("latin1");
    expect(header).toBe("PGDMP"); // custom-format archive signature
    expect(await readdir(dir)).toEqual(["halcom-20261017-153000Z.dump"]); // no .partial left behind

    const listed = await listBackups(dir);
    expect(listed.ok && listed.files.map((f) => f.name)).toEqual(["halcom-20261017-153000Z.dump"]);
    const events = await db.auditEvent.findMany({ where: { entityType: "system", entityId: result.file.name } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: superadmin.id, action: "system.backup_created" });
  });

  it("never overwrites an existing backup", async () => {
    const superadmin = await actorOf("SUPERADMIN");
    const now = new Date("2026-10-18T08:00:00Z");
    const first = await createBackup(db, superadmin, { dir, now });
    expect(first.ok).toBe(true);
    const before = await readFile(path.join(dir, "halcom-20261018-080000Z.dump"));

    const second = await createBackup(db, superadmin, { dir, now });

    expect(second).toMatchObject({ ok: false, code: "FAILED" });
    expect(await readFile(path.join(dir, "halcom-20261018-080000Z.dump"))).toEqual(before);
  });

  it("is limited to active superadmins", async () => {
    for (const role of ["ADMIN", "SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await createBackup(db, await actorOf(role), { dir })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const gone = await makeUser("SUPERADMIN", { isActive: false });
    expect(await createBackup(db, { id: gone.id, role: "SUPERADMIN" }, { dir })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("removes the partial file and reports a short message when pg_dump fails", async () => {
    const superadmin = await actorOf("SUPERADMIN");
    const failing: Exec = async (_file, args) => {
      await writeFile(args[args.length - 1]!, "half written");
      throw Object.assign(new Error("Command failed: pg_dump --password hunter2"), {
        stderr: "pg_dump: error: connection failed\nmore detail",
      });
    };

    const result = await createBackup(db, superadmin, { dir, now: new Date("2026-10-19T00:00:00Z"), exec: failing });

    expect(result).toMatchObject({ ok: false, code: "FAILED", message: "The backup failed: pg_dump: error: connection failed" });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect((await readdir(dir)).filter((name) => name.includes("20261019"))).toEqual([]);
  });

  it("passes the connection settings through the environment, not the command line", async () => {
    const superadmin = await actorOf("SUPERADMIN");
    const calls: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
    const recording: Exec = async (_file, args, options) => {
      calls.push({ args, env: options.env });
      if (args[0] === "--format=custom") await writeFile(args[args.length - 1]!, "PGDMP-fake");
    };

    const result = await createBackup(db, superadmin, {
      dir,
      now: new Date("2026-10-20T00:00:00Z"),
      databaseUrl: "postgresql://app:p%40ss@db.internal:5433/halcom",
      exec: recording,
    });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.args[0])).toEqual(["--format=custom", "--list"]); // dump, then verification
    expect(calls[0]!.env).toMatchObject({ PGHOST: "db.internal", PGPORT: "5433", PGUSER: "app", PGPASSWORD: "p@ss", PGDATABASE: "halcom" });
    expect(calls.flatMap((c) => [...c.args]).join(" ")).not.toContain("p@ss");
  });

  it("reports a missing folder instead of throwing", async () => {
    const missing = path.join(dir, "does-not-exist");
    expect(await listBackups(missing)).toMatchObject({ ok: false, error: expect.stringContaining("not mounted") });
    expect(pgEnvFromUrl("postgresql://u:pw@h/db")).toMatchObject({ PGPORT: "5432" });
  });
});

describe("changeOwnPassword", () => {
  const NEW_PASSWORD = "a-brand-new-password-2";

  it("changes the password, keeps the current session, ends the others and writes an audit event without the password", async () => {
    const user = await makeUser("SALES");
    const current = await createSession(db, user.id);
    const other = await createSession(db, user.id);

    const result = await changeOwnPassword(db, user.id, current.token, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(result).toEqual({ ok: true });
    await expect(authenticate(db, user.email, NEW_PASSWORD)).resolves.toMatchObject({ id: user.id });
    await expect(authenticate(db, user.email, TEST_PASSWORD)).resolves.toBeNull();
    await expect(findSessionUser(db, current.token)).resolves.toMatchObject({ id: user.id });
    await expect(findSessionUser(db, other.token)).resolves.toBeNull();
    const events = await db.auditEvent.findMany({ where: { entityType: "user", entityId: user.id, action: "user.password_changed" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
  });

  it("rejects a wrong current password, an unchanged password and a weak one, leaving everything as it was", async () => {
    const user = await makeUser("SALES");
    const session = await createSession(db, user.id);

    expect(await changeOwnPassword(db, user.id, session.token, { currentPassword: "wrong-password-123", newPassword: NEW_PASSWORD })).toMatchObject({
      ok: false,
      code: "WRONG_PASSWORD",
    });
    expect(await changeOwnPassword(db, user.id, session.token, { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD })).toMatchObject({
      ok: false,
      code: "SAME_PASSWORD",
    });
    expect(await changeOwnPassword(db, user.id, session.token, { currentPassword: TEST_PASSWORD, newPassword: "short" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    await expect(authenticate(db, user.email, TEST_PASSWORD)).resolves.toMatchObject({ id: user.id });
    await expect(db.auditEvent.count({ where: { entityId: user.id, action: "user.password_changed" } })).resolves.toBe(0);
  });

  it("refuses a deactivated user", async () => {
    const user = await makeUser("SALES", { isActive: false });
    expect(await changeOwnPassword(db, user.id, undefined, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
});
