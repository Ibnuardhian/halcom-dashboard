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

async function makeProject(owner: { id: string; role: Role }, values: { estimatedValue?: number } = {}) {
  const result = await createProject(db, owner, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "CCTV AI" });
  if (!result.ok) throw new Error(result.message);
  await db.project.update({ where: { id: result.value.id }, data: { ...values } });
  return result.value;
}

describe("updateCommercialDetails", () => {
  it("lets the Sales owner set a target margin, and logs and audits it", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 1_000_000 });

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: "12,5" } });

    expect(result).toEqual({ ok: true, changed: ["targetMargin"] });
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored.targetMargin?.toNumber()).toBe(12.5);
    const log = await db.projectChange.findMany({ where: { projectId: project.id } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ changedById: sales.id, field: "targetMargin", fromValue: null, toValue: "12.5" });
    await expect(db.auditEvent.count({ where: { entityId: project.id, action: "project.commercial_updated", actorId: sales.id } })).resolves.toBe(1);
  });

  it("changes value and target closing together, and can clear a value", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 500 });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { estimatedValue: "2.500.000.000", targetDate: "2027-01-31" } });
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored.estimatedValue?.toNumber()).toBe(2_500_000_000);
    expect(stored.targetDate?.toISOString().slice(0, 10)).toBe("2027-01-31");

    const cleared = await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetDate: "" } });
    expect(cleared).toEqual({ ok: true, changed: ["targetDate"] });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ targetDate: null });
  });

  it("lets Sales move the creation date of their project to an earlier day, logged, but never empty or in the future", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);
    const before = await db.project.findUniqueOrThrow({ where: { id: project.id } });

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { createdAt: "2026-03-02" } });

    expect(result).toEqual({ ok: true, changed: ["createdAt"] });
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored.createdAt.toISOString()).toBe("2026-03-01T17:00:00.000Z"); // midnight in Jakarta
    const fromDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(before.createdAt);
    await expect(db.projectChange.findFirst({ where: { projectId: project.id, field: "createdAt" } })).resolves.toMatchObject({ fromValue: fromDay, toValue: "2026-03-02" });
    // The same day again changes nothing.
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { createdAt: "2026-03-02" } })).resolves.toEqual({ ok: true, changed: [] });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { createdAt: "" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { createdAt: "2999-01-01" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const other = await actorOf("SALES");
    await expect(updateCommercialDetails(db, other, { projectId: project.id, values: { createdAt: "2026-01-05" } })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("takes the target margin as an amount or as a percentage, never both", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 1_000 });
    const read = () => db.project.findUniqueOrThrow({ where: { id: project.id } });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMarginValue: "150" } });
    expect(await read()).toMatchObject({ targetMargin: null });
    expect((await read()).targetMarginValue?.toNumber()).toBe(150);

    // Switching to a percentage clears the amount, and both changes are logged.
    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: "10" } });
    expect(result).toEqual({ ok: true, changed: ["targetMargin", "targetMarginValue"] });
    expect(await read()).toMatchObject({ targetMarginValue: null });
    expect((await read()).targetMargin?.toNumber()).toBe(10);

    const both = await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: "5", targetMarginValue: "9" } });
    expect(both).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await read()).targetMargin?.toNumber()).toBe(10);
  });

  it("no longer accepts a hand-set probability: it comes from Progress", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { probability: "80" } });

    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
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

    for (const values of [{ stage: "WON" }, { status: "LOST" }, { salesOwnerId: sales.id }, { code: "HIT-PROJ-999" }]) {
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
  it("changes Progress and Status, and logs the labels of the sheet", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales, { estimatedValue: 1_000 });

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "NEGOTIATE_FU", trackStatus: "BLOCK", quoteReleasedAt: "2026-10-01" } });

    expect(result).toMatchObject({ ok: true });
    const stored = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(stored).toMatchObject({ progress: "NEGOTIATE_FU", trackStatus: "BLOCK" });
    expect(stored.quoteReleasedAt?.toISOString().slice(0, 10)).toBe("2026-10-01");
    const log = await db.projectChange.findMany({ where: { projectId: project.id }, orderBy: { field: "asc" } });
    expect(log.map((row) => [row.field, row.fromValue, row.toValue])).toEqual([
      ["progress", "5% - Qualify", "60% - Negotiate (FU)"],
      ["quoteReleasedAt", null, "2026-10-01"],
      ["trackStatus", "On Track", "Block"],
    ]);
  });

  it("writes nothing when Progress is unchanged, and refuses an empty Progress or Status", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);

    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "QUALIFY" } })).resolves.toEqual({ ok: true, changed: [] });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { trackStatus: "Late" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("setting the Quoted date by hand moves Progress to Propose when it was still an Opportunity", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales); // starts at QUALIFY

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { quoteReleasedAt: "2026-05-01" } });

    expect(result).toMatchObject({ ok: true });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ progress: "PROPOSE" });
    const log = await db.projectChange.findMany({ where: { projectId: project.id }, orderBy: { field: "asc" } });
    expect(log.map((row) => [row.field, row.fromValue, row.toValue])).toEqual([
      ["progress", "5% - Qualify", "30% - Propose"],
      ["quoteReleasedAt", null, "2026-05-01"],
    ]);
  });

  it("does not move Progress backward when the Quoted date is set on a project already past it", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);
    await updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "AGREE" } });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { quoteReleasedAt: "2026-05-01" } });

    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ progress: "AGREE" });
  });

  it("setting the Won date by hand moves Progress to Closed Won from any earlier stage", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);

    const result = await updateCommercialDetails(db, sales, { projectId: project.id, values: { wonDate: "2026-06-15" } });

    expect(result).toMatchObject({ ok: true });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ progress: "CLOSED_WON" });
    await expect(db.projectChange.findFirst({ where: { projectId: project.id, field: "progress" } })).resolves.toMatchObject({ toValue: "100% - Closed Won" });
  });

  it("clearing a date, or re-submitting the same one, does not move Progress", async () => {
    const sales = await actorOf("SALES");
    const project = await makeProject(sales);
    await updateCommercialDetails(db, sales, { projectId: project.id, values: { quoteReleasedAt: "2026-05-01" } });

    await expect(updateCommercialDetails(db, sales, { projectId: project.id, values: { quoteReleasedAt: "2026-05-01" } })).resolves.toEqual({ ok: true, changed: [] });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ progress: "PROPOSE" });

    const other = await makeProject(sales);
    await updateCommercialDetails(db, sales, { projectId: other.id, values: { quoteReleasedAt: "" } });
    await expect(db.project.findUniqueOrThrow({ where: { id: other.id } })).resolves.toMatchObject({ progress: "QUALIFY" });
  });

  it("closed or done projects are not in the open pipeline", async () => {
    const sales = await actorOf("SALES");
    await makeProject(sales, { estimatedValue: 100 });
    const done = await makeProject(sales, { estimatedValue: 200 });
    const lost = await makeProject(sales, { estimatedValue: 400 });
    await updateCommercialDetails(db, sales, { projectId: done.id, values: { trackStatus: "DONE" } });
    await updateCommercialDetails(db, sales, { projectId: lost.id, values: { progress: "CLOSED_LOST" } });

    const analytics = await getPipelineAnalytics(db, sales, { salesOwnerId: sales.id });

    expect(analytics.totals).toMatchObject({ projects: 3, open: 1, openValue: 100 });
  });
});

describe("pipeline analytics", () => {
  it("sums the open pipeline of one salesperson, with margin and weighted values, and ranks the Sales Pipeline list", async () => {
    const sales = await actorOf("SALES");
    const a = await makeProject(sales, { estimatedValue: 1_000 });
    const b = await makeProject(sales, { estimatedValue: 4_000 });
    const noValue = await makeProject(sales);
    await updateCommercialDetails(db, sales, { projectId: a.id, values: { targetMargin: "10" } });
    const won = await makeProject(sales, { estimatedValue: 9_000 });
    await db.project.update({ where: { id: won.id }, data: { progress: "CLOSED_WON", finalValue: 8_000 } });

    const analytics = await getPipelineAnalytics(db, sales, { salesOwnerId: sales.id });

    expect(analytics.totals).toMatchObject({ projects: 4, open: 3, openValue: 5_000, openWeighted: 250, openTargetMargin: 100, openWithMargin: 1, wonCount: 1, wonValue: 8_000 });
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
