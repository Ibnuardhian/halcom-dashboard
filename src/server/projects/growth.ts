import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { buildPeriods, categoryOf, percentsOf, totalOf, type Granularity, type GrowthCounts, type GrowthPoint } from "@/domain/projects/growth";
import { summariseGrowth, type PipelineGrowth } from "@/domain/projects/growth-cards";

type Viewer = { id: string; role: Role };


const emptyCounts = (): GrowthCounts => ({ OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 });

/**
 * How many projects stand in each group (Opportunity, Quoted, Closed Won) at the end of each period.
 *
 * A project counts from its creation date (`created_at`, which Sales may correct) until it is deleted. Its group at a moment is:
 *  - the latest stage history row at or before it (the row id breaking a tie of equal timestamps);
 *  - before its first history row (the stage history only started with migration 20261028100000), what its own dates say: Closed Won
 *    from the won date (100%) and Quoted from the quote released date (Propose, 30%), each only when the first recorded stage agrees;
 *    otherwise Opportunity. The fallback returns the stand-ins PROPOSE and QUALIFY, which map to their groups like any other stage.
 *
 * One query for all periods; each project is one row per moment, so nothing is counted twice. Counting happens in the database; only
 * (period, stage, count) comes back. `salesOwnerId` narrows it to one salesperson's projects (their owner today).
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

  const moments = JSON.stringify(periods.map((period, index) => ({ idx: index, at: period.asOf.toISOString() })));
  const owner = options.salesOwnerId ?? null;
  const rows = await db.$queryRaw<{ idx: number; progress: string; n: number }[]>(Prisma.sql`
    SELECT p.idx::int AS idx, s.progress, count(*)::int AS n
    FROM jsonb_to_recordset(${moments}::jsonb) AS p(idx int, at timestamptz)
    JOIN projects pr
      ON pr.created_at <= p.at
     AND (pr.deleted_at IS NULL OR pr.deleted_at > p.at)
     AND (${owner}::uuid IS NULL OR pr.sales_owner_id = ${owner}::uuid)
    LEFT JOIN LATERAL (
      SELECT ph.to_progress FROM project_progress_history ph
      WHERE ph.project_id = pr.id AND ph.changed_at <= p.at
      ORDER BY ph.changed_at DESC, ph.id DESC LIMIT 1
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT ph.to_progress FROM project_progress_history ph
      WHERE ph.project_id = pr.id
      ORDER BY ph.changed_at, ph.id LIMIT 1
    ) f ON true
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN h.to_progress IS NOT NULL THEN h.to_progress::text
        WHEN COALESCE(f.to_progress, pr.progress) = 'CLOSED_WON' AND pr.won_date IS NOT NULL
          AND (pr.won_date::timestamp AT TIME ZONE 'Asia/Jakarta') <= p.at THEN 'CLOSED_WON'
        WHEN COALESCE(f.to_progress, pr.progress) NOT IN ('QUALIFY', 'UNDERSTAND') AND pr.quote_released_at IS NOT NULL
          AND (pr.quote_released_at::timestamp AT TIME ZONE 'Asia/Jakarta') <= p.at THEN 'PROPOSE'
        ELSE 'QUALIFY'
      END AS progress
    ) s
    GROUP BY p.idx, s.progress`);
  const byPeriod = new Map<number, GrowthCounts>(periods.map((_, index) => [index, emptyCounts()]));
  for (const row of rows) {
    // Closed Lost has left the pipeline, and a stage this code does not know is not guessed into a group: both stay out.
    const category = categoryOf(row.progress);
    if (category) byPeriod.get(row.idx)![category] += row.n;
  }

  const points: GrowthPoint[] = periods.map((period, index) => {
    const counts = byPeriod.get(index)!;
    const base = { key: period.key, label: period.label, start: period.start.toISOString(), asOf: period.asOf.toISOString(), running: period.running };
    return { ...base, reliable: true, counts, total: totalOf(counts), percents: percentsOf(counts) };
  });

  return { granularity: options.granularity, timeZone: "Asia/Jakarta", points, cards: summariseGrowth(points), historyStartsAt: starts?.toISOString() ?? null };
}
