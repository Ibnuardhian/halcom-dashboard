import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { setProjectDescription } from "@/server/projects/description";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("setProjectDescription", () => {
  it("lets Superadmin, Admin and the Sales who acts on the project change it, logs old and new text, and refuses SOA and other salespeople", async () => {
    const [root, sales, other, admin, soa] = await Promise.all([makeUser("SUPERADMIN"), makeUser("SALES"), makeUser("SALES"), makeUser("ADMIN"), makeUser("SOA")]);
    const created = await createProject(db, { id: sales.id, role: sales.role }, { endUserCompany: "Desc Co", name: "Desc job" });
    if (!created.ok) throw new Error(created.message);
    const projectId = created.value.id;
    const actor = (user: { id: string; role: typeof sales.role }) => ({ id: user.id, role: user.role });

    expect(await setProjectDescription(db, actor(sales), { projectId, description: "  First text\r\nline two " })).toEqual({ ok: true, changed: true });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ description: "First text\nline two" });
    expect(await setProjectDescription(db, actor(sales), { projectId, description: "First text\nline two" })).toEqual({ ok: true, changed: false });
    expect(await setProjectDescription(db, actor(root), { projectId, description: "Root text" })).toEqual({ ok: true, changed: true });
    await expect(db.projectChange.findMany({ where: { projectId, field: "description" }, orderBy: { changedAt: "asc" } })).resolves.toMatchObject([
      { fromValue: null, toValue: "First text\nline two" },
      { fromValue: "First text\nline two", toValue: "Root text" },
    ]);
    await expect(db.auditEvent.findFirst({ where: { action: "project.description_changed", entityId: projectId } })).resolves.not.toBeNull();

    // Admin may on any project; another salesperson and SOA may not.
    expect(await setProjectDescription(db, actor(admin), { projectId, description: "Admin text" })).toEqual({ ok: true, changed: true });
    expect(await setProjectDescription(db, actor(other), { projectId, description: "Not mine" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setProjectDescription(db, actor(soa), { projectId, description: "Nope" })).toMatchObject({ ok: false, code: "FORBIDDEN" });

    // An empty text clears it; too long is refused.
    expect(await setProjectDescription(db, actor(root), { projectId, description: "   " })).toEqual({ ok: true, changed: true });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ description: null });
    expect(await setProjectDescription(db, actor(root), { projectId, description: "x".repeat(2001) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
