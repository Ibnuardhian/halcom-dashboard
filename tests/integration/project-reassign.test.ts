import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { reassignProject } from "@/server/projects/reassign";
import { updateCommercialDetails } from "@/server/projects/service";
import { listPipelineProjects } from "@/server/projects/analytics";
import { listPicOptions, listRequests } from "@/server/requests/queries";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const actor = (user: { id: string; role: Parameters<typeof reassignProject>[1]["role"] }) => ({ id: user.id, role: user.role });

describe("reassignProject", () => {
  it("moves the project to other PICs and leaves every detail and every earlier record as it was", async () => {
    const [oldSales, newSales, soa, purchasing, root] = await Promise.all([makeUser("SALES"), makeUser("SALES"), makeUser("SOA"), makeUser("PURCHASING"), makeUser("SUPERADMIN")]);
    const created = await createProject(db, actor(oldSales), { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "moving", estimatedValue: "1000", targetMarginValue: "100" });
    if (!created.ok) throw new Error(created.message);
    const { id, code } = created.value;
    const request = await createRequest(db, actor(oldSales), { projectId: id, type: "BOQ", title: "kept" });
    if (!request.ok) throw new Error(request.message);
    await updateCommercialDetails(db, actor(oldSales), { projectId: id, values: { progress: "PROPOSE" } });
    const before = await db.project.findUniqueOrThrow({ where: { id } });
    const changesBefore = await db.projectChange.count({ where: { projectId: id } });

    const result = await reassignProject(db, actor(root), { projectId: id, salesOwnerId: newSales.id, technicalPicId: soa.id, purchasingPicId: purchasing.id });

    expect(result).toEqual({ ok: true, changed: ["salesOwner", "technicalPic", "purchasingPic"] });
    const after = await db.project.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ salesOwnerId: newSales.id, technicalPicId: soa.id, purchasingPicId: purchasing.id });
    // Only the three PIC columns (and the touch time) differ.
    const { salesOwnerId, technicalPicId, purchasingPicId, updatedAt, ...restAfter } = after;
    const { salesOwnerId: _s, technicalPicId: _t, purchasingPicId: _p, updatedAt: _u, ...restBefore } = before;
    void [salesOwnerId, technicalPicId, purchasingPicId, updatedAt, _s, _t, _p, _u];
    expect(restAfter).toEqual(restBefore);
    // The request keeps its requester; the log only grew.
    await expect(db.request.findUniqueOrThrow({ where: { id: request.value.id } })).resolves.toMatchObject({ requesterId: oldSales.id });
    const log = await db.projectChange.findMany({ where: { projectId: id, field: { in: ["salesOwner", "technicalPic", "purchasingPic"] } } });
    expect(log).toHaveLength(3);
    expect(log.find((row) => row.field === "salesOwner")).toMatchObject({ changedById: root.id, fromValue: `${oldSales.name} (${oldSales.email})`, toValue: `${newSales.name} (${newSales.email})` });
    expect(await db.projectChange.count({ where: { projectId: id } })).toBe(changesBefore + 3);
    await expect(db.auditEvent.count({ where: { action: "project.reassigned", entityId: id, actorId: root.id } })).resolves.toBe(1);

    // The project is now the new salesperson's: in their pipeline and request list, no longer in the old one's.
    expect((await listPipelineProjects(db, actor(newSales), newSales.id)).map((p) => p.projectTitle)).toContain("moving");
    expect((await listPipelineProjects(db, actor(oldSales), oldSales.id)).map((p) => p.code)).not.toContain(code);
    expect((await listRequests(db, actor(newSales), { projectOwnerId: newSales.id })).map((r) => r.code)).toContain(request.value.code);
    expect((await listRequests(db, actor(oldSales), { projectOwnerId: oldSales.id })).map((r) => r.code)).not.toContain(request.value.code);
    // The new owners and the previous Sales owner hear about it.
    for (const user of [newSales, soa, purchasing, oldSales]) {
      await expect(db.notification.count({ where: { recipientId: user.id, kind: "project.reassigned", href: `/projects/${code}` } })).resolves.toBe(1);
    }
  });

  it("changes nothing when nothing changed, can clear the SOA and Purchasing PIC, and keeps the Sales PIC required", async () => {
    const [sales, soa, root] = await Promise.all([makeUser("SALES"), makeUser("SOA"), makeUser("SUPERADMIN")]);
    const created = await createProject(db, actor(sales), { endUserCompany: "PT same", name: "same" });
    if (!created.ok) throw new Error(created.message);
    const id = created.value.id;
    await reassignProject(db, actor(root), { projectId: id, technicalPicId: soa.id });

    expect(await reassignProject(db, actor(root), { projectId: id, salesOwnerId: sales.id, technicalPicId: soa.id })).toEqual({ ok: true, changed: [] });
    expect(await reassignProject(db, actor(root), { projectId: id, technicalPicId: "" })).toEqual({ ok: true, changed: ["technicalPic"] });
    await expect(db.project.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ technicalPicId: null, salesOwnerId: sales.id });
    expect(await reassignProject(db, actor(root), { projectId: id, salesOwnerId: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("is for the superadmin only, and each PIC must be an active account with the right role", async () => {
    const [sales, other, soa, root] = await Promise.all([makeUser("SALES"), makeUser("SALES"), makeUser("SOA"), makeUser("SUPERADMIN")]);
    const created = await createProject(db, actor(sales), { endUserCompany: "PT rules", name: "rules" });
    if (!created.ok) throw new Error(created.message);
    const id = created.value.id;

    for (const role of ["ADMIN", "SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const user = await makeUser(role);
      expect(await reassignProject(db, actor(user), { projectId: id, salesOwnerId: other.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await reassignProject(db, actor(root), { projectId: id, salesOwnerId: soa.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" }); // a SOA account is not a Sales PIC
    expect(await reassignProject(db, actor(root), { projectId: id, technicalPicId: other.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await db.user.update({ where: { id: other.id }, data: { isActive: false } });
    expect(await reassignProject(db, actor(root), { projectId: id, salesOwnerId: other.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ salesOwnerId: sales.id });
    await expect(listPicOptions(db, actor(sales))).rejects.toThrow(/Forbidden/);
    const options = await listPicOptions(db, actor(root));
    expect(options.sales.map((p) => p.id)).toContain(sales.id);
    expect(options.sales.map((p) => p.id)).not.toContain(other.id); // inactive
  });
});
