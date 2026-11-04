import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { listRequests } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("continuing a request with an optional note", () => {
  it("adds the note under the details of the new request, and leaves them alone without one", async () => {
    const sales = await makeUser("SALES");
    const soa = await makeUser("SOA");
    const purchasing = await makeUser("PURCHASING");
    const as = (user: { id: string; role: Role }) => ({ id: user.id, role: user.role });
    const project = await createProject(db, as(sales), { endUserCompany: `PT Note ${randomBytes(3).toString("hex")}`, name: "Note job" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, as(sales), { projectId: project.value.id, type: "BOQ", description: "Brand/Type : Aruba 6300", requiredBy: "2026-11-02" });
    if (!boq.ok) throw new Error(boq.message);
    for (const to of ["IN_PROGRESS", "COMPLETED"]) expect((await changeRequestStatus(db, as(soa), { requestId: boq.value.id, to })).ok).toBe(true);

    const rfq = await handOverToPurchasing(db, as(soa), { sourceId: boq.value.id, targetType: "RFQ", note: "Mohon prioritas minggu ini" });
    if (!rfq.ok) throw new Error(rfq.message);
    expect((await db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).description).toBe("Brand/Type : Aruba 6300\n\nCatatan: Mohon prioritas minggu ini");

    // The RFQ is In progress at once; once completed it goes on to a PO without a note.
    expect((await changeRequestStatus(db, as(purchasing), { requestId: rfq.value.id, to: "COMPLETED" })).ok).toBe(true);
    const po = await handOverToPurchasing(db, as(sales), { sourceId: rfq.value.id, targetType: "PO", requiredBy: "2026-11-20" });
    if (!po.ok) throw new Error(po.message);
    expect((await db.request.findUniqueOrThrow({ where: { id: po.value.id } })).description).toBe("Brand/Type : Aruba 6300\n\nCatatan: Mohon prioritas minggu ini");
    // Its own Needed by, typed in the modal; the RFQ (continued without one) has none, although the BOQ had 2 Nov.
    expect((await db.request.findUniqueOrThrow({ where: { id: po.value.id } })).requiredBy?.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect((await db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).requiredBy).toBeNull();
  });

  it("gives the continued request its own Needed by, never the earlier step's, and its SLA counts from its own creation", async () => {
    const sales = await makeUser("SALES");
    const purchasing = await makeUser("PURCHASING");
    const as = (user: { id: string; role: Role }) => ({ id: user.id, role: user.role });
    const project = await createProject(db, as(sales), { endUserCompany: `PT Dates ${randomBytes(3).toString("hex")}`, name: "Dates job" });
    if (!project.ok) throw new Error(project.message);
    const rfq = await createRequest(db, as(sales), { projectId: project.value.id, type: "RFQ", description: "Switches", requiredBy: "2026-11-02" });
    if (!rfq.ok) throw new Error(rfq.message);
    // The RFQ was raised two days ago; the PO is raised now.
    await db.request.update({ where: { id: rfq.value.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
    for (const to of ["IN_PROGRESS", "COMPLETED"]) expect((await changeRequestStatus(db, as(purchasing), { requestId: rfq.value.id, to })).ok).toBe(true);

    const po = await handOverToPurchasing(db, as(sales), { sourceId: rfq.value.id, targetType: "PO" });
    if (!po.ok) throw new Error(po.message);
    const stored = await db.request.findUniqueOrThrow({ where: { id: po.value.id } });
    expect(stored.requiredBy).toBeNull();
    const [row] = (await listRequests(db, as(purchasing), { projectId: project.value.id })).filter((r) => r.code === po.value.code);
    expect(row!.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(row!.sla.dueAt.getTime()).toBeGreaterThan(Date.now()); // three working days from today, not from the RFQ
  });
});
