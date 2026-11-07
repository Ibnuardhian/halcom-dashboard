import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { getManagementDashboard } from "@/server/dashboards/management";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const email = `${role.toLowerCase()}.${randomBytes(4).toString("hex")}@d${randomBytes(3).toString("hex")}.example.invalid`;
  const user = await makeUser(role, { email });
  return { id: user.id, role: user.role, email };
}

async function boqFor(sales: Awaited<ReturnType<typeof actorOf>>) {
  const project = await createProject(db, sales, { endUserCompany: "PT Management", name: "Concern demo" });
  if (!project.ok) throw new Error(project.message);
  const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "Need a BOQ" });
  if (!boq.ok) throw new Error(boq.message);
  return boq.value;
}

describe("the Management dashboard data", () => {
  it("ranks an overdue BOQ without a PIC as a Danger and a Warning, linking to the filtered list", async () => {
    const sales = await actorOf("SALES");
    const management = await actorOf("MANAGEMENT");
    const boq = await boqFor(sales);
    // Thirty days old: far past the SLA, and nobody has picked it up.
    await db.request.update({ where: { id: boq.id }, data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });

    const data = await getManagementDashboard(db, management);
    const soa = data.concerns.filter((concern) => concern.area === "SOA");
    expect(soa.find((concern) => concern.key === "SOA:overdue")).toMatchObject({ severity: "DANGER", href: "/requests/boq?sla=overdue" });
    expect(soa.find((concern) => concern.key === "SOA:unassigned")).toMatchObject({ severity: "WARNING", href: "/requests/boq?assignee=none&status=open" });
    expect(data.teams.SOA.metrics.overdue).toBeGreaterThanOrEqual(1);
    // Loudest first.
    const order = data.concerns.map((concern) => concern.severity);
    expect(order).toEqual([...order].sort((a, b) => ["DANGER", "WARNING", "INFO"].indexOf(a) - ["DANGER", "WARNING", "INFO"].indexOf(b)));
    // Six months for each team, the current one first.
    expect(data.monthly.SOA).toHaveLength(6);
    expect(data.monthly.PURCHASING).toHaveLength(6);
  });

  it("counts a completed BOQ nobody continued, and how long it has waited", async () => {
    const sales = await actorOf("SALES");
    const soa = await actorOf("SOA");
    const management = await actorOf("MANAGEMENT");
    const boq = await boqFor(sales);
    expect((await changeRequestStatus(db, soa, { requestId: boq.id, to: "COMPLETED" })).ok).toBe(true);
    await db.request.update({ where: { id: boq.id }, data: { completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) } });

    const data = await getManagementDashboard(db, management);
    expect(data.awaitingHandoff.count).toBeGreaterThanOrEqual(1);
    expect(data.awaitingHandoff.oldestDays).toBeGreaterThanOrEqual(10);
    expect(data.concerns.find((concern) => concern.key === "handoff")).toMatchObject({ severity: "WARNING", area: "Lintas tim", href: "/handoffs" });
  });

  it("reads the Finance flags only for a viewer who may read the crosscheck", async () => {
    const management = await getManagementDashboard(db, await actorOf("MANAGEMENT"));
    expect(management.financeFlagged).not.toBeNull();
    const sales = await getManagementDashboard(db, await actorOf("SALES"));
    expect(sales.financeFlagged).toBeNull();
    expect(sales.concerns.some((concern) => concern.area === "Finance")).toBe(false);
  });
});
