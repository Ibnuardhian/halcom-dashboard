import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { updateCommercialDetails } from "@/server/projects/service";
import { createProject } from "@/server/requests/service";
import { getOwnTargets, getSalesBreakdown, getTargetSummary, getTargetYears, saveSalesTargets } from "@/server/targets/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

const blank = { grossProfit: "" };
const months = (overrides: Record<number, { grossProfit: string }> = {}) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, overrides[i + 1] ?? blank]));
// Test files share one database and the year is part of the key, so each test uses its own year.
const yearOf = () => 2100 - Math.floor(Math.random() * 90);

describe("saveSalesTargets", () => {
  it("stores a salesperson's own targets per month, derives the quarters from them, and audits what changed", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();

    const result = await saveSalesTargets(db, sales, { year, months: months({ 1: { grossProfit: "100.000.000" }, 3: { grossProfit: "50" }, 7: { grossProfit: "1000" } }) });

    expect(result).toEqual({ ok: true, changed: [1, 3, 7] });
    const own = await getOwnTargets(db, sales, year);
    expect(own.months).toMatchObject({ 1: 100_000_000, 2: null, 3: 50, 7: 1000 });
    expect(own.quarters).toEqual({ 1: 100_000_050, 2: null, 3: 1000, 4: null });
    const audit = await db.auditEvent.findMany({ where: { action: "targets.saved", actorId: sales.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before: { January: { grossProfit: null } }, after: { January: { grossProfit: 100_000_000 } } });
  });

  it("changes nothing and audits nothing when nothing changed, and a blank box removes the month and its empty quarter", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    const input = { year, months: months({ 5: { grossProfit: "50" } }) };
    await saveSalesTargets(db, sales, input);

    expect(await saveSalesTargets(db, sales, input)).toEqual({ ok: true, changed: [] });
    expect(await saveSalesTargets(db, sales, { year, months: months() })).toEqual({ ok: true, changed: [5] });

    await expect(db.salesTarget.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(0);
    await expect(db.salesTargetMonth.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(0);
    await expect(db.auditEvent.count({ where: { action: "targets.saved", actorId: sales.id } })).resolves.toBe(2);
  });

  it("refuses everyone but Sales, bad numbers, and a year outside the range", async () => {
    const year = yearOf();
    for (const role of ["ADMIN", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      await expect(saveSalesTargets(db, await actorOf(role), { year, months: months({ 1: { grossProfit: "1" } }) })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const sales = await actorOf("SALES");
    await expect(saveSalesTargets(db, sales, { year, months: months({ 1: { grossProfit: "-5" } }) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year, months: months({ 12: { grossProfit: "abc" } }) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year: 1999, months: months() })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year, months: { ...months(), 13: blank } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    await expect(saveSalesTargets(db, sales, { year, months: months({ 1: { grossProfit: "1" } }) })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("takes gross profit only: a revenue figure in the request is refused", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();

    const result = await saveSalesTargets(db, sales, { year, months: { ...months(), 1: { revenue: "1000", grossProfit: "10" } } });

    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.salesTargetMonth.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(0);
  });

  it("leaves a revenue target stored by an earlier version as it is: never shown, never changed, never lost", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    await db.salesTarget.create({ data: { salesUserId: sales.id, year, quarter: 1, revenueTarget: 500 } });

    expect((await getOwnTargets(db, sales, year)).quarters[1]).toBeNull();
    expect(await saveSalesTargets(db, sales, { year, months: months({ 2: { grossProfit: "50" } }) })).toEqual({ ok: true, changed: [2] });
    await expect(db.salesTarget.findFirstOrThrow({ where: { salesUserId: sales.id, year, quarter: 1 } })).resolves.toMatchObject({ grossProfitTarget: expect.anything(), revenueTarget: expect.anything() });
    // Clearing the month keeps the quarter row (it still holds the old revenue figure); the form shows nothing for it.
    expect(await saveSalesTargets(db, sales, { year, months: months() })).toEqual({ ok: true, changed: [2] });
    expect((await db.salesTarget.findFirstOrThrow({ where: { salesUserId: sales.id, year, quarter: 1 } })).revenueTarget?.toNumber()).toBe(500);
    expect((await getOwnTargets(db, sales, year)).quarters[1]).toBeNull();
  });

  it("keeps a quarter target entered before months existed until its months are filled in, and never spreads it by itself", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    await db.salesTarget.create({ data: { salesUserId: sales.id, year, quarter: 2, grossProfitTarget: 300 } });

    await saveSalesTargets(db, sales, { year, months: months({ 10: { grossProfit: "7" } }) });

    expect((await getOwnTargets(db, sales, year)).quarters).toMatchObject({ 2: 300, 4: 7 });
    const summary = await getTargetSummary(db, sales, { year, salesOwnerId: sales.id });
    expect(summary.total.grossProfit.target).toBe(307);
    expect(summary.months.map((m) => m.target)).toEqual([null, null, null, null, null, null, null, null, null, 7, null, null]);
  });

  it("only ever writes the signed-in salesperson's own rows, whatever else the request names", async () => {
    const sales = await actorOf("SALES");
    const other = await actorOf("SALES");
    const year = yearOf();

    await saveSalesTargets(db, sales, { year, salesUserId: other.id, months: months({ 1: { grossProfit: "10" } }) }).catch(() => undefined);
    await saveSalesTargets(db, sales, { year, months: months({ 1: { grossProfit: "10" } }) });

    await expect(db.salesTargetMonth.count({ where: { salesUserId: other.id } })).resolves.toBe(0);
    await expect(db.salesTargetMonth.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(1);
  });

  it("the database rejects a negative target, a bad quarter, a bad month and an empty row", async () => {
    const sales = await actorOf("SALES");
    const base = { salesUserId: sales.id, year: 2099 };

    await expect(db.salesTarget.create({ data: { ...base, quarter: 1, revenueTarget: -1 } })).rejects.toThrow(/sales_targets_not_negative_chk/);
    await expect(db.salesTarget.create({ data: { ...base, quarter: 5, revenueTarget: 1 } })).rejects.toThrow(/sales_targets_quarter_chk/);
    await expect(db.salesTarget.create({ data: { ...base, quarter: 2 } })).rejects.toThrow(/sales_targets_has_target_chk/);
    await expect(db.salesTargetMonth.create({ data: { ...base, month: 13, grossProfitTarget: 1 } })).rejects.toThrow(/sales_target_months_month_chk/);
    await expect(db.salesTargetMonth.create({ data: { ...base, month: 1, grossProfitTarget: -1 } })).rejects.toThrow(/sales_target_months_not_negative_chk/);
  });
});

describe("getTargetSummary", () => {
  it("measures a salesperson's won projects and open pipeline against their targets", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    const tag = randomBytes(3).toString("hex");
    await saveSalesTargets(db, sales, { year, months: months({ 4: { grossProfit: "40" }, 5: { grossProfit: "60" } }) });

    const make = async (name: string) => {
      const created = await createProject(db, sales, { endUserCompany: `PT ${tag}`, name });
      if (!created.ok) throw new Error(created.message);
      return created.value.id;
    };
    const won = await make("won");
    await db.project.update({ where: { id: won }, data: { progress: "CLOSED_WON", estimatedValue: 700, finalValue: 600, targetMargin: 20, wonDate: new Date(`${year}-05-10T00:00:00Z`) } });
    const open = await make("open");
    await db.project.update({ where: { id: open }, data: { estimatedValue: 400, targetMargin: 10, targetDate: new Date(`${year}-06-20T00:00:00Z`) } });
    const stranger = await actorOf("SALES");
    const theirs = await createProject(db, stranger, { endUserCompany: `PT ${tag}`, name: "not mine" });
    if (theirs.ok) await db.project.update({ where: { id: theirs.value.id }, data: { progress: "CLOSED_WON", estimatedValue: 99_999, wonDate: new Date(`${year}-05-10T00:00:00Z`) } });

    const summary = await getTargetSummary(db, sales, { year, salesOwnerId: sales.id });

    expect(summary.quarters[1]!.revenue).toEqual({ target: null, won: 600, forecast: 20 }); // 400 × 5% (Qualify, the starting step)
    expect(summary.quarters[1]!.grossProfit).toEqual({ target: 100, won: 120, forecast: 2 });
    expect(summary.total.revenue).toEqual({ target: null, won: 600, forecast: 20 });
    // By month: the won project (May) adds 600 × 20%; the open project is not part of achieved and counts, unweighted, as 400 × 10% of open pipeline.
    expect(summary.months[4]).toEqual({ month: 5, target: 60, won: 120 });
    expect(summary.months[3]).toEqual({ month: 4, target: 40, won: 0 });
    expect(summary.wonCount).toBe(1);
    expect(summary.openPipelineGp).toBe(40);
  });

  it("closing a project as won without a won date puts it in today's quarter", async () => {
    const sales = await actorOf("SALES");
    const created = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "auto date" });
    if (!created.ok) throw new Error(created.message);
    await db.project.update({ where: { id: created.value.id }, data: { estimatedValue: 100 } });

    const result = await updateCommercialDetails(db, sales, { projectId: created.value.id, values: { progress: "CLOSED_WON", wonDate: "" } });

    expect(result.ok).toBe(true);
    const stored = await db.project.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(stored.wonDate?.toISOString().slice(0, 10)).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()));
    const log = await db.projectChange.findMany({ where: { projectId: created.value.id } });
    expect(log.map((row) => row.field).sort()).toEqual(["progress", "wonDate"]);

    const kept = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "own date" });
    if (!kept.ok) throw new Error(kept.message);
    await updateCommercialDetails(db, sales, { projectId: kept.value.id, values: { progress: "CLOSED_WON", wonDate: "2026-01-15", finalValue: "250" } });
    await expect(db.project.findUniqueOrThrow({ where: { id: kept.value.id } })).resolves.toMatchObject({ finalValue: expect.anything() });
    expect((await db.project.findUniqueOrThrow({ where: { id: kept.value.id } })).wonDate?.toISOString().slice(0, 10)).toBe("2026-01-15");
  });
});

describe("team view and years", () => {
  it("lists every salesperson with their target, won GP and won count, and refuses a salesperson", async () => {
    const a = await actorOf("SALES");
    const year = yearOf();
    await saveSalesTargets(db, a, { year, months: months({ 3: { grossProfit: "1000" } }) });
    const created = await createProject(db, a, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "won" });
    if (!created.ok) throw new Error(created.message);
    await db.project.update({ where: { id: created.value.id }, data: { progress: "CLOSED_WON", estimatedValue: 500, targetMargin: 10, wonDate: new Date(`${year}-03-02T00:00:00Z`) } });

    const rows = await getSalesBreakdown(db, await actorOf("ADMIN"), year);

    expect(rows.find((row) => row.id === a.id)).toMatchObject({ target: 1000, won: 50, wonCount: 1 });
    await expect(getSalesBreakdown(db, a, year)).rejects.toThrow(/Forbidden/);
  });

  it("offers the years that have a target or a won project, plus this year and the next", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf() - 1; // the page offers 2001 to 2099
    await saveSalesTargets(db, sales, { year, months: months({ 1: { grossProfit: "1" } }) });

    const years = await getTargetYears(db, sales, { salesOwnerId: sales.id, thisYear: 2026 });

    expect(years).toEqual([2026, 2027, year].sort((x, y) => x - y));
  });
});
