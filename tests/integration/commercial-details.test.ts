import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { getPipelineAnalytics, listPipelineProjects } from "@/server/projects/analytics";
import { updateCommercialDetails } from "@/server/projects/service";
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

async function makeProject(owner: { id: string; role: Role }, values: { estimatedValue?: number; probability?: number } = {}) {
  const result = await createProject(db, owner, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "CCTV AI" });
  if (!result.ok) throw new Error(result.message);
  await db.project.update({ where: { id: result.value.id }, data: { ...values } });
  return result.value;
}

describe("updateCommercialDetails", () => {
  it("lets the Sales owner set a target margin, and logs and audits it", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 1_000_000, probability: 40 });

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: "12,5", probability: "40" } });

    expect(result).toEqual({ ok: true, changed: ["targetMargin"] }); // probability did not change
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored.targetMargin?.toNumber()).toBe(12.5);
    const log = await db.projectChange.findMany({ where: { projectId: project.id } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ changedById: sales.id, field: "targetMargin", fromValue: null, toValue: "12.5" });
    await expect(db.auditEvent.count({ where: { entityId: project.id, action: "project.commercial_updated", actorId: sales.id } })).resolves.toBe(1);
  });

  it("changes value, probability and target closing together, and can clear a value", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 500, probability: 10 });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { estimatedValue: "2.500.000.000", probability: "60", targetDate: "2027-01-31" } });
    const cleared = await updateCommercialDetails(db, sales, { projectId: project.id, values: { probability: "" } });

    expect(cleared).toEqual({ ok: true, changed: ["probability"] });
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored.estimatedValue?.toNumber()).toBe(2_500_000_000);
    expect(stored.probability).toBeNull();
    expect(stored.targetDate?.toISOString().slice(0, 10)).toBe("2027-01-31");
  });

  it("refuses a Sales user on someone else's project, and the other roles that may not edit", async () => {
    const owner = await actorOf("SALES");
    const project = await makeProject(owner);

    for (const role of ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const actor = await actorOf(role);
      const result = await updateCommercialDetails(db, actor, { projectId: project.id, values: { targetMargin: "5" } });
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ targetMargin: null });
    await expect(db.projectChange.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("lets an admin support any project", async () => {
    const project = await makeProject(await actorOf("SALES"));

    const result = await updateCommercialDetails(db, await actorOf("ADMIN"), { projectId: project.id, values: { targetMargin: "8" } });

    expect(result).toEqual({ ok: true, changed: ["targetMargin"] });
  });

  it("rejects other keys, bad numbers and a deactivated user", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);

    for (const values of [{ stage: "WON" }, { finalValue: "5" }, { status: "LOST" }, { salesOwnerId: sales.id }]) {
      await expect(updateCommercialDetails(db, sales, { projectId: project.id, values })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    for (const bad of ["101", "-1", "abc", "12.345"]) {
      await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: bad } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: "5" } })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ targetMargin: null, progress: "QUALIFY" });
  });

  it("the database rejects a margin outside 0 to 100 even when the service is bypassed", async () => {
    const project = await makeProject(await actorOf("SALES"));

    await expect(db.project.update({ where: { id: project.id }, data: { targetMargin: 120 } })).rejects.toThrow(/projects_target_margin_range_chk/);
  });
});

describe("Progress, Status and Quote released", () => {
  it("sets the probability a Progress step stands for, and logs the labels", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 1_000, probability: 5 });

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "NEGOTIATE_FU", trackStatus: "BLOCK", quoteReleasedAt: "2026-10-01" } });

    expect(result).toMatchObject({ ok: true });
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored).toMatchObject({ progress: "NEGOTIATE_FU", trackStatus: "BLOCK", probability: 60 });
    expect(stored.quoteReleasedAt?.toISOString().slice(0, 10)).toBe("2026-10-01");
    const log = await db.projectChange.findMany({ where: { projectId: project.id }, orderBy: { field: "asc" } });
    expect(log.map((row) => [row.field, row.fromValue, row.toValue])).toEqual([
      ["probability", "5", "60"],
      ["progress", "5% - Qualify", "60% - Negotiate (FU)"],
      ["quoteReleasedAt", null, "2026-10-01"],
      ["trackStatus", "On Track", "Block"],
    ]);
  });

  it("keeps a probability that was changed by hand together with the new Progress", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { probability: 5 });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "AGREE", probability: "80" } });

    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ progress: "AGREE", probability: 80 });
  });

  it("does not touch the probability when Progress is unchanged, and refuses an empty Progress or Status", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { probability: 42 });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "QUALIFY", probability: "42" } });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ probability: 42 });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { trackStatus: "Late" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("closed or done projects are not in the open pipeline", async () => {
    const sales = await actorOf("SALES");
    await makeProject(sales, { estimatedValue: 100, probability: 50 });
    const done = await makeProject(sales, { estimatedValue: 200, probability: 50 });
    const lost = await makeProject(sales, { estimatedValue: 400, probability: 0 });
    await updateCommercialDetails(db, sales, { projectId: done.id, values: { trackStatus: "DONE" } });
    await updateCommercialDetails(db, sales, { projectId: lost.id, values: { progress: "CLOSED_LOST" } });

    const analytics = await getPipelineAnalytics(db, sales, { salesOwnerId: sales.id });

    expect(analytics.totals).toMatchObject({ projects: 3, open: 1, openValue: 100 });
  });
});

describe("pipeline analytics", () => {
  it("sums the open pipeline of one salesperson, with margin and weighted values, and ranks the Sales Pipeline list", async () => {
    const sales = await actorOf("SALES");
    const a = await makeProject(sales, { estimatedValue: 1_000, probability: 50 });
    const b = await makeProject(sales, { estimatedValue: 4_000, probability: 25 });
    const noValue = await makeProject(sales);
    await updateCommercialDetails(db, sales, { projectId: a.id, values: { targetMargin: "10" } });
    const won = await makeProject(sales, { estimatedValue: 9_000, probability: 100 });
    await db.project.update({ where: { id: won.id }, data: { progress: "CLOSED_WON", finalValue: 8_000 } });

    const analytics = await getPipelineAnalytics(db, sales, { salesOwnerId: sales.id });

    expect(analytics.totals).toMatchObject({ projects: 4, open: 3, openValue: 5_000, openWeighted: 1_500, openTargetMargin: 100, openWithMargin: 1, wonCount: 1, wonValue: 8_000 });
    expect(analytics.byProgress.find((s) => s.key === "QUALIFY")).toMatchObject({ count: 3, value: 5_000 });
    expect(analytics.byProgress.find((s) => s.key === "CLOSED_WON")).toMatchObject({ count: 1, value: 9_000 });
    expect(analytics.byPrincipal).toMatchObject([{ label: "Not set", count: 4 }]);

    const list = await listPipelineProjects(db, sales, sales.id);
    // Open first: value but no margin (b), then by value (a), then no value (noValue); the closed project last.
    expect(list.map((row) => row.code)).toEqual([b.code, a.code, noValue.code, won.code]);
    expect(list[1]).toMatchObject({ accountName: expect.any(String), projectTitle: "CCTV AI", targetMargin: 10, estimatedGrossProfit: 100, isOpen: true });
    expect(list[3]).toMatchObject({ progress: "CLOSED_WON", isOpen: false });
    expect(list[1]!.lastUpdated).toBeInstanceOf(Date);
  });
});
