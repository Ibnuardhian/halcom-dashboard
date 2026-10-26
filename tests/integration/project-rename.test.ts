import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { listProjectChanges } from "@/server/projects/queries";
import { renameProject } from "@/server/projects/rename";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

describe("renameProject", () => {
  it("lets Superadmin, Admin and SOA rename a project, logs the old and new name, and refuses the other roles", async () => {
    const [sales, soa, admin, root, purchasing, finance] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("ADMIN"), actorOf("SUPERADMIN"), actorOf("PURCHASING"), actorOf("FINANCE")]);
    const created = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "Typo naem" });
    if (!created.ok) throw new Error(created.message);
    const projectId = created.value.id;

    for (const actor of [sales, purchasing, finance]) {
      expect(await renameProject(db, actor, { projectId, name: "Nope" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await renameProject(db, soa, { projectId, name: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await renameProject(db, soa, { projectId, name: "Typo   fixed" })).toEqual({ ok: true, changed: true });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ name: "Typo fixed" });
    expect(await renameProject(db, admin, { projectId, name: "Typo fixed" })).toEqual({ ok: true, changed: false }); // same name, nothing written
    expect(await renameProject(db, root, { projectId, name: "Final name" })).toEqual({ ok: true, changed: true });

    const log = (await listProjectChanges(db, root, projectId)).filter((row) => row.field === "name");
    expect(log.map((row) => [row.fromValue, row.toValue])).toEqual(expect.arrayContaining([["Typo naem", "Typo fixed"], ["Typo fixed", "Final name"]]));
    await expect(db.auditEvent.count({ where: { action: "project.renamed", entityId: projectId } })).resolves.toBe(2);
    expect(await renameProject(db, root, { projectId: "00000000-0000-4000-8000-000000000000", name: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
