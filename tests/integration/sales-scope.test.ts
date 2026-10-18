import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getRequesterSummary } from "@/server/dashboards/metrics";
import { getPipelineAnalytics, listPipelineProjects } from "@/server/projects/analytics";
import { getWorkStats, listPendingDecisions } from "@/server/requests/queries";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("a salesperson's dashboard numbers belong to that salesperson", () => {
  it("counts only the projects and the requests on the projects of the account it is asked for", async () => {
    const [mine, theirs] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);
    const tag = randomBytes(3).toString("hex");
    const own = { id: mine.id, role: mine.role };
    const other = { id: theirs.id, role: theirs.role };
    const a = await createProject(db, own, { endUserCompany: `Mine ${tag}`, name: "mine", estimatedValue: "1000" });
    const b = await createProject(db, other, { endUserCompany: `Theirs ${tag}`, name: "theirs", estimatedValue: "9000" });
    if (!a.ok || !b.ok) throw new Error("fixture");
    for (const [actor, project, type] of [
      [own, a.value, "BOQ"],
      [other, b.value, "BOQ"],
      [other, b.value, "RFQ"],
    ] as const) {
      const made = await createRequest(db, actor, { projectId: project.id, type, title: `${type} ${tag}` });
      if (!made.ok) throw new Error(made.message);
    }

    const stats = await getWorkStats(db, own, mine.id);
    expect(stats.openByType).toEqual({ BOQ: 1, RFQ: 0, PO: 0 }); // not the other salesperson's BOQ and RFQ
    const everyone = await getWorkStats(db, own);
    expect(everyone.openByType.BOQ).toBeGreaterThanOrEqual(2);

    const analytics = await getPipelineAnalytics(db, own, { salesOwnerId: mine.id });
    expect(analytics.totals).toMatchObject({ projects: 1, open: 1, openValue: 1000 });
    expect((await listPipelineProjects(db, own, mine.id)).map((row) => row.code)).toEqual([a.value.code]);
    const summary = await getRequesterSummary(db, own, mine.id);
    expect(Object.values(summary.byStatus).reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(await listPendingDecisions(db, own, mine.id)).toEqual([]);
  });
});
