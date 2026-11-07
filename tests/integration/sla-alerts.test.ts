import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@/domain/access/roles";
import { SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND } from "@/domain/notifications/kinds";
import { addWorkingDays } from "@/domain/requests/sla";
import { getDb } from "@/lib/db";
import { countUnreadBySeverity, listNotifications, markAllRead } from "@/server/notifications/service";
import { scanSlaAlerts } from "@/server/notifications/sla-alerts";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { getTeamSetting } from "@/server/settings/team-settings";
import { makeUser } from "./helpers";

// The scan reads every open request of the shared test database, so a test may take longer than the default.
vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const SLA_KINDS = [SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND];

afterAll(async () => {
  // The scan looks at every open request of the database, so it leaves alerts for requests of other tests: remove them all.
  await db.notification.deleteMany({ where: { kind: { in: SLA_KINDS } } });
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const email = `${role.toLowerCase()}.${randomBytes(4).toString("hex")}@d${randomBytes(3).toString("hex")}.example.invalid`;
  const user = await makeUser(role, { email });
  return { id: user.id, role: user.role, email };
}

/** An open BOQ and the people around it: the team (SOA), an admin, a manager, a purchasing user and a salesperson. */
async function openBoq() {
  const [sales, soa, admin, management, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("ADMIN"), actorOf("MANAGEMENT"), actorOf("PURCHASING")]);
  const project = await createProject(db, sales, { endUserCompany: "PT Alert", name: "SLA alert" });
  if (!project.ok) throw new Error(project.message);
  const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "Need a BOQ" });
  if (!boq.ok) throw new Error(boq.message);
  const row = await db.request.findUniqueOrThrow({ where: { id: boq.value.id } });
  const { sla } = await getTeamSetting(db, "SOA");
  return {
    sales, soa, admin, management, purchasing, boq: row,
    expectedAt: addWorkingDays(row.createdAt, sla.minDays),
    dueAt: addWorkingDays(row.createdAt, sla.maxDays),
  };
}

const alertsOf = (userId: string, requestId: string) => db.notification.findMany({ where: { recipientId: userId, requestId, kind: { in: SLA_KINDS } }, orderBy: { createdAt: "asc" } });
const hour = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

describe("the SLA alert scan", () => {
  it("writes nothing while the request is on track", async () => {
    const { soa, boq, expectedAt } = await openBoq();
    await scanSlaAlerts(db, hour(expectedAt, -2));
    expect(await alertsOf(soa.id, boq.id)).toHaveLength(0);
  });

  it("does not alert a deadline that passed more than a week ago (no flood on the first scan)", async () => {
    const { soa, admin, boq, dueAt } = await openBoq();
    await scanSlaAlerts(db, hour(dueAt, 24 * 8));
    expect(await alertsOf(soa.id, boq.id)).toHaveLength(0);
    expect(await alertsOf(admin.id, boq.id)).toHaveLength(0);
    // Inside the week it still alerts.
    await scanSlaAlerts(db, hour(dueAt, 24 * 6));
    expect((await alertsOf(admin.id, boq.id)).map((row) => row.severity)).toEqual(["DANGER"]);
  });

  it("warns the team that works the request, and nobody else, once the expected date is reached", async () => {
    const { soa, admin, management, purchasing, sales, boq, expectedAt } = await openBoq();
    await scanSlaAlerts(db, hour(expectedAt, 1));

    const [forSoa] = await alertsOf(soa.id, boq.id);
    expect(forSoa).toMatchObject({ kind: SLA_DUE_SOON_KIND, severity: "WARNING", href: `/request/${boq.code}`, readAt: null });
    expect(forSoa?.title).toContain(boq.code);
    for (const other of [admin, management, purchasing, sales]) expect(await alertsOf(other.id, boq.id)).toHaveLength(0);
  });

  it("does not write the same alert twice when the scan runs again", async () => {
    const { soa, boq, expectedAt } = await openBoq();
    await scanSlaAlerts(db, hour(expectedAt, 1));
    const second = await scanSlaAlerts(db, hour(expectedAt, 2));
    expect(second.warnings).toBe(0);
    expect(await alertsOf(soa.id, boq.id)).toHaveLength(1);
  });

  it("raises a Danger past the deadline for the team, Admin and Management, after the Warning", async () => {
    const { soa, admin, management, purchasing, boq, expectedAt, dueAt } = await openBoq();
    await scanSlaAlerts(db, hour(expectedAt, 1));
    await scanSlaAlerts(db, hour(dueAt, 2));

    expect((await alertsOf(soa.id, boq.id)).map((row) => row.severity)).toEqual(["WARNING", "DANGER"]);
    for (const escalated of [admin, management]) {
      const rows = await alertsOf(escalated.id, boq.id);
      expect(rows.map((row) => row.severity)).toEqual(["DANGER"]);
      expect(rows[0]).toMatchObject({ kind: SLA_OVERDUE_KIND });
    }
    expect(await alertsOf(purchasing.id, boq.id)).toHaveLength(0);
  });

  it("closes the alerts when the request is completed, and counts them by level for the bell", async () => {
    const { soa, boq, expectedAt, dueAt } = await openBoq();
    await scanSlaAlerts(db, hour(dueAt, 2));
    expect((await countUnreadBySeverity(db, soa.id)).DANGER).toBeGreaterThanOrEqual(1);

    expect((await changeRequestStatus(db, soa, { requestId: boq.id, to: "COMPLETED" })).ok).toBe(true);
    const rows = await alertsOf(soa.id, boq.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.readAt !== null)).toBe(true);

    // A later scan finds nothing new for a finished request.
    await scanSlaAlerts(db, hour(expectedAt, 24 * 30));
    expect(await alertsOf(soa.id, boq.id)).toHaveLength(rows.length);
  });

  it("marks the alerts of a request that was deleted as read on the next scan", async () => {
    const { soa, boq, dueAt } = await openBoq();
    await scanSlaAlerts(db, hour(dueAt, 2));
    await db.request.update({ where: { id: boq.id }, data: { deletedAt: new Date() } });
    const result = await scanSlaAlerts(db, hour(dueAt, 3));
    expect(result.closed).toBeGreaterThan(0);
    expect((await alertsOf(soa.id, boq.id)).every((row) => row.readAt !== null)).toBe(true);
  });

  it("writes nothing for a cancelled request", async () => {
    const { soa, boq, dueAt } = await openBoq();
    expect((await changeRequestStatus(db, soa, { requestId: boq.id, to: "CANCELLED", reason: "Customer batal" })).ok).toBe(true);
    await scanSlaAlerts(db, hour(dueAt, 2));
    expect(await alertsOf(soa.id, boq.id)).toHaveLength(0);
  });

  it("lists notifications by level and reads only one level at a time", async () => {
    const { soa, dueAt } = await openBoq();
    await scanSlaAlerts(db, hour(dueAt, 2));
    const info = await db.notification.create({ data: { recipientId: soa.id, kind: "request.created", title: "BOQ baru", href: "/requests" } });

    const danger = await listNotifications(db, soa.id, "DANGER");
    expect(danger.length).toBeGreaterThan(0);
    expect(danger.every((row) => row.severity === "DANGER")).toBe(true);
    expect((await listNotifications(db, soa.id, "INFO")).map((row) => row.id)).toContain(info.id);
    expect((await listNotifications(db, soa.id, "INFO")).some((row) => SLA_KINDS.includes(row.kind))).toBe(false);

    await markAllRead(db, soa.id, "DANGER");
    const unread = await countUnreadBySeverity(db, soa.id);
    expect(unread.DANGER).toBe(0);
    expect(unread.INFO).toBeGreaterThanOrEqual(1);
  });
});
