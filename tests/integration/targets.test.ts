import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { updateCommercialDetails } from "@/server/projects/service";
import { createProject } from "@/server/requests/service";
import { getOwnTargets, getTargetSummary, saveSalesTargets } from "@/server/targets/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

const blank = { revenue: "", grossProfit: "" };
const quarters = (overrides: Record<number, { revenue: string; grossProfit: string }> = {}) => ({ 1: blank, 2: blank, 3: blank, 4: blank, ...overrides });
// Test files share one database and the year is part of the key, so each test uses its own year.
const yearOf = () => 2100 - Math.floor(Math.random() * 90);

describe("saveSalesTargets", () => {
  it("stores a salesperson's own targets per quarter, and audits what changed", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();

    const result = await saveSalesTargets(db, sales, {
      year,
      quarters: quarters({ 1: { revenue: "2.500.000.000", grossProfit: "300000000" }, 3: { revenue: "1000", grossProfit: "" } }),
    });

    expect(result).toEqual({ ok: true, changed: [1, 3] });
    expect(await getOwnTargets(db, sales, year)).toEqual({
      1: { revenue: 2_500_000_000, grossProfit: 300_000_000 },
      2: { revenue: null, grossProfit: null },
      3: { revenue: 1000, grossProfit: null },
      4: { revenue: null, grossProfit: null },
    });
    const audit = await db.auditEvent.findMany({ where: { action: "targets.saved", actorId: sales.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before: { Q1: { revenue: null, grossProfit: null } }, after: { Q1: { revenue: 2_500_000_000, grossProfit: 300_000_000 } } });
  });

  it("changes nothing and audits nothing when nothing changed, and a blank pair removes the quarter", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    const input = { year, quarters: quarters({ 2: { revenue: "500", grossProfit: "50" } }) };
    await saveSalesTargets(db, sales, input);

    expect(await saveSalesTargets(db, sales, input)).toEqual({ ok: true, changed: [] });
    expect(await saveSalesTargets(db, sales, { year, quarters: quarters() })).toEqual({ ok: true, changed: [2] });

    await expect(db.salesTarget.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(0);
    await expect(db.auditEvent.count({ where: { action: "targets.saved", actorId: sales.id } })).resolves.toBe(2);
  });

  it("refuses everyone but Sales, bad numbers, and a year outside the range", async () => {
    const year = yearOf();
    for (const role of ["ADMIN", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      await expect(saveSalesTargets(db, await actorOf(role), { year, quarters: quarters({ 1: { revenue: "1", grossProfit: "" } }) })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const sales = await actorOf("SALES");
    await expect(saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { revenue: "-5", grossProfit: "" } }) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year, quarters: quarters({ 4: { revenue: "", grossProfit: "abc" } }) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year: 1999, quarters: quarters() })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year, quarters: { ...quarters(), 5: blank } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    await expect(saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { revenue: "1", grossProfit: "" } }) })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("only ever writes the signed-in salesperson's own rows, whatever else the request names", async () => {
    const sales = await actorOf("SALES");
    const other = await actorOf("SALES");
    const year = yearOf();

    await saveSalesTargets(db, sales, { year, salesUserId: other.id, quarters: quarters({ 1: { revenue: "10", grossProfit: "" } }) }).catch(() => undefined);
    await saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { revenue: "10", grossProfit: "" } }) });

    await expect(db.salesTarget.count({ where: { salesUserId: other.id } })).resolves.toBe(0);
    await expect(db.salesTarget.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(1);
  });

  it("the database rejects a negative target, a bad quarter and an empty row", async () => {
    const sales = await actorOf("SALES");
    const base = { salesUserId: sales.id, year: 2099 };

    await expect(db.salesTarget.create({ data: { ...base, quarter: 1, revenueTarget: -1 } })).rejects.toThrow(/sales_targets_not_negative_chk/);
    await expect(db.salesTarget.create({ data: { ...base, quarter: 5, revenueTarget: 1 } })).rejects.toThrow(/sales_targets_quarter_chk/);
    await expect(db.salesTarget.create({ data: { ...base, quarter: 2 } })).rejects.toThrow(/sales_targets_has_target_chk/);
  });
});

describe("getTargetSummary", () => {
  it("measures a salesperson's won projects and open pipeline against their targets", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    const tag = randomBytes(3).toString("hex");
    await saveSalesTargets(db, sales, { year, quarters: quarters({ 2: { revenue: "1000", grossProfit: "100" } }) });

    const make = async (name: string) => {
      const created = await createProject(db, sales, { endUserCompany: `PT ${tag}`, name });
      if (!created.ok) throw new Error(created.message);
      return created.value.id;
    };
    const won = await make("won");
    await db.project.update({ where: { id: won }, data: { progress: "CLOSED_WON", estimatedValue: 700, finalValue: 600, targetMargin: 20, wonDate: new Date(`${year}-05-10T00:00:00Z`) } });
    const open = await make("open");
    await db.project.update({ where: { id: open }, data: { estimatedValue: 400, probability: 50, targetMargin: 10, targetDate: new Date(`${year}-06-20T00:00:00Z`) } });
    const stranger = await actorOf("SALES");
    const theirs = await createProject(db, stranger, { endUserCompany: `PT ${tag}`, name: "not mine" });
    if (theirs.ok) await db.project.update({ where: { id: theirs.value.id }, data: { progress: "CLOSED_WON", estimatedValue: 99_999, wonDate: new Date(`${year}-05-10T00:00:00Z`) } });

    const summary = await getTargetSummary(db, sales, { year, salesOwnerId: sales.id });

    expect(summary.quarters[1]!.revenue).toEqual({ target: 1000, won: 600, forecast: 200 });
    expect(summary.quarters[1]!.grossProfit).toEqual({ target: 100, won: 120, forecast: 20 });
    expect(summary.total.revenue).toEqual({ target: 1000, won: 600, forecast: 200 });
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
    expect(log.map((row) => row.field).sort()).toEqual(["probability", "progress", "wonDate"]);

    const kept = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "own date" });
    if (!kept.ok) throw new Error(kept.message);
    await updateCommercialDetails(db, sales, { projectId: kept.value.id, values: { progress: "CLOSED_WON", wonDate: "2026-01-15", finalValue: "250" } });
    await expect(db.project.findUniqueOrThrow({ where: { id: kept.value.id } })).resolves.toMatchObject({ finalValue: expect.anything() });
    expect((await db.project.findUniqueOrThrow({ where: { id: kept.value.id } })).wonDate?.toISOString().slice(0, 10)).toBe("2026-01-15");
  });
});
