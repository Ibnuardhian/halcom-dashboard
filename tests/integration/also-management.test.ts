import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createSession, findSessionUser } from "@/server/auth/session-store";
import { changeUserRole, setUserAlsoManagement } from "@/server/users/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("a person who also sees what Management sees", () => {
  it("is set by a superadmin only, for the roles that may have it, audited, and the session carries it", async () => {
    const [root, admin, sales, management, anotherAdmin] = await Promise.all([makeUser("SUPERADMIN"), makeUser("ADMIN"), makeUser("SALES"), makeUser("MANAGEMENT"), makeUser("ADMIN")]);

    expect(await setUserAlsoManagement(db, { id: admin.id, role: "ADMIN" }, sales.id, true)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setUserAlsoManagement(db, { id: root.id, role: "SUPERADMIN" }, management.id, true)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setUserAlsoManagement(db, { id: root.id, role: "SUPERADMIN" }, anotherAdmin.id, true)).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect((await setUserAlsoManagement(db, { id: root.id, role: "SUPERADMIN" }, sales.id, true)).ok).toBe(true);
    const { token } = await createSession(db, sales.id);
    expect(await findSessionUser(db, token)).toMatchObject({ role: "SALES", alsoManagement: true });
    expect(await db.auditEvent.count({ where: { action: "user.also_management_changed", entityId: sales.id, actorId: root.id } })).toBe(1);

    // Changing the role to one that may not have it clears it.
    expect((await changeUserRole(db, { id: root.id, role: "SUPERADMIN" }, sales.id, "MANAGEMENT")).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: sales.id } })).alsoManagement).toBe(false);
  });
});
