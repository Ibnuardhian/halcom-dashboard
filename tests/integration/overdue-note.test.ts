import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { listOverdueRequests } from "@/server/dashboards/metrics";
import { listRequests } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, type Actor } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role): Promise<Actor> {
  const user = await makeUser(role, { email: `overdue.${randomBytes(4).toString("hex")}@d.example.invalid` });
  return { id: user.id, role: user.role };
}

async function rfqInProgress(sales: Actor, purchasing: Actor, daysAgo: number) {
  const project = await createProject(db, sales, { endUserCompany: `PT Late ${randomBytes(3).toString("hex")}`, name: "Late job" });
  if (!project.ok) throw new Error(project.message);
  const request = await createRequest(db, sales, { projectId: project.value.id, type: "RFQ", description: "40 switches" });
  if (!request.ok) throw new Error(request.message);
  expect((await changeRequestStatus(db, purchasing, { requestId: request.value.id, to: "IN_PROGRESS" })).ok).toBe(true);
  await db.request.update({ where: { id: request.value.id }, data: { createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) } });
  return request.value;
}

describe("completing an overdue RFQ or PO", () => {
  it("asks Purchasing for a note, keeps it on the request for everyone, and lists the request on the Purchasing dashboard", async () => {
    const sales = await actorOf("SALES");
    const purchasing = await actorOf("PURCHASING");
    const request = await rfqInProgress(sales, purchasing, 30);

    const refused = await changeRequestStatus(db, purchasing, { requestId: request.id, to: "COMPLETED" });
    expect(refused).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("IN_PROGRESS");

    // While it is open and late it is already on the dashboard, without a note.
    const open = (await listOverdueRequests(db, purchasing, "PURCHASING")).find((row) => row.code === request.code);
    expect(open).toMatchObject({ completed: false, note: null });
    expect(open!.overdueDays).toBeGreaterThan(10);

    expect((await changeRequestStatus(db, purchasing, { requestId: request.id, to: "COMPLETED", reason: "Vendor terlambat kirim penawaran" })).ok).toBe(true);
    const stored = await db.request.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.overdueNote).toBe("Vendor terlambat kirim penawaran");

    // Every role reads it in the request lists, with how late it was.
    const row = (await listRequests(db, await actorOf("FINANCE"), { type: "RFQ", q: request.code })).find((r) => r.code === request.code);
    expect(row).toMatchObject({ overdueNote: "Vendor terlambat kirim penawaran", sla: { state: "late" } });
    expect(row!.overdueDays).toBeGreaterThan(10);

    const done = (await listOverdueRequests(db, purchasing, "PURCHASING")).find((r) => r.code === request.code);
    expect(done).toMatchObject({ completed: true, note: "Vendor terlambat kirim penawaran" });

    // Reopening clears the note: it belongs to the completion.
    expect((await changeRequestStatus(db, purchasing, { requestId: request.id, to: "IN_PROGRESS", reason: "Perlu revisi harga" })).ok).toBe(true);
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).overdueNote).toBeNull();
  });

  it("needs no note when the request is on time, and never for a BOQ", async () => {
    const sales = await actorOf("SALES");
    const purchasing = await actorOf("PURCHASING");
    const onTime = await rfqInProgress(sales, purchasing, 0);
    expect((await changeRequestStatus(db, purchasing, { requestId: onTime.id, to: "COMPLETED" })).ok).toBe(true);
    expect((await db.request.findUniqueOrThrow({ where: { id: onTime.id } })).overdueNote).toBeNull();

    const soa = await actorOf("SOA");
    const project = await createProject(db, sales, { endUserCompany: `PT Boq ${randomBytes(3).toString("hex")}`, name: "Old BOQ" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ" });
    if (!boq.ok) throw new Error(boq.message);
    await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "IN_PROGRESS" });
    await db.request.update({ where: { id: boq.value.id }, data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });
    expect((await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "COMPLETED" })).ok).toBe(true);
  });
});
