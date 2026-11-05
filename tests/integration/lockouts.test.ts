import { afterAll, describe, expect, it } from "vitest";
import { MAX_FAILURES } from "@/domain/access/login-throttle";
import { getDb } from "@/lib/db";
import { listLockouts, unlockLockout } from "@/server/auth/lockouts";
import { lockState, recordFailure } from "@/server/auth/login-throttle";
import { makeUser, uniqueEmail } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function lockEmail(email: string, address: string | null = null) {
  for (let attempt = 0; attempt < MAX_FAILURES.email; attempt += 1) await recordFailure(db, email, address);
}

describe("locked accounts", () => {
  it("lists a locked account with its name, failures and cooldown, and leaves out a counter that is not locked", async () => {
    const superadmin = await makeUser("SUPERADMIN");
    const locked = await makeUser("SALES");
    await lockEmail(locked.email);
    const open = uniqueEmail("not-locked");
    await recordFailure(db, open, null);

    const rows = await listLockouts(db, superadmin);

    expect(rows.find((row) => row.label === locked.email)).toMatchObject({ scope: "email", name: locked.name, failures: MAX_FAILURES.email, minutesLeft: expect.any(Number) });
    expect(rows.find((row) => row.label === locked.email)!.minutesLeft).toBeGreaterThan(0);
    expect(rows.find((row) => row.label === open)).toBeUndefined();
  });

  it("opens a lock so the person is no longer held back, and writes who did it to the audit log", async () => {
    const superadmin = await makeUser("SUPERADMIN");
    const person = await makeUser("SALES");
    await lockEmail(person.email);
    expect(await lockState(db, person.email, null)).toMatchObject({ locked: true });
    const row = (await listLockouts(db, superadmin)).find((r) => r.label === person.email)!;

    expect(await unlockLockout(db, superadmin, { id: row.id })).toEqual({ ok: true });

    expect((await listLockouts(db, superadmin)).find((r) => r.label === person.email)).toBeUndefined();
    expect(await lockState(db, person.email, null)).toMatchObject({ locked: false, minutesLeft: 0 });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "login.unlocked", actorId: superadmin.id, entityId: row.id } });
    expect(audit.before).toMatchObject({ scope: "email", key: person.email, failures: MAX_FAILURES.email });
    // Opening a lock that is already open says so instead of failing.
    expect(await unlockLockout(db, superadmin, { id: row.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("is for the superadmin only, and refuses a bad id or an inactive actor", async () => {
    const person = await makeUser("SALES");
    await lockEmail(person.email);
    const superadmin = await makeUser("SUPERADMIN");
    const row = (await listLockouts(db, superadmin)).find((r) => r.label === person.email)!;

    for (const role of ["ADMIN", "SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const other = await makeUser(role);
      await expect(listLockouts(db, other)).rejects.toThrow(/Forbidden/);
      expect(await unlockLockout(db, other, { id: row.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await unlockLockout(db, superadmin, { id: "nope" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await db.user.update({ where: { id: superadmin.id }, data: { isActive: false } });
    expect(await unlockLockout(db, superadmin, { id: row.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.loginAttempt.count({ where: { id: row.id } })).resolves.toBe(1);
  });
});
