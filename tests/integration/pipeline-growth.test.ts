import { randomInt } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { GRANULARITY_PERIODS, totalOf, type Granularity } from "@/domain/projects/growth";
import type { ProjectProgress } from "@/domain/projects/progress";
import { getDb } from "@/lib/db";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { getPipelineGrowth } from "@/server/projects/growth";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
const DAY = 86_400_000;

afterAll(async () => {
  await db.$disconnect();
});

async function salesPerson() {
  const user = await makeUser("SALES");
  return { id: user.id, role: "SALES" as Role };
}

/** A project made through the application: the trigger writes its first history row, naming the creator. */
async function newProject(owner: { id: string; role: Role }, name = "Growth test") {
  const result = await createProject(db, owner, { endUserCompany: "PT Growth", name });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

/** A project row written with triggers off, so it has no history at all (what the history would look like if it were incomplete). */
async function projectWithoutHistory(ownerId: string) {
  const code = `HIT-PROJ-${900_000 + randomInt(90_000)}`;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    return tx.project.create({ data: { code, endUserCompany: "PT Silent", name: "No history", salesOwnerId: ownerId } });
  });
}

type Row = { from: ProjectProgress | null; to: ProjectProgress; at: Date };
async function addHistory(projectId: string, rows: Row[]) {
  for (const row of rows) {
    await db.$executeRaw`INSERT INTO project_progress_history (project_id, from_progress, to_progress, source, changed_at)
      VALUES (${projectId}::uuid, ${row.from}::"ProjectProgress", ${row.to}::"ProjectProgress", 'update', ${row.at})`;
  }
}

const growth = (owner: { id: string; role: Role }, granularity: Granularity, now: Date) => getPipelineGrowth(db, owner, { granularity, salesOwnerId: owner.id, now });

describe("the stage history trigger", () => {
  it("writes the first stage when a project is created, with the person who created it, and every later change", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);

    const first = await db.projectProgressHistory.findMany({ where: { projectId: project.id } });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ fromProgress: null, toProgress: "QUALIFY", source: "insert", changedById: owner.id });

    await db.project.update({ where: { id: project.id }, data: { progress: "PROPOSE" } });
    await db.project.update({ where: { id: project.id }, data: { progress: "PROPOSE", description: "same stage, other field" } });
    await db.project.update({ where: { id: project.id }, data: { currentAction: "something else" } });
    await db.project.update({ where: { id: project.id }, data: { progress: "CLOSED_LOST" } });

    const rows = await db.projectProgressHistory.findMany({ where: { projectId: project.id }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });
    expect(rows.map((r) => [r.fromProgress, r.toProgress, r.source])).toEqual([[null, "QUALIFY", "insert"], ["QUALIFY", "PROPOSE", "update"], ["PROPOSE", "CLOSED_LOST", "update"]]);
  });

  it("is append-only", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    await expect(db.projectProgressHistory.updateMany({ where: { projectId: project.id }, data: { source: "update" } })).rejects.toThrow(/append-only/);
    await expect(db.projectProgressHistory.deleteMany({ where: { projectId: project.id } })).rejects.toThrow(/append-only/);
  });

  it("keeps a baseline row for every project that existed when the table was made, and rejects a row that changes nothing", async () => {
    expect(await db.projectProgressHistory.count({ where: { source: { notIn: ["baseline", "insert", "update"] } } })).toBe(0);
    const owner = await salesPerson();
    const project = await newProject(owner);
    await expect(addHistory(project.id, [{ from: "QUALIFY", to: "QUALIFY", at: new Date() }])).rejects.toThrow();
  });
});

describe("Pipeline Growth from the stage history", () => {
  it("rebuilds the group of a project at the end of each week, counting it once, through Opportunity, Quoted and Closed Won", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    const t0 = new Date();
    await addHistory(project.id, [
      { from: "QUALIFY", to: "PROPOSE", at: new Date(t0.getTime() + 9 * DAY) },
      { from: "PROPOSE", to: "CLOSED_WON", at: new Date(t0.getTime() + 30 * DAY) },
    ]);
    const now = new Date(t0.getTime() + 35 * DAY);

    const { points, cards } = await growth(owner, "weekly", now);

    expect(points).toHaveLength(GRANULARITY_PERIODS.weekly);
    const measured = points.filter((p) => p.counts);
    expect(measured.every((p) => totalOf(p.counts!) <= 1)).toBe(true); // one project, never counted twice
    const at = (from: number, to: number) => measured.filter((p) => new Date(p.asOf).getTime() > t0.getTime() + from * DAY && new Date(p.asOf).getTime() < t0.getTime() + to * DAY);
    expect(at(0, 9).length).toBeGreaterThan(0);
    expect(at(0, 9).every((p) => p.counts!.OPPORTUNITY === 1 && totalOf(p.counts!) === 1)).toBe(true);
    expect(at(9, 30).length).toBeGreaterThan(1);
    expect(at(9, 30).every((p) => p.counts!.QUOTED === 1 && totalOf(p.counts!) === 1)).toBe(true);
    // The week the project did not exist yet has nothing in it.
    expect(measured.filter((p) => new Date(p.asOf).getTime() < t0.getTime()).every((p) => totalOf(p.counts!) === 0)).toBe(true);
    // The running week is taken now, and the cards say the same as the last point.
    const last = points.at(-1)!;
    expect(last).toMatchObject({ running: true, reliable: true, counts: { OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 1 }, total: 1, percents: { CLOSED_WON: 100 } });
    expect(cards.map((c) => c.count)).toEqual([0, 0, 1]);
    // The cards are made from the same points as the chart, whichever week today happens to fall in.
    expect(cards.map((c) => c.count)).toEqual([last.counts!.OPPORTUNITY, last.counts!.QUOTED, last.counts!.CLOSED_WON]);
  });

  it("gives the same answer for months and quarters, from the same history", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    const t0 = new Date();
    await addHistory(project.id, [{ from: "QUALIFY", to: "AGREE", at: new Date(t0.getTime() + 3 * DAY) }]);
    const now = new Date(t0.getTime() + 5 * DAY);

    for (const granularity of ["monthly", "quarterly"] as const) {
      const result = await growth(owner, granularity, now);
      expect(result.points).toHaveLength(GRANULARITY_PERIODS[granularity]);
      expect(result.points.at(-1)).toMatchObject({ running: true, counts: { OPPORTUNITY: 0, QUOTED: 1, CLOSED_WON: 0 }, percents: { QUOTED: 100 } });
      expect(result.cards[1]!.percent).toBe(100);
    }
  });

  it("leaves Closed Lost out, and a project that is lost stops being counted from that moment", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    const t0 = new Date();
    await addHistory(project.id, [{ from: "QUALIFY", to: "CLOSED_LOST", at: new Date(t0.getTime() + 8 * DAY) }]);

    const { points } = await growth(owner, "weekly", new Date(t0.getTime() + 20 * DAY));

    const after = points.filter((p) => new Date(p.asOf).getTime() > t0.getTime() + 8 * DAY);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((p) => p.total === 0)).toBe(true);
    expect(points.some((p) => p.total === 1 && p.counts!.OPPORTUNITY === 1)).toBe(true); // before it, it was an opportunity
  });

  it("uses the last change of a period when a project moved several times in it, and breaks a tie of equal times by the order they were written", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    const t0 = new Date();
    const same = new Date(t0.getTime() + 2 * DAY);
    await addHistory(project.id, [
      { from: "QUALIFY", to: "UNDERSTAND", at: same },
      { from: "UNDERSTAND", to: "PROPOSE", at: same }, // written second, same instant: this is where it ended
      { from: "PROPOSE", to: "NEGOTIATE", at: new Date(t0.getTime() + 2 * DAY + 1000) },
    ]);

    const { points } = await growth(owner, "weekly", new Date(t0.getTime() + 10 * DAY));

    const after = points.filter((p) => new Date(p.asOf).getTime() > same.getTime() + 1000);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((p) => p.counts!.QUOTED === 1 && p.total === 1)).toBe(true);

    const tie = await growth(owner, "weekly", new Date(same.getTime() + 500));
    expect(tie.points.at(-1)!.counts).toMatchObject({ QUOTED: 1, OPPORTUNITY: 0 });
  });

  it("stops counting a project that was deleted, from the moment it was deleted", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    const t0 = new Date();
    const deletedAt = new Date(t0.getTime() + 10 * DAY);
    await db.$executeRaw`UPDATE projects SET deleted_at = ${deletedAt} WHERE id = ${project.id}::uuid`;

    const { points } = await growth(owner, "weekly", new Date(t0.getTime() + 30 * DAY));

    expect(points.filter((p) => new Date(p.asOf).getTime() >= deletedAt.getTime()).every((p) => p.total === 0)).toBe(true);
    expect(points.some((p) => p.total === 1)).toBe(true);
  });

  it("counts a project without history as an Opportunity from its creation, and an incomplete one by its first row once it is reached", async () => {
    const owner = await salesPerson();
    await projectWithoutHistory(owner.id);
    const partial = await projectWithoutHistory(owner.id);
    const t0 = new Date();
    await addHistory(partial.id, [{ from: null, to: "NEGOTIATE_FU", at: new Date(t0.getTime() + 3 * DAY) }]);

    const { points } = await growth(owner, "weekly", new Date(t0.getTime() + 14 * DAY));

    expect(points.at(-1)).toMatchObject({ total: 2, counts: { OPPORTUNITY: 1, QUOTED: 1 } });
    // Before the first row, with no quote released date, the partial one was an Opportunity too.
    const early = points.filter((p) => new Date(p.asOf).getTime() >= t0.getTime() && new Date(p.asOf).getTime() < t0.getTime() + 3 * DAY);
    expect(early.every((p) => p.counts!.OPPORTUNITY === 2 && p.total === 2)).toBe(true);
  });

  it("counts a project from the creation date Sales set, and nothing before it", async () => {
    const owner = await salesPerson();
    const project = await newProject(owner);
    const now = new Date();
    const created = new Date(now.getTime() - 40 * DAY);
    await db.$executeRaw`UPDATE projects SET created_at = ${created} WHERE id = ${project.id}::uuid`;

    const { points } = await growth(owner, "weekly", now);

    expect(points.filter((p) => new Date(p.asOf).getTime() < created.getTime()).every((p) => p.total === 0)).toBe(true);
    const since = points.filter((p) => new Date(p.asOf).getTime() >= created.getTime());
    expect(since.length).toBeGreaterThan(4);
    expect(since.every((p) => p.counts!.OPPORTUNITY === 1 && p.total === 1)).toBe(true);
  });

  it("before the stage history, takes Quoted from the quote released date and Closed Won from the won date", async () => {
    const owner = await salesPerson();
    const project = await projectWithoutHistory(owner.id);
    const t0 = new Date("2026-01-05T00:00:00Z");
    await db.project.update({
      where: { id: project.id },
      data: { createdAt: t0, quoteReleasedAt: new Date("2026-02-10T00:00:00Z"), wonDate: new Date("2026-04-20T00:00:00Z") },
    });
    await addHistory(project.id, [{ from: null, to: "CLOSED_WON", at: new Date("2026-06-15T00:00:00Z") }]);

    const { points } = await growth(owner, "monthly", new Date("2026-07-15T00:00:00Z"));
    const month = (key: string) => points.find((p) => p.key === key)!.counts;

    expect(month("2025-12")).toMatchObject({ OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 });
    expect(month("2026-01")).toMatchObject({ OPPORTUNITY: 1, QUOTED: 0, CLOSED_WON: 0 });
    expect(month("2026-02")).toMatchObject({ OPPORTUNITY: 0, QUOTED: 1, CLOSED_WON: 0 });
    expect(month("2026-03")).toMatchObject({ QUOTED: 1 });
    expect(month("2026-04")).toMatchObject({ OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 1 });
    expect(month("2026-07")).toMatchObject({ CLOSED_WON: 1 });
  });

  it("does not take a quote or won date as a stage the first recorded stage contradicts", async () => {
    const owner = await salesPerson();
    const project = await projectWithoutHistory(owner.id);
    await db.project.update({
      where: { id: project.id },
      data: { createdAt: new Date("2026-01-05T00:00:00Z"), quoteReleasedAt: new Date("2026-02-10T00:00:00Z"), wonDate: new Date("2026-02-20T00:00:00Z") },
    });
    await addHistory(project.id, [{ from: null, to: "UNDERSTAND", at: new Date("2026-06-15T00:00:00Z") }]);

    const { points } = await growth(owner, "monthly", new Date("2026-07-15T00:00:00Z"));

    expect(points.find((p) => p.key === "2026-03")!.counts).toMatchObject({ OPPORTUNITY: 1, QUOTED: 0, CLOSED_WON: 0 });
  });

  it("gives zeros, not gaps, for periods before any project existed", async () => {
    const owner = await salesPerson();
    await newProject(owner);

    const result = await growth(owner, "monthly", new Date("2020-06-15T00:00:00Z"));

    expect(result.points).toHaveLength(12);
    expect(result.points.every((p) => p.reliable && p.total === 0)).toBe(true);
  });

  it("returns zeros and zero percentages, never NaN, when the person has no project", async () => {
    const owner = await salesPerson();

    const { points, cards } = await growth(owner, "weekly", new Date());

    const last = points.at(-1)!;
    expect(last).toMatchObject({ reliable: true, counts: { OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 }, total: 0, percents: { OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 } });
    expect(JSON.stringify({ points, cards })).not.toMatch(/NaN|Infinity/);
    expect(cards.every((c) => c.count === 0 && c.percent === 0)).toBe(true);
  });

  it("keeps to one salesperson's projects when asked, and sees everyone's otherwise", async () => {
    const [a, b] = [await salesPerson(), await salesPerson()];
    await newProject(a);
    await newProject(b);
    await newProject(b);
    const now = new Date(Date.now() + DAY);

    expect((await growth(a, "monthly", now)).points.at(-1)!.total).toBe(1);
    expect((await growth(b, "monthly", now)).points.at(-1)!.total).toBe(2);
    const everyone = await getPipelineGrowth(db, a, { granularity: "monthly", now });
    expect(everyone.points.at(-1)!.total).toBeGreaterThanOrEqual(3);
  });

  it("bounds the periods it looks at to the granularity, and never reads a moment after now", async () => {
    const owner = await salesPerson();
    const now = new Date();
    for (const granularity of ["weekly", "monthly", "quarterly"] as const) {
      const { points } = await growth(owner, granularity, now);
      expect(points).toHaveLength(GRANULARITY_PERIODS[granularity]);
      expect(points.every((p) => new Date(p.asOf).getTime() <= now.getTime())).toBe(true);
      expect(new Date(points[0]!.start).getTime()).toBeGreaterThan(now.getTime() - 800 * DAY);
    }
  });
});

describe("Pipeline Conversion numbers", () => {
  it("counts the open projects at Propose or beyond against the open ones, leaving Closed Won, Closed Lost and Done out", async () => {
    const owner = await salesPerson();
    const make = (progress: ProjectProgress, trackStatus: "ON_TRACK" | "DONE" = "ON_TRACK") =>
      db.project.create({ data: { code: `HIT-PROJ-${900_000 + randomInt(90_000)}`, endUserCompany: "PT Conv", name: progress, salesOwnerId: owner.id, progress, trackStatus } });
    await Promise.all([
      make("QUALIFY"), make("UNDERSTAND"), make("PROPOSE"), make("NEGOTIATE"), make("NEGOTIATE_FU"), make("AGREE"),
      make("CLOSED_WON"), make("CLOSED_LOST"), make("PROPOSE", "DONE"),
    ]);

    const { totals } = await getPipelineAnalytics(db, owner, { salesOwnerId: owner.id });

    expect(totals).toMatchObject({ projects: 9, open: 6, openQuoted: 4, wonCount: 1 });
  });
});
