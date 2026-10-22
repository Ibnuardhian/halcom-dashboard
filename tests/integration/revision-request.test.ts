import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { REVISION_REQUESTED_KIND, REVISION_STARTED_KIND } from "@/domain/notifications/kinds";
import { getDb } from "@/lib/db";
import { hasUnreadRevision, markAllRead } from "@/server/notifications/service";
import { changeRequestStatus, createProject, createRequest, requestRevision, type Actor } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role): Promise<Actor & { email: string }> {
  const email = `${role.toLowerCase()}.${randomBytes(4).toString("hex")}@d${randomBytes(3).toString("hex")}.example.invalid`;
  const user = await makeUser(role, { email });
  return { id: user.id, role: user.role, email };
}

/** A Sales user, a project they own with an SOA technical PIC, and a BOQ completed by SOA. */
async function completedBoq() {
  const sales = await actorOf("SALES");
  const soa = await actorOf("SOA");
  const technicalPic = await makeUser("SOA");
  const project = await createProject(db, sales, { endUserCompany: "PT Rev", name: "Revision" });
  if (!project.ok) throw new Error(project.message);
  await db.project.update({ where: { id: project.value.id }, data: { technicalPicId: technicalPic.id } });
  const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "Need a BOQ" });
  if (!boq.ok) throw new Error(boq.message);
  expect((await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "COMPLETED" })).ok).toBe(true);
  return { sales, soa, technicalPic, projectId: project.value.id, boq: boq.value };
}

const about = (userId: string, code: string) => db.notification.findMany({ where: { recipientId: userId, href: `/request/${code}` }, orderBy: { createdAt: "asc" } });

describe("Sales ask for a revision of a completed BOQ", () => {
  it("moves the ticket straight to Revision, keeps the completion and the reason, and tells SOA with a revision notification", async () => {
    const { sales, soa, technicalPic, boq } = await completedBoq();
    const before = await db.request.findUniqueOrThrow({ where: { id: boq.id } });

    const result = await requestRevision(db, sales, { requestId: boq.id, reason: "  Customer wants 4 more cameras  " });

    expect(result).toEqual({ ok: true, value: { code: boq.code } });
    const row = await db.request.findUniqueOrThrow({ where: { id: boq.id }, include: { statusHistory: { orderBy: { changedAt: "asc" } } } });
    expect(row.status).toBe("REVISION");
    expect(row.completedAt).toEqual(before.completedAt); // the first completion stays: a revision does not make the SLA late
    expect(row.statusHistory.at(-1)).toMatchObject({ fromStatus: "COMPLETED", toStatus: "REVISION", changedById: sales.id, reason: "Customer wants 4 more cameras" });
    await expect(db.auditEvent.count({ where: { action: "request.revision_requested", entityId: boq.id } })).resolves.toBe(1);

    // SOA (the team's account and the project's technical PIC) is told; the salesperson who asked is not.
    for (const user of [soa, technicalPic]) {
      const notes = await about(user.id, boq.code);
      expect(notes.map((n) => n.kind)).toContain(REVISION_REQUESTED_KIND);
    }
    expect((await about(sales.id, boq.code)).map((n) => n.kind)).not.toContain(REVISION_REQUESTED_KIND);
  });

  it("makes the bell urgent until the revision notification is read", async () => {
    const { sales, technicalPic, boq } = await completedBoq();
    expect(await hasUnreadRevision(db, technicalPic.id)).toBe(false);

    await requestRevision(db, sales, { requestId: boq.id, reason: "More cameras" });
    expect(await hasUnreadRevision(db, technicalPic.id)).toBe(true);

    await markAllRead(db, technicalPic.id);
    expect(await hasUnreadRevision(db, technicalPic.id)).toBe(false);
  });

  it("is refused for anything but a completed BOQ, an empty reason, and a project that is not the salesperson's", async () => {
    const { sales, soa, projectId, boq } = await completedBoq();
    const stranger = await actorOf("SALES");

    expect(await requestRevision(db, sales, { requestId: boq.id, reason: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await requestRevision(db, stranger, { requestId: boq.id, reason: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await requestRevision(db, await actorOf(role), { requestId: boq.id, reason: "x" }), role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }

    const fresh = await createRequest(db, sales, { projectId, type: "BOQ", title: "Open one" });
    if (!fresh.ok) throw new Error(fresh.message);
    expect(await requestRevision(db, sales, { requestId: fresh.value.id, reason: "x" })).toMatchObject({ ok: false, code: "INVALID_STATE" });

    const rfq = await createRequest(db, sales, { projectId, type: "RFQ", title: "An RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);
    expect((await changeRequestStatus(db, await actorOf("PURCHASING"), { requestId: rfq.value.id, to: "COMPLETED" })).ok).toBe(true);
    expect(await requestRevision(db, sales, { requestId: rfq.value.id, reason: "x" })).toMatchObject({ ok: false, code: "INVALID_STATE" });

    // Once in Revision it cannot be asked for again, and SOA completes it as before.
    expect((await requestRevision(db, sales, { requestId: boq.id, reason: "ok" })).ok).toBe(true);
    expect(await requestRevision(db, sales, { requestId: boq.id, reason: "again" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await changeRequestStatus(db, soa, { requestId: boq.id, to: "COMPLETED" })).ok).toBe(true);
  });

  it("works for any salesperson on a project from another source, and for an admin", async () => {
    const soa = await actorOf("SOA");
    const created = await createProject(db, soa, { endUserCompany: "PT Other", name: "External", sourceType: "OTHER", externalSourceName: "Partner Co" });
    if (!created.ok) throw new Error(created.message);
    const boq = await createRequest(db, soa, { projectId: created.value.id, type: "BOQ", title: "BOQ for other" });
    if (!boq.ok) throw new Error(boq.message);
    expect((await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "COMPLETED" })).ok).toBe(true);

    expect((await requestRevision(db, await actorOf("SALES"), { requestId: boq.value.id, reason: "Changes" })).ok).toBe(true);
    expect((await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "COMPLETED" })).ok).toBe(true);
    expect((await requestRevision(db, await actorOf("ADMIN"), { requestId: boq.value.id, reason: "Admin on behalf" })).ok).toBe(true);
  });

  it("also marks the notification red when SOA moves a BOQ to Revision on the board", async () => {
    const { sales, soa, boq } = await completedBoq();

    expect((await changeRequestStatus(db, soa, { requestId: boq.id, to: "REVISION" })).ok).toBe(true);

    expect((await about(sales.id, boq.code)).map((n) => n.kind)).toContain(REVISION_STARTED_KIND);
    expect(await hasUnreadRevision(db, sales.id)).toBe(true);
  });
});
