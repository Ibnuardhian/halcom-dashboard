import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { can, clearPermissionOverrides } from "@/domain/access/permissions";
import { getDb } from "@/lib/db";
import { listPermissionOverrides, loadPermissionOverrides, savePermissionChanges } from "@/server/permissions/service";
import { makeUser } from "./helpers";

const db = getDb();

// The override table is global (role-wide), so each test starts and ends with no deviations.
async function reset() {
  await db.rolePermissionOverride.deleteMany({});
  clearPermissionOverrides();
}
beforeEach(reset);
afterEach(reset);
afterAll(async () => {
  await db.$disconnect();
});

const actor = (user: { id: string; role: Parameters<typeof savePermissionChanges>[1]["role"] }) => ({ id: user.id, role: user.role });
// The audit trail is append-only and shared by every test, so each test reads only what its own superadmin wrote.
const auditEvents = (entityId: string, actorId: string) => db.auditEvent.findMany({ where: { entityType: "role_permissions", entityId, actorId }, orderBy: { createdAt: "asc" } });

describe("viewing permission rules", () => {
  it("holds no deviations until somebody changes something, and the defaults then apply", async () => {
    await loadPermissionOverrides(db);

    expect(await listPermissionOverrides(db)).toEqual([]);
    expect(can("SUPERADMIN", "permissions.manage")).toBe(true);
    expect(can("ADMIN", "permissions.view")).toBe(true);
    expect(can("ADMIN", "permissions.manage")).toBe(false);
  });
});

describe("assigning and revoking permissions", () => {
  it("lets a superadmin grant a permission to a role, then take it away again", async () => {
    const superadmin = await makeUser("SUPERADMIN");
    expect(can("FINANCE", "customers.view")).toBe(false);

    const granted = await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "FINANCE", permission: "customers.view", granted: true }] });

    expect(granted).toEqual({ ok: true, changed: 1 });
    expect(can("FINANCE", "customers.view")).toBe(true);
    expect(await listPermissionOverrides(db)).toEqual([{ role: "FINANCE", permission: "customers.view", granted: true }]);
    const [event] = await auditEvents("FINANCE", superadmin.id);
    expect(event).toMatchObject({ actorId: superadmin.id, action: "permissions.updated", before: { "customers.view": false }, after: { "customers.view": true } });

    // Back to the default: the row is removed, so the table only ever holds deviations.
    const revoked = await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "FINANCE", permission: "customers.view", granted: false }] });

    expect(revoked).toEqual({ ok: true, changed: 1 });
    expect(can("FINANCE", "customers.view")).toBe(false);
    expect(await listPermissionOverrides(db)).toEqual([]);
    expect(await auditEvents("FINANCE", superadmin.id)).toHaveLength(2);
  });

  it("revokes a permission a role has by default and remembers that it was taken away", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "ADMIN", permission: "audit.view", granted: false }] });

    expect(can("ADMIN", "audit.view")).toBe(false);
    expect(await listPermissionOverrides(db)).toEqual([{ role: "ADMIN", permission: "audit.view", granted: false }]);
    // Another process starts from the stored rules.
    clearPermissionOverrides();
    expect(can("ADMIN", "audit.view")).toBe(true);
    await loadPermissionOverrides(db);
    expect(can("ADMIN", "audit.view")).toBe(false);
  });

  it("grants each dashboard on its own", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "MANAGEMENT", permission: "dashboard.finance.view", granted: true }] });

    expect(can("MANAGEMENT", "dashboard.finance.view")).toBe(true);
    expect(can("MANAGEMENT", "dashboard.soa.view")).toBe(false);
    expect(can("MANAGEMENT", "dashboard.management.view")).toBe(true);
  });

  it("skips a change that restates what the role already has, and writes nothing for it", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    const result = await savePermissionChanges(db, actor(superadmin), {
      changes: [
        { role: "SALES", permission: "projects.view", granted: true },
        { role: "SALES", permission: "users.manage", granted: false },
      ],
    });

    expect(result).toEqual({ ok: true, changed: 0 });
    expect(await listPermissionOverrides(db)).toEqual([]);
    expect(await auditEvents("SALES", superadmin.id)).toHaveLength(0);
  });

  it("writes one audit event per role that changed", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    await savePermissionChanges(db, actor(superadmin), {
      changes: [
        { role: "PURCHASING", permission: "customers.view", granted: true },
        { role: "PURCHASING", permission: "projects.create", granted: true },
        { role: "MANAGEMENT", permission: "customers.view", granted: true },
      ],
    });

    const purchasing = await auditEvents("PURCHASING", superadmin.id);
    expect(purchasing).toHaveLength(1);
    expect(purchasing[0]?.after).toEqual({ "customers.view": true, "projects.create": true });
    expect(await auditEvents("MANAGEMENT", superadmin.id)).toHaveLength(1);
  });
});

describe("denying unauthorized permission changes", () => {
  const change = [{ role: "SALES" as const, permission: "users.view" as const, granted: true }];

  it("refuses everyone who does not hold permissions.manage, and changes nothing", async () => {
    for (const role of ["ADMIN", "SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const user = await makeUser(role);
      const result = await savePermissionChanges(db, actor(user), { changes: change });
      expect(result, role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await listPermissionOverrides(db)).toEqual([]);
    expect(can("SALES", "users.view")).toBe(false);
  });

  it("does not trust the role the caller claims: the stored account decides", async () => {
    const sales = await makeUser("SALES");

    const result = await savePermissionChanges(db, { id: sales.id, role: "SUPERADMIN" }, { changes: change });

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await listPermissionOverrides(db)).toEqual([]);
  });

  it("refuses a deactivated superadmin and an unknown account", async () => {
    const inactive = await makeUser("SUPERADMIN", { isActive: false });

    await expect(savePermissionChanges(db, actor(inactive), { changes: change })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(savePermissionChanges(db, { id: "00000000-0000-4000-8000-000000000000", role: "SUPERADMIN" }, { changes: change })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await listPermissionOverrides(db)).toEqual([]);
  });

  it("stops an admin who was granted permissions.manage in the stored rules from being treated as a superadmin-only holder", async () => {
    // A row that tries to give Admin the key is ignored when the rules are computed, so Admin still cannot save.
    await db.rolePermissionOverride.create({ data: { role: "ADMIN", permission: "permissions.manage", granted: true } });
    const admin = await makeUser("ADMIN");

    const result = await savePermissionChanges(db, actor(admin), { changes: change });

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("protecting the last superadmin's access", () => {
  it("refuses to take permissions.manage, account management or the superadmin dashboard away from Superadmin", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    for (const permission of ["permissions.manage", "permissions.view", "users.manage", "users.manage-privileged", "dashboard.superadmin.view"] as const) {
      const result = await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "SUPERADMIN", permission, granted: false }] });
      expect(result, permission).toMatchObject({ ok: false, code: "BLOCKED" });
      expect(can("SUPERADMIN", permission), permission).toBe(true);
    }
    expect(await listPermissionOverrides(db)).toEqual([]);
  });

  it("refuses to hand permissions.manage or admin-account management to another role", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    for (const permission of ["permissions.manage", "users.manage-privileged"] as const) {
      const result = await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "ADMIN", permission, granted: true }] });
      expect(result, permission).toMatchObject({ ok: false, code: "BLOCKED" });
    }
    expect(can("ADMIN", "permissions.manage")).toBe(false);
    expect(await listPermissionOverrides(db)).toEqual([]);
  });

  it("applies all changes together or none: one forbidden change cancels the valid ones", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    const result = await savePermissionChanges(db, actor(superadmin), {
      changes: [
        { role: "FINANCE", permission: "customers.view", granted: true },
        { role: "SUPERADMIN", permission: "permissions.manage", granted: false },
      ],
    });

    expect(result).toMatchObject({ ok: false, code: "BLOCKED" });
    expect(await listPermissionOverrides(db)).toEqual([]);
    expect(await auditEvents("FINANCE", superadmin.id)).toHaveLength(0);
    expect(can("FINANCE", "customers.view")).toBe(false);
  });

  it("still lets a superadmin lose a permission that is not one of the locked ones", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    const result = await savePermissionChanges(db, actor(superadmin), { changes: [{ role: "SUPERADMIN", permission: "system.backup", granted: false }] });

    expect(result).toEqual({ ok: true, changed: 1 });
    expect(can("SUPERADMIN", "system.backup")).toBe(false);
    expect(can("SUPERADMIN", "permissions.manage")).toBe(true);
  });
});

describe("invalid input", () => {
  it("rejects unknown roles and permissions, empty and malformed requests", async () => {
    const superadmin = await makeUser("SUPERADMIN");

    for (const input of [
      { changes: [] },
      { changes: [{ role: "ROOT", permission: "projects.view", granted: true }] },
      { changes: [{ role: "SALES", permission: "projects.fly", granted: true }] },
      { changes: [{ role: "SALES", permission: "projects.view", granted: "yes" }] },
      { changes: [{ role: "SALES", permission: "projects.view", granted: true, extra: 1 }] },
      {},
      null,
    ]) {
      await expect(savePermissionChanges(db, actor(superadmin), input), JSON.stringify(input)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect(await listPermissionOverrides(db)).toEqual([]);
  });
});
