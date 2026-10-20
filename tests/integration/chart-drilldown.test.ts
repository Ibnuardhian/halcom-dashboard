import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { projectsHref, readDrillFilters, type DrillFilters } from "@/domain/projects/drilldown";
import { buildFunnel } from "@/domain/projects/funnel";
import type { ProjectProgress } from "@/domain/projects/progress";
import { getPipelineAnalytics, type PipelineAnalytics, type Slice } from "@/server/projects/analytics";
import { setProjectMasterData } from "@/server/masterdata/service";
import { searchProjects, type ProjectFilter } from "@/server/requests/queries";
import { createProject } from "@/server/requests/service";
import { updateCommercialDetails } from "@/server/projects/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const asActor = (user: { id: string; role: Parameters<typeof createProject>[1]["role"] }) => ({ id: user.id, role: user.role });

/** The Projects list the way the page builds it from the address a chart links to. */
function listFor(href: string): ProjectFilter {
  const query = Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? "").entries()) as Record<string, string | string[]>;
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  for (const name of ["principal", "solution", "industry", "owner"]) if (params.getAll(name).length > 1) query[name] = params.getAll(name);
  const drill = readDrillFilters(query);
  return {
    progress: drill.progress,
    trackStatus: drill.status,
    reached: drill.reached,
    principalKeys: drill.principal,
    solutionKeys: drill.solution,
    ownerKeys: drill.owner,
    industryKeys: drill.industry,
    ...(params.get("mine") === "1" ? { salesOwnerId: params.get("owner-id") ?? undefined } : {}),
  };
}

const total = async (viewer: Parameters<typeof searchProjects>[1], filter: ProjectFilter) => (await searchProjects(db, viewer, filter, { pageSize: "all" })).total;

describe("clicking a chart opens exactly the projects it counted", () => {
  it("every slice of every Overview chart leads to a list with the same count (everything, folded slices and Not set included)", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const tag = randomBytes(3).toString("hex");
    // Nine principals so that the chart folds the smallest into "Other (n)", plus projects with no principal, solution or industry.
    const principals = await Promise.all(Array.from({ length: 9 }, (_, i) => db.principal.create({ data: { name: `Brand ${i} ${tag}`, nameKey: `brand ${i} ${tag}` } })));
    const solution = await db.solutionCategory.create({ data: { name: `Sol ${tag}`, nameKey: `sol ${tag}` } });
    const progresses: ProjectProgress[] = ["QUALIFY", "PROPOSE", "NEGOTIATE", "NEGOTIATE_FU", "AGREE", "CLOSED_WON", "CLOSED_LOST"];
    for (let i = 0; i < 12; i += 1) {
      const created = await createProject(db, asActor(sales), { endUserCompany: `Chart ${tag}`, name: `p${i}`, estimatedValue: String(1000 * (i + 1)), progress: progresses[i % progresses.length] });
      if (!created.ok) throw new Error(created.message);
      if (i < 9) await setProjectMasterData(db, asActor(soa), { projectId: created.value.id, principalIds: i === 0 ? [principals[0]!.id, principals[1]!.id] : [principals[i]!.id], ...(i % 2 === 0 ? { solutionId: solution.id } : {}) });
      await db.project.update({ where: { id: created.value.id }, data: { industry: i % 3 === 0 ? `  Bank ${tag} ` : i % 3 === 1 ? `bank ${tag}` : null } });
    }

    const analytics = await getPipelineAnalytics(db, asActor(sales));
    const dimensions: [keyof PipelineAnalytics & ("byPrincipal" | "bySolution" | "byIndustry" | "bySalesPerson"), "principal" | "solution" | "industry" | "owner"][] = [
      ["byPrincipal", "principal"],
      ["bySolution", "solution"],
      ["byIndustry", "industry"],
      ["bySalesPerson", "owner"],
    ];
    let checked = 0;
    for (const [list, name] of dimensions) {
      for (const slice of analytics[list] as Slice[]) {
        expect(slice.drill?.length, `${list} ${slice.label} has a filter`).toBeGreaterThan(0);
        const href = projectsHref("/projects", { [name]: slice.drill } as DrillFilters);
        expect(await total(asActor(sales), listFor(href)), `${list}: ${slice.label}`).toBe(slice.count);
        checked += 1;
      }
    }
    for (const slice of analytics.byProgress) {
      expect(await total(asActor(sales), listFor(projectsHref("/projects", { progress: slice.key as ProjectProgress }))), `progress ${slice.label}`).toBe(slice.count);
    }
    for (const slice of analytics.byStatus) {
      expect(await total(asActor(sales), listFor(projectsHref("/projects", { status: slice.key as "ON_TRACK" }))), `status ${slice.label}`).toBe(slice.count);
    }
    for (const step of buildFunnel(analytics.byProgress)) {
      expect(await total(asActor(sales), listFor(projectsHref("/projects", { reached: step.key }))), `funnel ${step.label}`).toBe(step.count);
    }
    expect(checked).toBeGreaterThan(8);
    // The folded slice really was exercised.
    expect(analytics.byPrincipal.some((slice) => slice.key === "other" && (slice.drill?.length ?? 0) > 1)).toBe(true);
  });

  it("a salesperson's own charts count and open only that salesperson's projects", async () => {
    const [mine, theirs, soa] = await Promise.all([makeUser("SALES"), makeUser("SALES"), makeUser("SOA")]);
    const tag = randomBytes(3).toString("hex");
    const brand = await db.principal.create({ data: { name: `Own ${tag}`, nameKey: `own ${tag}` } });
    for (const [owner, n] of [[mine, 2], [theirs, 3]] as const) {
      for (let i = 0; i < n; i += 1) {
        const created = await createProject(db, asActor(owner), { endUserCompany: `Own ${tag}`, name: `o${i}`, estimatedValue: "500" });
        if (!created.ok) throw new Error(created.message);
        await setProjectMasterData(db, asActor(soa), { projectId: created.value.id, principalIds: [brand.id] });
        await updateCommercialDetails(db, asActor(owner), { projectId: created.value.id, values: { progress: "PROPOSE" } });
      }
    }

    const analytics = await getPipelineAnalytics(db, asActor(mine), { salesOwnerId: mine.id });
    const slice = analytics.byPrincipal.find((entry) => entry.key === brand.id)!;
    expect(slice.count).toBe(2);
    const filter = { ...listFor(projectsHref("/projects", { principal: slice.drill }, { mine: true })), salesOwnerId: mine.id };
    expect(await total(asActor(mine), filter)).toBe(2);
    const reached = buildFunnel(analytics.byProgress).find((step) => step.key === "PROPOSE")!;
    expect(await total(asActor(mine), { ...listFor(projectsHref("/projects", { reached: "PROPOSE" }, { mine: true })), salesOwnerId: mine.id })).toBe(reached.count);
    // Without the owner scope the same address would list the other salesperson's projects too: the scope is the server's, from the session.
    expect(await total(asActor(mine), listFor(projectsHref("/projects", { principal: slice.drill })))).toBe(5);
  });
});

describe("the chart address", () => {
  it("round-trips, drops values that are not valid, and leaves the others alone", () => {
    const id = "0190a5f0-0000-7000-8000-000000000001";
    const href = projectsHref("/projects", { progress: "PROPOSE", reached: "NEGOTIATE", principal: [id, "none"], industry: ["bank", "oil, gas"], owner: ["external"] });
    const query = new URLSearchParams(href.split("?")[1]);

    expect(readDrillFilters({ progress: "PROPOSE", reached: "NEGOTIATE", principal: [id, "none"], industry: query.getAll("industry"), owner: "external" })).toEqual({
      progress: "PROPOSE",
      reached: "NEGOTIATE",
      principal: [id, "none"],
      solution: [],
      industry: ["bank", "oil, gas"],
      owner: ["external"],
    });
    expect(readDrillFilters({ progress: "BOGUS", status: "ON_TRACK", reached: "NOPE", principal: ["x'; drop", id], solution: "none", owner: ["nobody"] })).toEqual({
      status: "ON_TRACK",
      principal: [id],
      solution: ["none"],
      industry: [],
      owner: [],
    });
    expect(projectsHref("/projects", {})).toBe("/projects");
    expect(projectsHref("/projects", { status: "ON_HOLD" }, { mine: true })).toBe("/projects?status=ON_HOLD&mine=1");
  });
});
