import type { PrismaClient } from "@/generated/prisma/client";
import { canHold } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { computeConcerns, PROJECT_STALE_DAYS, type Concern } from "@/domain/management/concerns";
import type { MonthlyRow } from "@/domain/requests/metrics";
import { CROSSCHECK_PATH, HANDOFFS_PATH, PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { listCrosscheck } from "@/server/finance/crosscheck";
import { searchProjects, type ProjectRow } from "@/server/requests/queries";
import { getTeamDashboard, getTeamMonthly, listOverdueRequests, oldestAwaitingHandoffAt, type OverdueRow, type TeamDashboard } from "./metrics";

type Viewer = { id: string; role: Role; alsoManagement?: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of the stalest projects and of the late-completion notes the page lists. */
export const STALE_PROJECTS_SHOWN = 5;
export const LATE_NOTES_SHOWN = 5;

export type ManagementDashboard = {
  concerns: Concern[];
  teams: { SOA: TeamDashboard; PURCHASING: TeamDashboard };
  monthly: { SOA: MonthlyRow[]; PURCHASING: MonthlyRow[] };
  /** Requests that ran late (open now, or completed late in the last 90 days) with the reason the team wrote, longest first. */
  late: { SOA: OverdueRow[]; PURCHASING: OverdueRow[] };
  stale: { count: number; top: ProjectRow[] };
  awaitingHandoff: { count: number; oldestDays: number | null };
  /** Projects Finance flags; null when the viewer may not read the crosscheck. */
  financeFlagged: number | null;
};

/**
 * Everything the Management dashboard shows, read only: the two teams' own numbers (the same as their dashboards), the months behind
 * them, what is stuck between teams, and the ranked concerns computed from those numbers (src/domain/management/concerns.ts).
 */
export async function getManagementDashboard(db: PrismaClient, viewer: Viewer, now: Date = new Date()): Promise<ManagementDashboard> {
  const [soa, purchasing, soaMonthly, purchasingMonthly, soaLate, purchasingLate, projects, oldestHandoff] = await Promise.all([
    getTeamDashboard(db, viewer, "SOA", now),
    getTeamDashboard(db, viewer, "PURCHASING", now),
    getTeamMonthly(db, viewer, "SOA", now),
    getTeamMonthly(db, viewer, "PURCHASING", now),
    listOverdueRequests(db, viewer, "SOA", now),
    listOverdueRequests(db, viewer, "PURCHASING", now),
    searchProjects(db, viewer, { show: "open" }, { pageSize: "all", sort: "lastUpdate", dir: "asc" }),
    oldestAwaitingHandoffAt(db),
  ]);
  const staleBefore = now.getTime() - PROJECT_STALE_DAYS * DAY_MS;
  const staleRows = projects.rows.filter((project) => project.lastUpdated.getTime() < staleBefore);
  const flagged = canHold(viewer, "finance.crosscheck.view") ? (await listCrosscheck(db, viewer)).rows.filter((row) => row.flags.length > 0).length : null;
  const awaitingHandoff = { count: soa.awaitingHandoff ?? 0, oldestDays: oldestHandoff ? Math.floor((now.getTime() - oldestHandoff.getTime()) / DAY_MS) : null };

  return {
    concerns: computeConcerns({
      teams: [
        { area: "SOA", metrics: soa.metrics, base: `${REQUESTS_PATH}/boq?` },
        { area: "Purchasing", metrics: purchasing.metrics, base: `${REQUESTS_PATH}?types=RFQ,PO&` },
      ],
      awaitingHandoff: { ...awaitingHandoff, href: HANDOFFS_PATH },
      staleProjects: { count: staleRows.length, href: `${PROJECTS_PATH}?show=open&sort=lastUpdate&dir=asc` },
      financeFlagged: flagged === null ? null : { count: flagged, href: CROSSCHECK_PATH },
    }),
    teams: { SOA: soa, PURCHASING: purchasing },
    monthly: { SOA: soaMonthly, PURCHASING: purchasingMonthly },
    late: { SOA: soaLate.slice(0, LATE_NOTES_SHOWN), PURCHASING: purchasingLate.slice(0, LATE_NOTES_SHOWN) },
    stale: { count: staleRows.length, top: staleRows.slice(0, STALE_PROJECTS_SHOWN) },
    awaitingHandoff,
    financeFlagged: flagged,
  };
}
