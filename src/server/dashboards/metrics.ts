import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can, canHold } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { METRICS_WINDOW_DAYS, computeTeamMetrics, monthlyReport, summariseRequests, summariseStatuses, type StatusSummary, type MonthlyRow, type MetricRequest, type RequesterSummary, type TeamMetrics } from "@/domain/requests/metrics";
import { OWNING_ROLE, type RequestType } from "@/domain/requests/types";
import { overdueWorkingDays, slaOf } from "@/domain/requests/sla";
import { getTeamSettings } from "@/server/settings/team-settings";

type Viewer = { id: string; role: Role; alsoManagement?: boolean };

function assertPermitted(viewer: Viewer): void {
  // Pages check permissions first; this guards against a missed check. Request data is readable by every signed-in role (A-9).
  if (!can(viewer.role, "requests.view")) throw new Error("Forbidden: missing permission for this query.");
}

const SELECT = {
  code: true,
  type: true,
  status: true,
  createdAt: true,
  completedAt: true,
  requiredBy: true,
  picId: true,
  pic: { select: { name: true, isActive: true } },
  statusHistory: { select: { toStatus: true, changedAt: true } },
} satisfies Prisma.RequestSelect;

async function load(db: PrismaClient, scope: { type?: RequestType; types?: readonly RequestType[]; ownerId?: string }): Promise<(MetricRequest & { type: RequestType })[]> {
  const rows = await db.request.findMany({
    where: { type: scope.type ?? (scope.types ? { in: [...scope.types] } : undefined), deletedAt: null, project: { deletedAt: null, salesOwnerId: scope.ownerId } },
    select: SELECT,
  });
  return rows.map((row) => ({
    code: row.code,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    requiredBy: row.requiredBy,
    // Work is counted per PIC (an operational assignee), not per login account: SOA and Purchasing each share one account.
    assigneeId: row.picId,
    assigneeName: row.pic ? (row.pic.isActive ? row.pic.name : `${row.pic.name} (inactive)`) : null,
    history: row.statusHistory,
  }));
}

/** What each team counts: SOA its BOQ requests, Purchasing its RFQ and PO requests (D-036). */
export const TEAM_TYPES: Record<"SOA" | "PURCHASING", readonly RequestType[]> = { SOA: ["BOQ"], PURCHASING: ["RFQ", "PO"] };

export type TeamDashboard = {
  team: "SOA" | "PURCHASING";
  metrics: TeamMetrics;
  /** Total, done, completion rate, on going, the split by status and the requests per PIC. */
  summary: StatusSummary;
  /** SOA: completed BOQs whose next step nobody decided yet. */
  awaitingHandoff: number | null;
};

/**
 * The dashboard numbers of SOA (its BOQ requests) or Purchasing (its RFQ and PO requests). Computed from every request of the team
 * and its status history, against the SLA the superadmin set for the team.
 */
export async function getTeamDashboard(db: PrismaClient, viewer: Viewer, team: "SOA" | "PURCHASING", now: Date = new Date()): Promise<TeamDashboard> {
  assertPermitted(viewer);
  const [requests, settings, pics] = await Promise.all([load(db, { types: TEAM_TYPES[team] }), getTeamSettings(db), db.pic.findMany({ where: { team }, select: { id: true, name: true, isActive: true } })]);
  const metrics = computeTeamMetrics(requests, settings[team].sla, now);
  return { team, metrics, summary: summariseStatuses(requests, pics), awaitingHandoff: team === "SOA" ? await countAwaitingHandoff(db) : null };
}

/** BOQ requests per month for the last six months: received, completed, SLA and turnaround. For SOA's Technical reports. */
export async function getTechnicalReport(db: PrismaClient, viewer: Viewer, now: Date = new Date()): Promise<MonthlyRow[]> {
  if (!canHold(viewer, "reports.technical.view")) throw new Error("Forbidden: missing permission for this query.");
  const [requests, settings] = await Promise.all([load(db, { type: "BOQ" }), getTeamSettings(db)]);
  return monthlyReport(requests, settings.SOA.sla, now);
}

const AWAITING_HANDOFF = { type: "BOQ", status: "COMPLETED", flowStoppedAt: null, deletedAt: null, handovers: { none: { deletedAt: null } }, project: { deletedAt: null } } satisfies Prisma.RequestWhereInput;

/** Completed BOQs that were neither continued as an RFQ nor marked "do not continue". */
export function countAwaitingHandoff(db: PrismaClient): Promise<number> {
  return db.request.count({ where: AWAITING_HANDOFF });
}

/** When the BOQ that has waited longest for the Sales decision was completed; null when none waits. */
export async function oldestAwaitingHandoffAt(db: PrismaClient): Promise<Date | null> {
  const oldest = await db.request.findFirst({ where: { ...AWAITING_HANDOFF, completedAt: { not: null } }, orderBy: { completedAt: "asc" }, select: { completedAt: true } });
  return oldest?.completedAt ?? null;
}

/** The last six months of one team: received, completed, SLA and turnaround (the table of Technical reports, for either team). */
export async function getTeamMonthly(db: PrismaClient, viewer: Viewer, team: "SOA" | "PURCHASING", now: Date = new Date()): Promise<MonthlyRow[]> {
  assertPermitted(viewer);
  const [requests, settings] = await Promise.all([load(db, { types: TEAM_TYPES[team] }), getTeamSettings(db)]);
  return monthlyReport(requests, settings[team].sla, now);
}

/** The request picture of the projects one salesperson owns, or of every project when `ownerId` is omitted. */
export async function getRequesterSummary(db: PrismaClient, viewer: Viewer, ownerId?: string, now: Date = new Date()): Promise<RequesterSummary> {
  assertPermitted(viewer);
  const [requests, settings] = await Promise.all([load(db, { ownerId }), getTeamSettings(db)]);
  return summariseRequests(requests, (type) => settings[OWNING_ROLE[type] as "SOA" | "PURCHASING"].sla, now);
}

export type OverdueRow = {
  code: string;
  customer: string;
  project: string;
  pic: string | null;
  requestIn: Date;
  /** Working days past the SLA deadline: until now while the request is open, until its completion once completed. */
  overdueDays: number;
  completed: boolean;
  /** Why it ran late, written when it was completed; empty while it is still open. */
  note: string | null;
};

/**
 * The late requests of a team: those open and past their deadline now, and those completed late in the last `METRICS_WINDOW_DAYS`
 * days (the same window as the dashboard's averages), the longest overdue first.
 */
export async function listOverdueRequests(db: PrismaClient, viewer: Viewer, team: "SOA" | "PURCHASING", now: Date = new Date()): Promise<OverdueRow[]> {
  assertPermitted(viewer);
  const since = new Date(now.getTime() - METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [rows, settings] = await Promise.all([
    db.request.findMany({
      where: {
        type: { in: [...TEAM_TYPES[team]] },
        deletedAt: null,
        project: { deletedAt: null },
        OR: [{ status: { in: ["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES", "REVISION"] } }, { status: "COMPLETED", completedAt: { gte: since } }],
      },
      select: {
        code: true,
        status: true,
        createdAt: true,
        completedAt: true,
        overdueNote: true,
        project: { select: { endUserCompany: true, name: true } },
        pic: { select: { name: true } },
        statusHistory: { select: { toStatus: true, changedAt: true } },
      },
    }),
    getTeamSettings(db),
  ]);
  const late: OverdueRow[] = [];
  for (const row of rows) {
    const sla = slaOf({ createdAt: row.createdAt, status: row.status, completedAt: row.completedAt, history: row.statusHistory, range: settings[team].sla, now });
    const completed = row.status === "COMPLETED";
    if (sla.state !== (completed ? "late" : "overdue")) continue;
    late.push({
      code: row.code,
      customer: row.project.endUserCompany,
      project: row.project.name,
      pic: row.pic?.name ?? null,
      requestIn: row.createdAt,
      overdueDays: overdueWorkingDays(sla.dueAt, completed ? row.completedAt! : now),
      completed,
      note: row.overdueNote,
    });
  }
  return late.sort((a, b) => b.overdueDays - a.overdueDays || a.requestIn.getTime() - b.requestIn.getTime());
}
