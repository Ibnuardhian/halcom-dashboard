import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { deleteRequest } from "@/server/requests/delete";
import { getRequestByCode, listRequests } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string; role: Role }) => ({ id: user.id, role: user.role });

describe("a superadmin or an admin deletes a request", () => {
  it("only a superadmin or an admin, only with the code typed, a continued request after its continuation, and the source can be continued again", async () => {
    const [sales, soa, root] = await Promise.all([makeUser("SALES"), makeUser("SOA"), makeUser("SUPERADMIN")]);
    const project = await createProject(db, as(sales), { endUserCompany: `PT Delete ${randomBytes(3).toString("hex")}`, name: "Delete job" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, as(sales), { projectId: project.value.id, type: "BOQ", description: "Cameras" });
    if (!boq.ok) throw new Error(boq.message);
    for (const to of ["IN_PROGRESS", "COMPLETED"]) expect((await changeRequestStatus(db, as(soa), { requestId: boq.value.id, to })).ok).toBe(true);
    const rfq = await handOverToPurchasing(db, as(soa), { sourceId: boq.value.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);

    for (const role of ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await deleteRequest(db, as(await makeUser(role)), { requestId: rfq.value.id, confirmCode: rfq.value.code })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await deleteRequest(db, as(root), { requestId: rfq.value.id, confirmCode: "wrong" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // The BOQ was continued: its RFQ goes first.
    expect(await deleteRequest(db, as(root), { requestId: boq.value.id, confirmCode: boq.value.code })).toMatchObject({ ok: false, code: "INVALID_STATE" });

    expect(await deleteRequest(db, as(root), { requestId: rfq.value.id, confirmCode: rfq.value.code })).toMatchObject({ ok: true, code: rfq.value.code });
    expect(await getRequestByCode(db, as(root), rfq.value.code)).toBeNull();
    const listed = await listRequests(db, as(root), { projectId: project.value.id });
    expect(listed.map((row) => row.code)).toEqual([boq.value.code]);
    expect(await changeRequestStatus(db, as(root), { requestId: rfq.value.id, to: "COMPLETED" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await db.auditEvent.findFirst({ where: { action: "request.deleted", entityId: rfq.value.id } })).not.toBeNull();

    // The BOQ lets go of the deleted RFQ: it can be continued again, and then deleted itself.
    const again = await handOverToPurchasing(db, as(soa), { sourceId: boq.value.id, targetType: "RFQ" });
    if (!again.ok) throw new Error(again.message);
    expect(again.value.code).not.toBe(rfq.value.code);
    expect((await deleteRequest(db, as(root), { requestId: again.value.id, confirmCode: again.value.code })).ok).toBe(true);
    expect((await deleteRequest(db, as(root), { requestId: boq.value.id, confirmCode: boq.value.code })).ok).toBe(true);
    expect(await listRequests(db, as(root), { projectId: project.value.id })).toEqual([]);
  });

  it("lets an admin delete a request too, with the code typed", async () => {
    const [sales, admin] = await Promise.all([makeUser("SALES"), makeUser("ADMIN")]);
    const project = await createProject(db, as(sales), { endUserCompany: `PT Admin Delete ${randomBytes(3).toString("hex")}`, name: "Admin delete job" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, as(sales), { projectId: project.value.id, type: "BOQ", description: "Switches" });
    if (!boq.ok) throw new Error(boq.message);

    expect(await deleteRequest(db, as(admin), { requestId: boq.value.id, confirmCode: "wrong" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteRequest(db, as(admin), { requestId: boq.value.id, confirmCode: boq.value.code })).toMatchObject({ ok: true, code: boq.value.code });
    expect(await db.auditEvent.count({ where: { action: "request.deleted", entityId: boq.value.id, actorId: admin.id } })).toBe(1);
  });
});
