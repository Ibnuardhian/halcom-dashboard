import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
import { createSession, findSessionUser } from "@/server/auth/session-store";
import { getUserStats, listUsers, recentAuditEvents } from "@/server/users/queries";
import { changeUserEmail, changeUserRole, createUser, resetUserPassword, setUserActive, type Actor } from "@/server/users/service";
import { makeUser, TEST_PASSWORD, uniqueEmail } from "./helpers";

const db = getDb();
const NEW_PASSWORD = "a-brand-new-password-1";

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: "SUPERADMIN" | "ADMIN" | "SALES"): Promise<Actor> {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

function auditFor(entityId: string) {
  return db.auditEvent.findMany({ where: { entityType: "user", entityId }, orderBy: { createdAt: "asc" } });
}

describe("createUser", () => {
  it("lets an admin create an operational user, storing a hash and one audit event", async () => {
    const admin = await actorOf("ADMIN");
    const email = uniqueEmail("new-sales");

    const result = await createUser(db, admin, {
      name: "  New Sales  ",
      email: ` ${email.toUpperCase()} `,
      role: "SALES",
      password: NEW_PASSWORD,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const user = await db.user.findUniqueOrThrow({ where: { id: result.value.id } });
    expect(user).toMatchObject({ name: "New Sales", email, role: "SALES", isActive: true });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain(NEW_PASSWORD);
    await expect(authenticate(db, email, NEW_PASSWORD)).resolves.toMatchObject({ id: user.id });

    const events = await auditFor(user.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: admin.id, action: "user.created", after: { email, role: "SALES" } });
    expect(JSON.stringify(events[0])).not.toContain(NEW_PASSWORD);
  });

  it("stops an admin from creating admins or superadmins, and leaves no trace", async () => {
    const admin = await actorOf("ADMIN");

    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      const email = uniqueEmail(`blocked-${role.toLowerCase()}`);
      const result = await createUser(db, admin, { name: "X", email, role, password: NEW_PASSWORD });

      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
      await expect(db.user.count({ where: { email } })).resolves.toBe(0);
    }
  });

  it("lets a superadmin create an admin", async () => {
    const superadmin = await actorOf("SUPERADMIN");

    const result = await createUser(db, superadmin, {
      name: "New Admin",
      email: uniqueEmail("new-admin"),
      role: "ADMIN",
      password: NEW_PASSWORD,
    });

    expect(result.ok).toBe(true);
  });

  it("denies operational roles", async () => {
    const sales = await actorOf("SALES");

    const result = await createUser(db, sales, {
      name: "X",
      email: uniqueEmail("denied"),
      role: "SALES",
      password: NEW_PASSWORD,
    });

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects a duplicate email and rolls back completely", async () => {
    const admin = await actorOf("ADMIN");
    const existing = await makeUser("SOA");
    const auditBefore = await db.auditEvent.count({ where: { actorId: admin.id } });

    const result = await createUser(db, admin, {
      name: "Duplicate",
      email: existing.email.toUpperCase(),
      role: "SALES",
      password: NEW_PASSWORD,
    });

    expect(result).toMatchObject({ ok: false, code: "EMAIL_TAKEN" });
    await expect(db.user.count({ where: { email: existing.email } })).resolves.toBe(1);
    await expect(db.auditEvent.count({ where: { actorId: admin.id } })).resolves.toBe(auditBefore);
  });

  it("rejects invalid input without touching the database", async () => {
    const admin = await actorOf("ADMIN");
    const email = uniqueEmail("invalid");

    for (const input of [
      { name: "X", email, role: "SALES", password: "short" },
      { name: "", email, role: "SALES", password: NEW_PASSWORD },
      { name: "X", email: "not-an-email", role: "SALES", password: NEW_PASSWORD },
      { name: "X", email, role: "ROOT", password: NEW_PASSWORD },
    ]) {
      expect(await createUser(db, admin, input)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    await expect(db.user.count({ where: { email } })).resolves.toBe(0);
  });

  it("ignores a stale claim: an actor deactivated a moment ago cannot create users", async () => {
    const admin = await makeUser("ADMIN", { isActive: false });
    const email = uniqueEmail("stale");

    const result = await createUser(db, { id: admin.id, role: "ADMIN" }, {
      name: "X",
      email,
      role: "SALES",
      password: NEW_PASSWORD,
    });

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.user.count({ where: { email } })).resolves.toBe(0);
  });
});

describe("changeUserRole", () => {
  it("changes an operational user's role and records before/after in the audit trail", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("SALES");

    const result = await changeUserRole(db, admin, target.id, "SOA");

    expect(result.ok).toBe(true);
    await expect(db.user.findUniqueOrThrow({ where: { id: target.id } })).resolves.toMatchObject({ role: "SOA" });
    const events = await auditFor(target.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: admin.id,
      action: "user.role_changed",
      before: { role: "SALES" },
      after: { role: "SOA" },
    });
  });

  it("does not let an admin promote to admin or modify an admin or superadmin", async () => {
    const admin = await actorOf("ADMIN");
    const sales = await makeUser("SALES");
    const otherAdmin = await makeUser("ADMIN");
    const superadmin = await makeUser("SUPERADMIN");

    expect(await changeUserRole(db, admin, sales.id, "ADMIN")).toMatchObject({ code: "FORBIDDEN" });
    expect(await changeUserRole(db, admin, otherAdmin.id, "SALES")).toMatchObject({ code: "FORBIDDEN" });
    expect(await changeUserRole(db, admin, superadmin.id, "SALES")).toMatchObject({ code: "FORBIDDEN" });

    await expect(db.user.findUniqueOrThrow({ where: { id: sales.id } })).resolves.toMatchObject({ role: "SALES" });
    await expect(db.user.findUniqueOrThrow({ where: { id: otherAdmin.id } })).resolves.toMatchObject({ role: "ADMIN" });
    await expect(db.user.findUniqueOrThrow({ where: { id: superadmin.id } })).resolves.toMatchObject({
      role: "SUPERADMIN",
    });
    await expect(auditFor(sales.id)).resolves.toHaveLength(0);
  });

  it("lets a superadmin promote to admin", async () => {
    const superadmin = await actorOf("SUPERADMIN");
    const target = await makeUser("SALES");

    expect((await changeUserRole(db, superadmin, target.id, "ADMIN")).ok).toBe(true);
    await expect(db.user.findUniqueOrThrow({ where: { id: target.id } })).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("forbids changing one's own role, unknown users and invalid roles", async () => {
    const superadmin = await actorOf("SUPERADMIN");

    expect(await changeUserRole(db, superadmin, superadmin.id, "SALES")).toMatchObject({ code: "SELF_CHANGE" });
    expect(await changeUserRole(db, superadmin, crypto.randomUUID(), "SALES")).toMatchObject({ code: "NOT_FOUND" });
    expect(await changeUserRole(db, superadmin, "not-a-uuid", "SALES")).toMatchObject({ code: "INVALID_INPUT" });
    expect(await changeUserRole(db, superadmin, (await makeUser("SALES")).id, "ROOT")).toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(db.user.findUniqueOrThrow({ where: { id: superadmin.id } })).resolves.toMatchObject({
      role: "SUPERADMIN",
    });
  });

  it("writes no audit event when the role is unchanged", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("FINANCE");

    expect((await changeUserRole(db, admin, target.id, "FINANCE")).ok).toBe(true);
    await expect(auditFor(target.id)).resolves.toHaveLength(0);
  });

  it("takes effect immediately for sessions that are already open", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("SALES");
    const { token } = await createSession(db, target.id);

    await changeUserRole(db, admin, target.id, "PURCHASING");

    await expect(findSessionUser(db, token)).resolves.toMatchObject({ role: "PURCHASING" });
  });

  it("refuses a superadmin who was demoted a moment ago, so two superadmins cannot lock everyone out", async () => {
    const first = await makeUser("SUPERADMIN");
    const second = await makeUser("SUPERADMIN");
    const winner: Actor = { id: first.id, role: "SUPERADMIN" };
    const loser: Actor = { id: second.id, role: "SUPERADMIN" };

    expect((await changeUserRole(db, winner, second.id, "SALES")).ok).toBe(true);
    // The demoted superadmin still holds a session that claims SUPERADMIN.
    expect(await changeUserRole(db, loser, first.id, "SALES")).toMatchObject({ ok: false, code: "FORBIDDEN" });

    await expect(db.user.findUniqueOrThrow({ where: { id: first.id } })).resolves.toMatchObject({ role: "SUPERADMIN" });
  });
});

describe("setUserActive", () => {
  it("deactivates a user, revokes their sessions and records an audit event; reactivation restores access", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("SALES");
    const { token } = await createSession(db, target.id);

    expect((await setUserActive(db, admin, target.id, false)).ok).toBe(true);

    await expect(db.session.count({ where: { userId: target.id } })).resolves.toBe(0);
    await expect(findSessionUser(db, token)).resolves.toBeNull();
    await expect(authenticate(db, target.email, TEST_PASSWORD)).resolves.toBeNull();

    expect((await setUserActive(db, admin, target.id, true)).ok).toBe(true);
    await expect(authenticate(db, target.email, TEST_PASSWORD)).resolves.not.toBeNull();
    expect((await auditFor(target.id)).map((e) => e.action)).toEqual(["user.deactivated", "user.reactivated"]);
  });

  it("applies the same hierarchy and self-protection rules", async () => {
    const admin = await actorOf("ADMIN");
    const superadmin = await makeUser("SUPERADMIN");
    const otherAdmin = await makeUser("ADMIN");

    expect(await setUserActive(db, admin, superadmin.id, false)).toMatchObject({ code: "FORBIDDEN" });
    expect(await setUserActive(db, admin, otherAdmin.id, false)).toMatchObject({ code: "FORBIDDEN" });
    expect(await setUserActive(db, admin, admin.id, false)).toMatchObject({ code: "SELF_CHANGE" });
    expect(await setUserActive(db, admin, crypto.randomUUID(), false)).toMatchObject({ code: "NOT_FOUND" });
    expect(await setUserActive(db, await actorOf("SALES"), otherAdmin.id, false)).toMatchObject({ code: "FORBIDDEN" });
    await expect(db.user.findUniqueOrThrow({ where: { id: superadmin.id } })).resolves.toMatchObject({ isActive: true });
  });
});

describe("resetUserPassword", () => {
  it("replaces the password, signs the user out everywhere and keeps the password out of the audit trail", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("SOA");
    const { token } = await createSession(db, target.id);

    expect((await resetUserPassword(db, admin, target.id, { password: NEW_PASSWORD })).ok).toBe(true);

    await expect(findSessionUser(db, token)).resolves.toBeNull();
    await expect(authenticate(db, target.email, TEST_PASSWORD)).resolves.toBeNull();
    await expect(authenticate(db, target.email, NEW_PASSWORD)).resolves.not.toBeNull();
    const events = await auditFor(target.id);
    expect(events.map((e) => e.action)).toEqual(["user.password_reset"]);
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
  });

  it("enforces the policy, the hierarchy and self-protection", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("SOA");
    const otherAdmin = await makeUser("ADMIN");

    expect(await resetUserPassword(db, admin, target.id, { password: "short" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(await resetUserPassword(db, admin, otherAdmin.id, { password: NEW_PASSWORD })).toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await resetUserPassword(db, admin, admin.id, { password: NEW_PASSWORD })).toMatchObject({
      code: "SELF_CHANGE",
    });
    await expect(authenticate(db, target.email, TEST_PASSWORD)).resolves.not.toBeNull();
  });
});

describe("queries", () => {
  it("requires the matching permission", async () => {
    const sales = await actorOf("SALES");

    await expect(listUsers(db, sales)).rejects.toThrow(/Forbidden/);
    await expect(getUserStats(db, sales)).rejects.toThrow(/Forbidden/);
    await expect(recentAuditEvents(db, sales)).rejects.toThrow(/Forbidden/);
  });

  it("lists users without exposing password hashes and reconciles stats with the list", async () => {
    const admin = await actorOf("ADMIN");
    await makeUser("FINANCE", { isActive: false });

    // Other test files create users while this one runs, so the list and the stats are read again until no one was added between them.
    let users = await listUsers(db, admin);
    let stats = await getUserStats(db, admin);
    for (let attempt = 0; attempt < 10 && stats.total !== users.length; attempt += 1) {
      users = await listUsers(db, admin);
      stats = await getUserStats(db, admin);
    }

    expect(users.length).toBeGreaterThan(0);
    for (const user of users) expect(Object.keys(user)).not.toContain("passwordHash");
    expect(stats.total).toBe(users.length);
    expect(stats.active).toBe(users.filter((u) => u.isActive).length);
    expect(stats.byRole.FINANCE.inactive).toBe(users.filter((u) => u.role === "FINANCE" && !u.isActive).length);
  });

  it("returns recent audit events newest first with the actor's name", async () => {
    const admin = await actorOf("ADMIN");
    const target = await makeUser("SALES");
    await changeUserRole(db, admin, target.id, "SOA");

    const events = await recentAuditEvents(db, admin, 5);

    expect(events.length).toBeLessThanOrEqual(5);
    expect(events[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(events.at(-1)?.createdAt.getTime() ?? 0);
    expect(events.find((e) => e.entityId === target.id)).toMatchObject({
      action: "user.role_changed",
      actorName: "Test ADMIN",
    });
  });
});

describe("changeUserEmail", () => {
  it("lets only a superadmin change another account's e-mail, audits it, and refuses a taken or invalid one", async () => {
    const [root, admin] = await Promise.all([actorOf("SUPERADMIN"), actorOf("ADMIN")]);
    const target = await makeUser("SALES");
    const other = await makeUser("SALES");
    const email = uniqueEmail("renamed");

    expect(await changeUserEmail(db, admin, target.id, { email })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeUserEmail(db, root, root.id, { email })).toMatchObject({ ok: false, code: "SELF_CHANGE" });
    expect(await changeUserEmail(db, root, target.id, { email: "not an email" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await changeUserEmail(db, root, target.id, { email: other.email })).toMatchObject({ ok: false, code: "EMAIL_TAKEN" });
    expect(await changeUserEmail(db, root, "00000000-0000-4000-8000-000000000000", { email })).toMatchObject({ ok: false, code: "NOT_FOUND" });

    expect(await changeUserEmail(db, root, target.id, { email: ` ${email.toUpperCase()} ` })).toMatchObject({ ok: true });
    await expect(db.user.findUniqueOrThrow({ where: { id: target.id } })).resolves.toMatchObject({ email });
    await expect(authenticate(db, email, TEST_PASSWORD)).resolves.toMatchObject({ id: target.id });
    await expect(authenticate(db, target.email, TEST_PASSWORD)).resolves.toBeNull();
    const events = (await auditFor(target.id)).filter((event) => event.action === "user.email_changed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: root.id, before: { email: target.email }, after: { email } });
  });
});
