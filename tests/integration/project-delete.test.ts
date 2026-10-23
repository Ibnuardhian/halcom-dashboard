import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { deleteProject } from "@/server/projects/delete";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { getProjectByCode, listProjects, listRequests } from "@/server/requests/queries";
import { createProject, createRequest } from "@/server/requests/service";
import { updateCommercialDetails } from "@/server/projects/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("deleteProject", () => {
  it("hides the project and its requests everywhere, keeps the rows, and audits it", async () => {
    const sales = await makeUser("SALES");
    const root = await makeUser("SUPERADMIN");
    const salesActor = { id: sales.id, role: sales.role };
    const rootActor = { id: root.id, role: root.role };
    const created = await createProject(db, salesActor, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "to delete" });
    if (!created.ok) throw new Error(created.message);
    const { id, code } = created.value;
    const request = await createRequest(db, salesActor, { projectId: id, type: "BOQ", title: "a BOQ" });
    expect(request.ok).toBe(true);

    expect(await deleteProject(db, salesActor, { projectId: id, confirmCode: code })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deleteProject(db, rootActor, { projectId: id, confirmCode: "HIT-PROJ-000" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ deletedAt: null });

    expect(await deleteProject(db, rootActor, { projectId: id, confirmCode: code })).toEqual({ ok: true, code });

    expect(await getProjectByCode(db, rootActor, code)).toBeNull();
    expect((await listProjects(db, rootActor, { search: code })).map((p) => p.code)).not.toContain(code);
    expect((await listRequests(db, rootActor, { projectId: id })).length).toBe(0);
    const analytics = await getPipelineAnalytics(db, rootActor, { salesOwnerId: sales.id });
    expect(analytics.totals.projects).toBe(0);
    expect(await deleteProject(db, rootActor, { projectId: id, confirmCode: code })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await updateCommercialDetails(db, salesActor, { projectId: id, values: { estimatedValue: "5" } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await createRequest(db, salesActor, { projectId: id, type: "RFQ", title: "late" })).toMatchObject({ ok: false });

    await expect(db.request.count({ where: { projectId: id } })).resolves.toBe(1);
    await expect(db.auditEvent.count({ where: { action: "project.deleted", entityId: id, actorId: root.id } })).resolves.toBe(1);
  });

  it("is refused for every role but the superadmin", async () => {
    const sales = await makeUser("SALES");
    const created = await createProject(db, { id: sales.id, role: sales.role }, { endUserCompany: "PT keep", name: "keep" });
    if (!created.ok) throw new Error(created.message);
    for (const role of ["ADMIN", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const user = await makeUser(role);
      expect(await deleteProject(db, { id: user.id, role: user.role }, { projectId: created.value.id, confirmCode: created.value.code })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
  });
});
