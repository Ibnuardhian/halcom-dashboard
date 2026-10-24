import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { buildPeriods, categoryOf, percentsOf, totalOf, type Granularity, type GrowthCounts, type GrowthPoint, type Period } from "@/domain/projects/growth";
import { summariseGrowth, type PipelineGrowth } from "@/domain/projects/growth-cards";

type Viewer = { id: string; role: Role };


const emptyCounts = (): GrowthCounts => ({ OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 });

/**
 * How many projects stand in each group (Opportunity, Quoted, Closed Won) at the end of each period, rebuilt from the stage history.
 *
 * One query for all periods: for each period's moment, the latest history row of every project at or before it (DISTINCT ON the project,
 * newest first, the row id breaking a tie of equal timestamps), keeping projects that existed (not deleted) at that moment. Each project is
 * one row per moment, so nothing is counted twice; there is no join to anything that has several rows per project. Counting happens in the
 * database; only (period, stage, count) comes back. `salesOwnerId` narrows it to one salesperson's projects (their owner today).
 */
export async function getPipelineGrowth(
  db: PrismaClient,
  viewer: Viewer,
  options: { granularity: Granularity; salesOwnerId?: string; now?: Date },
): Promise<PipelineGrowth> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const now = options.now ?? new Date();
  const periods = buildPeriods(options.granularity, now);

  const [{ starts }] = await db.$queryRaw<{ starts: Date | null }[]>`SELECT min("changed_at") AS starts FROM "project_progress_history"`;
  const reliable = (period: Period) => starts !== null && period.asOf.getTime() >= starts.getTime();
  const measured = periods.map((period, index) => ({ period, index })).filter(({ period }) => reliable(period));

  const byPeriod = new Map<number, GrowthCounts>();
  if (measured.length > 0) {
    const moments = JSON.stringify(measured.map(({ period, index }) => ({ idx: index, at: period.asOf.toISOString() })));
    const owner = options.salesOwnerId ?? null;
    const rows = await db.$queryRaw<{ idx: number; progress: string; n: number }[]>(Prisma.sql`
      SELECT p.idx::int AS idx, h.to_progress::text AS progress, count(*)::int AS n
      FROM jsonb_to_recordset(${moments}::jsonb) AS p(idx int, at timestamptz)
      CROSS JOIN LATERAL (
        SELECT DISTINCT ON (ph.project_id) ph.to_progress
        FROM project_progress_history ph
        JOIN projects pr ON pr.id = ph.project_id
        WHERE ph.changed_at <= p.at
          AND (pr.deleted_at IS NULL OR pr.deleted_at > p.at)
          AND (${owner}::uuid IS NULL OR pr.sales_owner_id = ${owner}::uuid)
        ORDER BY ph.project_id, ph.changed_at DESC, ph.id DESC
      ) h
      GROUP BY p.idx, h.to_progress`);
    for (const { index } of measured) byPeriod.set(index, emptyCounts());
    for (const row of rows) {
      // Closed Lost has left the pipeline, and a stage this code does not know is not guessed into a group: both stay out.
      const category = categoryOf(row.progress);
      if (category) byPeriod.get(row.idx)![category] += row.n;
    }
  }

  const points: GrowthPoint[] = periods.map((period, index) => {
    const counts = byPeriod.get(index) ?? null;
    const base = { key: period.key, label: period.label, start: period.start.toISOString(), asOf: period.asOf.toISOString(), running: period.running };
    if (!counts) return { ...base, reliable: false, counts: null, total: null, percents: null };
    return { ...base, reliable: true, counts, total: totalOf(counts), percents: percentsOf(counts) };
  });

  return { granularity: options.granularity, timeZone: "Asia/Jakarta", points, cards: summariseGrowth(points), historyStartsAt: starts?.toISOString() ?? null };
}
