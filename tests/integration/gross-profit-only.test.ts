import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { summariseTargets } from "@/domain/targets/quarters";
import { getDb } from "@/lib/db";
import { getPipelineAnalytics, listPipelineProjects } from "@/server/projects/analytics";
import { searchProjects } from "@/server/requests/queries";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("a project with a Gross Profit and no Estimated PO value", () => {
  it("counts in the pipeline numbers, the Gross Profit list and the Sales reminder, without a value", async () => {
    const sales = await makeUser("SALES");
    const viewer = { id: sales.id, role: sales.role };
    const tag = randomBytes(3).toString("hex");
    const withProfit = await createProject(db, viewer, { endUserCompany: `GP ${tag} a`, name: "With profit", targetMarginValue: "250000000" });
    const without = await createProject(db, viewer, { endUserCompany: `GP ${tag} b`, name: "Without profit" });
    if (!withProfit.ok || !without.ok) throw new Error("setup failed");

    const analytics = await getPipelineAnalytics(db, viewer, { salesOwnerId: sales.id });
    expect(analytics.totals).toMatchObject({ open: 2, openValue: 250000000, openWeighted: 12500000, openTargetMargin: 250000000, openWithMargin: 1 });

    const list = await searchProjects(db, viewer, { show: "margin", search: `GP ${tag}` }, { pageSize: 25 });
    expect(list.rows.map((row) => row.code)).toEqual([withProfit.value.code]);

    // The reminder to set a Gross Profit is for the one that has none, whether or not it has a value.
    const rows = await listPipelineProjects(db, viewer, sales.id);
    expect(rows.find((row) => row.code === without.value.code)?.estimatedGrossProfit).toBeNull();
    expect(rows.find((row) => row.code === withProfit.value.code)).toMatchObject({ estimatedGrossProfit: 250000000, estimatedValue: null });
    expect(rows[0]!.code).toBe(without.value.code); // those that still need it come first
  });

  it("adds its Gross Profit to the quarter forecast by its target date, weighted by Progress", () => {
    const summary = summariseTargets(
      2027,
      [{ progress: "PROPOSE", trackStatus: "ON_TRACK", estimatedValue: null, finalValue: null, targetMargin: null, targetMarginValue: 1000, targetDate: new Date("2027-02-10"), wonDate: null }],
      [],
    );
    expect(summary.quarters[0]!.grossProfit.forecast).toBe(300); // 30% of 1,000
    expect(summary.quarters[0]!.revenue.forecast).toBe(0);
  });
});
