import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_FAILURES, WINDOW_MINUTES } from "@/domain/access/login-throttle";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
import { bootstrapFirstSuperadmin } from "@/server/auth/bootstrap";
import { changeOwnPassword } from "@/server/auth/account";
import { addressKey, clearFailures, clientAddress, keysFor, lockState, purgeColdAttempts, recordFailure } from "@/server/auth/login-throttle";
import { createUser, resetUserPassword } from "@/server/users/service";
import { makeUser, TEST_PASSWORD, uniqueEmail } from "./helpers";

const db = getDb();
const MINUTE = 60_000;

afterAll(async () => {
  await db.$disconnect();
});

const freshEmail = () => uniqueEmail("throttle");
const freshAddress = () => `203.0.113.${1 + Math.floor(Math.random() * 250)}-${randomBytes(3).toString("hex")}`;

describe("the sign-in throttle (T-7)", () => {
  it("locks an e-mail after five failures and says how long is left, then lets it in again when the lock is over", async () => {
    const email = freshEmail();
    const address = freshAddress();
    const now = new Date();

    for (let attempt = 1; attempt < MAX_FAILURES.email; attempt += 1) {
      const state = await recordFailure(db, email, address, now);
      expect(state.locked).toBe(false);
    }
    expect(await lockState(db, email, address, now)).toMatchObject({ locked: false, minutesLeft: 0 });

    const last = await recordFailure(db, email, address, now);
    expect(last.locked).toBe(true);
    expect(last.minutesLeft).toBe(15);
    expect(await lockState(db, email, address, now)).toMatchObject({ locked: true, minutesLeft: 15 });

    // While it lasts, and no longer.
    expect((await lockState(db, email, address, new Date(now.getTime() + 14 * MINUTE))).locked).toBe(true);
    expect((await lockState(db, email, address, new Date(now.getTime() + 16 * MINUTE))).locked).toBe(false);
  });

  it("counts an address that does not belong to an account exactly the same, so a lock never says which addresses are real", async () => {
    const [real, unknown] = [freshEmail(), freshEmail()];
    await makeUser("SALES", { email: real });
    const address = freshAddress();
    const now = new Date();

    for (let attempt = 0; attempt < MAX_FAILURES.email; attempt += 1) {
      await recordFailure(db, real, null, now);
      await recordFailure(db, unknown, null, now);
    }

    const forReal = await lockState(db, real, address, now);
    const forUnknown = await lockState(db, unknown, address, now);
    expect(forReal).toEqual(forUnknown);
    expect(forReal.locked).toBe(true);
  });

  it("counts the client address as well, so one password cannot be sprayed over many accounts", async () => {
    const address = freshAddress();
    const now = new Date();
    for (let attempt = 0; attempt < MAX_FAILURES.ip; attempt += 1) await recordFailure(db, freshEmail(), address, now);

    // Each e-mail was tried once, far below its own limit; the address is what stops it.
    const victim = freshEmail();
    expect((await lockState(db, victim, null, now)).locked).toBe(false);
    expect((await lockState(db, victim, address, now)).locked).toBe(true);
  });

  it("forgets a run of failures once a window passes without one", async () => {
    const email = freshEmail();
    const now = new Date();
    for (let attempt = 0; attempt < MAX_FAILURES.email - 1; attempt += 1) await recordFailure(db, email, null, now);

    const later = new Date(now.getTime() + (WINDOW_MINUTES + 1) * MINUTE);
    const state = await recordFailure(db, email, null, later);

    expect(state.locked).toBe(false);
    const row = await db.loginAttempt.findUniqueOrThrow({ where: { scope_key: { scope: "email", key: email } } });
    expect(row.failures).toBe(1);
  });

  it("clears both counters on a successful sign-in, and drops counters nobody is watching any more", async () => {
    const email = freshEmail();
    const address = freshAddress();
    const now = new Date();
    await recordFailure(db, email, address, now);
    expect(await db.loginAttempt.count({ where: { OR: keysFor(email, address) } })).toBe(2);

    await clearFailures(db, email, address);
    expect(await db.loginAttempt.count({ where: { OR: keysFor(email, address) } })).toBe(0);

    // A cold counter of someone else is purged; a live one and a running lock are kept.
    const cold = freshEmail();
    const warm = freshEmail();
    await recordFailure(db, cold, null, new Date(now.getTime() - 60 * MINUTE));
    await recordFailure(db, warm, null, now);
    await purgeColdAttempts(db, now);
    expect(await db.loginAttempt.count({ where: { scope: "email", key: cold } })).toBe(0);
    expect(await db.loginAttempt.count({ where: { scope: "email", key: warm } })).toBe(1);
  });

  it("stores an address only as a hash, and reads it from the proxy headers", () => {
    const key = addressKey("198.51.100.7");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("198.51.100.7");
    expect(keysFor("Person@Example.Invalid", null)).toEqual([{ scope: "email", key: "person@example.invalid" }]);

    expect(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe("a password somebody else chose must be replaced (T-9)", () => {
  async function admin() {
    const user = await makeUser("ADMIN");
    return { id: user.id, role: user.role };
  }

  it("flags an account an administrator creates, and the person clears it by choosing their own password", async () => {
    const actor = await admin();
    const email = uniqueEmail("created");

    const created = await createUser(db, actor, { name: "New Person", email, role: "SALES", password: "handed-over-01" });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : "";
    expect(await db.user.findUniqueOrThrow({ where: { id }, select: { mustChangePassword: true } })).toEqual({ mustChangePassword: true });

    // The flag reaches the session, which is what the redirect is made of.
    expect(await authenticate(db, email, "handed-over-01")).toMatchObject({ mustChangePassword: true });

    const changed = await changeOwnPassword(db, id, undefined, { currentPassword: "handed-over-01", newPassword: "chosen-by-me-01" });
    expect(changed.ok).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id }, select: { mustChangePassword: true } })).toEqual({ mustChangePassword: false });
    expect(await authenticate(db, email, "chosen-by-me-01")).toMatchObject({ mustChangePassword: false });
  });

  it("flags the account again when an administrator resets its password", async () => {
    const actor = await admin();
    const target = await makeUser("PURCHASING");
    expect(target.mustChangePassword).toBe(false);

    expect((await resetUserPassword(db, actor, target.id, { password: "reset-by-admin-1" })).ok).toBe(true);

    expect(await db.user.findUniqueOrThrow({ where: { id: target.id }, select: { mustChangePassword: true } })).toEqual({ mustChangePassword: true });
  });

  it("leaves an account that changes its own password alone", async () => {
    const user = await makeUser("SOA");
    expect((await changeOwnPassword(db, user.id, undefined, { currentPassword: TEST_PASSWORD, newPassword: "my-own-choice-1" })).ok).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { mustChangePassword: true } })).toEqual({ mustChangePassword: false });
  });
});

describe("the first superadmin (T-8)", () => {
  /** The shared test database already has superadmins, so each case gets a database of its own view: none, then one. */
  async function withoutSuperadmins<T>(run: () => Promise<T>): Promise<T> {
    const present = await db.user.findMany({ where: { role: "SUPERADMIN" }, select: { id: true, role: true } });
    await db.$executeRaw`UPDATE users SET role = 'ADMIN' WHERE role = 'SUPERADMIN'`;
    try {
      return await run();
    } finally {
      for (const user of present) await db.$executeRaw`UPDATE users SET role = 'SUPERADMIN' WHERE id = ${user.id}::uuid`;
    }
  }

  it("creates one account that must choose its own password, and audits it", async () => {
    await withoutSuperadmins(async () => {
      const email = uniqueEmail("first-boss");
      const result = await bootstrapFirstSuperadmin(db, { name: "First Boss", email, password: "bootstrap-pass-1" });

      expect(result).toMatchObject({ ok: true, created: true });
      const id = result.ok && result.created ? result.id : "";
      const user = await db.user.findUniqueOrThrow({ where: { id } });
      expect(user).toMatchObject({ role: "SUPERADMIN", isActive: true, mustChangePassword: true });
      expect(await authenticate(db, email, "bootstrap-pass-1")).toMatchObject({ role: "SUPERADMIN", mustChangePassword: true });
      const event = await db.auditEvent.findFirstOrThrow({ where: { action: "user.bootstrapped", entityId: id } });
      expect(event.after).toMatchObject({ email, role: "SUPERADMIN" });
      // Run a second time: it refuses, naming who to ask instead.
      const again = await bootstrapFirstSuperadmin(db, { name: "Second Boss", email: uniqueEmail("second"), password: "bootstrap-pass-2" });
      expect(again).toMatchObject({ ok: true, created: false });
      expect(again.ok && !again.created && again.existing).toContain(email);
      await db.$executeRaw`UPDATE users SET role = 'ADMIN' WHERE id = ${id}::uuid`; // leave the shared database as it was
    });
  });

  it("does nothing at all while a superadmin exists, and writes nothing on a dry run", async () => {
    const boss = await makeUser("SUPERADMIN");
    const email = uniqueEmail("never-made");
    const result = await bootstrapFirstSuperadmin(db, { name: "Not Needed", email, password: "bootstrap-pass-3" });
    expect(result).toMatchObject({ ok: true, created: false });
    expect(result.ok && !result.created && result.existing).toContain(boss.email);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();

    await withoutSuperadmins(async () => {
      const dry = await bootstrapFirstSuperadmin(db, { name: "Dry Run", email, password: "bootstrap-pass-3" }, { dryRun: true });
      expect(dry).toMatchObject({ ok: true, created: false });
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    });
  });

  it("refuses a short password, a bad address and an e-mail that already has an account", async () => {
    await withoutSuperadmins(async () => {
      const taken = await makeUser("SALES");
      expect(await bootstrapFirstSuperadmin(db, { name: "A", email: uniqueEmail("x"), password: "short" })).toMatchObject({ ok: false });
      expect(await bootstrapFirstSuperadmin(db, { name: "A", email: "not-an-address", password: "bootstrap-pass-4" })).toMatchObject({ ok: false });
      expect(await bootstrapFirstSuperadmin(db, { name: "", email: uniqueEmail("x"), password: "bootstrap-pass-4" })).toMatchObject({ ok: false });
      const clash = await bootstrapFirstSuperadmin(db, { name: "A", email: taken.email, password: "bootstrap-pass-4" });
      expect(clash).toMatchObject({ ok: false });
      expect(clash.ok === false && clash.message).toMatch(/already has an account/);
      expect(await db.user.count({ where: { role: "SUPERADMIN" } })).toBe(0);
    });
  });
});
