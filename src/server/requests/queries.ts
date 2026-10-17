import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { isOpen, REQUEST_STATUSES, type RequestStatus } from "@/domain/requests/status";
import { weightedValue } from "@/domain/projects/pipeline";
import type { ProjectProgress, TrackStatus } from "@/domain/projects/progress";
import type { SoaPhase } from "@/domain/requests/phase";
import { REQUEST_TYPES, type RequestType } from "@/domain/requests/types";

type Viewer = { id: string; role: Role };

function assertPermitted(allowed: boolean): void {
  // Pages and actions check permissions first; this guards against a missed check.
  if (!allowed) throw new Error("Forbidden: missing permission for this query.");
}

/** Lists are capped; filters narrow them. Pagination arrives with the volume that needs it. */
export const LIST_LIMIT = 200;

export type ProjectRow = {
  id: string;
  code: string;
  endUserCompany: string;
  name: string;
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  principalName: string | null;
  solutionName: string | null;
  salesOwnerName: string;
  technicalPicName: string | null;
  estimatedValue: number | null;
  probability: number | null;
  weightedValue: number | null;
  finalValue: number | null;
  targetDate: Date | null;
  nextAction: string | null;
  openRequests: number;
  totalRequests: number;
  updatedAt: Date;
};

export type ProjectFilter = { search?: string; progress?: ProjectProgress; trackStatus?: TrackStatus; principalId?: string };

const numberOrNull = (value: { toNumber(): number } | null): number | null => (value === null ? null : value.toNumber());

/** Highest project number first, so the newest project is on top (PRJ-1000 sorts after PRJ-999). */
function byCodeDescending(a: { code: string }, b: { code: string }): number {
  return Number(b.code.slice(4)) - Number(a.code.slice(4));
}

export async function listProjects(db: PrismaClient, viewer: Viewer, filter: ProjectFilter = {}): Promise<ProjectRow[]> {
  assertPermitted(can(viewer.role, "projects.view"));
  const search = filter.search?.trim();
  const projects = await db.project.findMany({
    where: {
      progress: filter.progress,
      trackStatus: filter.trackStatus,
      principalId: filter.principalId,
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { endUserCompany: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { salesOwner: { name: { contains: search, mode: "insensitive" } } },
              { technicalPic: { name: { contains: search, mode: "insensitive" } } },
              { principal: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    take: LIST_LIMIT,
    include: {
      salesOwner: { select: { name: true } },
      technicalPic: { select: { name: true } },
      principal: { select: { name: true } },
      solutionCategory: { select: { name: true } },
      requests: { select: { status: true } },
    },
  });
  return projects.sort(byCodeDescending).map((project) => {
    const estimatedValue = numberOrNull(project.estimatedValue);
    return {
      id: project.id,
      code: project.code,
      endUserCompany: project.endUserCompany,
      name: project.name,
      progress: project.progress,
      trackStatus: project.trackStatus,
      principalName: project.principal?.name ?? null,
      solutionName: project.solutionCategory?.name ?? null,
      salesOwnerName: project.salesOwner.name,
      technicalPicName: project.technicalPic?.name ?? null,
      estimatedValue,
      probability: project.probability,
      weightedValue: weightedValue(estimatedValue, project.probability),
      finalValue: numberOrNull(project.finalValue),
      targetDate: project.targetDate,
      nextAction: project.nextAction,
      openRequests: project.requests.filter((request) => isOpen(request.status)).length,
      totalRequests: project.requests.length,
      updatedAt: project.updatedAt,
    };
  });
}

/** Principals that at least one project uses, for the filter. */
export async function listPrincipalOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.principal.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Projects a request can be added to: the ones that are On Track. */
export async function listActiveProjectOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.project.findMany({
    where: { trackStatus: "ON_TRACK" },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, code: true, endUserCompany: true, name: true },
  });
}

export type RequestRow = {
  id: string;
  code: string;
  type: RequestType;
  status: RequestStatus;
  /** The part of the BOQ work SOA is on (BOQ requests only). */
  phase: SoaPhase | null;
  title: string;
  projectCode: string;
  endUserCompany: string;
  projectName: string;
  requesterName: string;
  assigneeName: string | null;
  requiredBy: Date | null;
  createdAt: Date;
};

export type RequestFilter = {
  type?: RequestType;
  /** Several types at once (the Purchasing queue is RFQ and PO). Ignored when `type` is set. */
  types?: readonly RequestType[];
  status?: RequestStatus;
  openOnly?: boolean;
  projectId?: string;
  requesterId?: string;
  limit?: number;
};

export async function listRequests(db: PrismaClient, viewer: Viewer, filter: RequestFilter = {}): Promise<RequestRow[]> {
  assertPermitted(can(viewer.role, "requests.view"));
  const requests = await db.request.findMany({
    where: {
      type: filter.type ?? (filter.types ? { in: [...filter.types] } : undefined),
      status: filter.status ?? (filter.openOnly ? { in: REQUEST_STATUSES.filter(isOpen) } : undefined),
      projectId: filter.projectId,
      requesterId: filter.requesterId,
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? LIST_LIMIT, LIST_LIMIT),
    include: {
      project: { select: { code: true, endUserCompany: true, name: true } },
      requester: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });
  return requests.map((request) => ({
    id: request.id,
    code: request.code,
    type: request.type,
    status: request.status,
    phase: request.phase,
    title: request.title,
    projectCode: request.project.code,
    endUserCompany: request.project.endUserCompany,
    projectName: request.project.name,
    requesterName: request.requester.name,
    assigneeName: request.assignee?.name ?? null,
    requiredBy: request.requiredBy,
    createdAt: request.createdAt,
  }));
}

export async function getProjectByCode(db: PrismaClient, viewer: Viewer, code: string) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.project.findUnique({
    where: { code },
    include: {
      salesOwner: { select: { name: true } },
      technicalPic: { select: { name: true } },
      customer: { select: { name: true } },
      principal: { select: { name: true } },
      solutionCategory: { select: { name: true } },
    },
  });
}

export async function getRequestByCode(db: PrismaClient, viewer: Viewer, code: string) {
  assertPermitted(can(viewer.role, "requests.view"));
  return db.request.findUnique({
    where: { code },
    include: {
      project: true,
      requester: { select: { name: true, role: true, email: true } },
      assignee: { select: { name: true } },
      source: { select: { code: true } },
      handovers: { select: { code: true, type: true }, orderBy: { createdAt: "asc" } },
      statusHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { name: true } } } },
    },
  });
}

export type WorkStats = {
  projectsActive: number;
  openByType: Record<RequestType, number>;
  statusCounts: Record<RequestType, Record<RequestStatus, number>>;
  unassignedOpen: number;
};

/** Real counts for the dashboards. Nothing here is estimated: an empty system shows zeros. */
export async function getWorkStats(db: PrismaClient, viewer: Viewer): Promise<WorkStats> {
  assertPermitted(can(viewer.role, "requests.view"));
  const [projectsActive, groups, unassignedOpen] = await Promise.all([
    db.project.count({ where: { trackStatus: "ON_TRACK" } }),
    db.request.groupBy({ by: ["type", "status"], _count: { _all: true } }),
    db.request.count({ where: { assigneeId: null, status: { in: REQUEST_STATUSES.filter(isOpen) } } }),
  ]);
  const zero = () => Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0])) as Record<RequestStatus, number>;
  const statusCounts = Object.fromEntries(REQUEST_TYPES.map((type) => [type, zero()])) as WorkStats["statusCounts"];
  for (const group of groups) statusCounts[group.type][group.status] = group._count._all;
  const openByType = Object.fromEntries(
    REQUEST_TYPES.map((type) => [type, REQUEST_STATUSES.filter(isOpen).reduce((sum, status) => sum + statusCounts[type][status], 0)]),
  ) as WorkStats["openByType"];
  return { projectsActive, openByType, statusCounts, unassignedOpen };
}
