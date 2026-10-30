import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { computeTeamMetrics, monthlyReport, summariseRequests, summariseStatuses, type StatusSummary, type MonthlyRow, type MetricRequest, type RequesterSummary, type TeamMetrics } from "@/domain/requests/metrics";
import { OWNING_ROLE, type RequestType } from "@/domain/requests/types";
import { getTeamSettings } from "@/server/settings/team-settings";

type Viewer = { id: string; role: Role };

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
    where: { type: scope.type ?? (scope.types ? { in: [...scope.types] } : undefined), project: { deletedAt: null, salesOwnerId: scope.ownerId } },
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
  if (!can(viewer.role, "reports.technical.view")) throw new Error("Forbidden: missing permission for this query.");
  const [requests, settings] = await Promise.all([load(db, { type: "BOQ" }), getTeamSettings(db)]);
  return monthlyReport(requests, settings.SOA.sla, now);
}

/** Completed BOQs that were neither continued as an RFQ nor marked "do not continue". */
export function countAwaitingHandoff(db: PrismaClient): Promise<number> {
  return db.request.count({ where: { type: "BOQ", status: "COMPLETED", flowStoppedAt: null, handovers: { none: {} }, project: { deletedAt: null } } });
}

/** The request picture of the projects one salesperson owns, or of every project when `ownerId` is omitted. */
export async function getRequesterSummary(db: PrismaClient, viewer: Viewer, ownerId?: string, now: Date = new Date()): Promise<RequesterSummary> {
  assertPermitted(viewer);
  const [requests, settings] = await Promise.all([load(db, { ownerId }), getTeamSettings(db)]);
  return summariseRequests(requests, (type) => settings[OWNING_ROLE[type] as "SOA" | "PURCHASING"].sla, now);
}
