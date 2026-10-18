import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { isOpen, REQUEST_STATUSES, type RequestStatus } from "@/domain/requests/status";
import { weightedValue } from "@/domain/projects/pipeline";
import { PROGRESS_PERCENT, type ProjectProgress, type TrackStatus } from "@/domain/projects/progress";
import type { SoaPhase } from "@/domain/requests/phase";
import { slaOf, type Sla } from "@/domain/requests/sla";
import { OWNING_ROLE, REQUEST_TYPES, type RequestType } from "@/domain/requests/types";
import { getTeamSettings } from "@/server/settings/team-settings";

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
  /** The win probability of the project's Progress step. */
  probability: number;
  weightedValue: number | null;
  finalValue: number | null;
  targetDate: Date | null;
  nextAction: string | null;
  openRequests: number;
  totalRequests: number;
  updatedAt: Date;
};

/**
 * The lists behind the pipeline tiles: open projects, open projects with an estimated value (the open pipeline),
 * open projects with a value and a target margin (the estimated gross profit) and Closed Won projects.
 */
export const PROJECT_SHOWS = ["open", "pipeline", "weighted", "margin", "won"] as const;
export type ProjectShow = (typeof PROJECT_SHOWS)[number];
export const PROJECT_SHOW_LABELS: Record<ProjectShow, string> = {
  open: "Open projects",
  pipeline: "Open pipeline (open projects with an estimated value)",
  weighted: "Weighted pipeline (open projects with an estimated value)",
  margin: "Estimated gross profit (open projects with a value and a target margin)",
  won: "Won projects",
};

export type ProjectFilter = {
  search?: string;
  progress?: ProjectProgress;
  trackStatus?: TrackStatus;
  principalId?: string;
  show?: ProjectShow;
  salesOwnerId?: string;
};

function showWhere(show: ProjectShow | undefined) {
  switch (show) {
    case "open":
      return { progress: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ProjectProgress[] }, trackStatus: { not: "DONE" as TrackStatus } };
    case "pipeline":
    case "weighted":
      return { progress: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ProjectProgress[] }, trackStatus: { not: "DONE" as TrackStatus }, estimatedValue: { not: null } };
    case "margin":
      return {
        progress: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ProjectProgress[] },
        trackStatus: { not: "DONE" as TrackStatus },
        estimatedValue: { not: null },
        AND: [{ OR: [{ targetMargin: { not: null } }, { targetMarginValue: { not: null } }] }],
      };
    case "won":
      return { progress: "CLOSED_WON" as ProjectProgress };
    default:
      return {};
  }
}

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
      deletedAt: null,
      ...showWhere(filter.show),
      // An explicit progress or status from the filter boxes narrows further and wins over the tile's own range.
      ...(filter.progress ? { progress: filter.progress } : {}),
      ...(filter.trackStatus ? { trackStatus: filter.trackStatus } : {}),
      principalId: filter.principalId,
      salesOwnerId: filter.salesOwnerId,
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
    // Newest first before the cap, so the cap never drops the newest projects (the list is then ordered by project number).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    include: {
      salesOwner: { select: { name: true } },
      technicalPic: { select: { name: true } },
      principal: { select: { name: true } },
      solutionCategory: { select: { name: true } },
      requests: { select: { status: true } },
    },
  });
  const rows = projects.sort(byCodeDescending).map((project) => {
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
      probability: PROGRESS_PERCENT[project.progress],
      weightedValue: weightedValue(estimatedValue, project.progress),
      finalValue: numberOrNull(project.finalValue),
      targetDate: project.targetDate,
      nextAction: project.nextAction,
      openRequests: project.requests.filter((request) => isOpen(request.status)).length,
      totalRequests: project.requests.length,
      updatedAt: project.updatedAt,
    };
  });
  return filter.show === "weighted" ? rows.filter((row) => (row.weightedValue ?? 0) > 0) : rows;
}

/** Principals that at least one project uses, for the filter. */
/** The accounts a superadmin can move a project to, by role. */
export async function listPicOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.reassign"));
  const users = await db.user.findMany({
    where: { isActive: true, role: { in: ["SALES", "SOA", "PURCHASING"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  const of = (role: Role) => users.filter((user) => user.role === role).map(({ id, name }) => ({ id, name }));
  return { sales: of("SALES"), soa: of("SOA"), purchasing: of("PURCHASING") };
}

export async function listPrincipalOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.principal.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Projects a request can be added to: the ones that are On Track. */
export async function listActiveProjectOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.project.findMany({
    where: { trackStatus: "ON_TRACK", deletedAt: null },
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
  /** The item details Sales or SOA wrote on the request. */
  description: string;
  projectCode: string;
  endUserCompany: string;
  projectName: string;
  principalName: string | null;
  solutionName: string | null;
  requesterName: string;
  assigneeName: string | null;
  requiredBy: Date | null;
  createdAt: Date;
  /** When the owning team should have answered by, and where the request stands against it. */
  sla: Sla;
  /** Sales decided not to continue to the next step after this request. */
  flowStopped: boolean;
};

export type RequestFilter = {
  type?: RequestType;
  /** Several types at once (the Purchasing queue is RFQ and PO). Ignored when `type` is set. */
  types?: readonly RequestType[];
  status?: RequestStatus;
  openOnly?: boolean;
  projectId?: string;
  requesterId?: string;
  /** Requests on the projects a person owns (Sales PIC), whoever raised them: a moved project brings its requests along. */
  projectOwnerId?: string;
  /** Free text: matches the request, project, End User, requester, PIC, Principal and Solution. */
  q?: string;
  limit?: number;
};

const ROW_INCLUDE = {
  project: { select: { code: true, endUserCompany: true, name: true, principal: { select: { name: true } }, solutionCategory: { select: { name: true } } } },
  requester: { select: { name: true } },
  assignee: { select: { name: true } },
  statusHistory: { select: { toStatus: true, changedAt: true } },
} as const;

/** Typed text is matched literally: LIKE wildcards in a search (`%`, `_`) and the escape character itself are escaped. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => "\\" + char);

function requestWhere(filter: RequestFilter) {
  const q = filter.q?.trim() ? escapeLike(filter.q.trim()) : undefined;
  return {
    project: { deletedAt: null, salesOwnerId: filter.projectOwnerId },
    type: filter.type ?? (filter.types ? { in: [...filter.types] } : undefined),
    status: filter.status ?? (filter.openOnly ? { in: REQUEST_STATUSES.filter(isOpen) } : undefined),
    projectId: filter.projectId,
    requesterId: filter.requesterId,
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { requester: { name: { contains: q, mode: "insensitive" as const } } },
            { assignee: { name: { contains: q, mode: "insensitive" as const } } },
            { project: { code: { contains: q, mode: "insensitive" as const } } },
            { project: { name: { contains: q, mode: "insensitive" as const } } },
            { project: { endUserCompany: { contains: q, mode: "insensitive" as const } } },
            { project: { principal: { name: { contains: q, mode: "insensitive" as const } } } },
            { project: { solutionCategory: { name: { contains: q, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
}

type RequestWithRelations = Awaited<ReturnType<typeof findWithRelations>>[number];

function findWithRelations(db: PrismaClient, args: { where: ReturnType<typeof requestWhere>; orderBy: Prisma.RequestOrderByWithRelationInput | Prisma.RequestOrderByWithRelationInput[]; take?: number; skip?: number }) {
  return db.request.findMany({ ...args, include: ROW_INCLUDE });
}

function toRow(request: RequestWithRelations, settings: Awaited<ReturnType<typeof getTeamSettings>>, now: Date): RequestRow {
  return {
    id: request.id,
    code: request.code,
    type: request.type,
    status: request.status,
    phase: request.phase,
    title: request.title,
    description: request.description,
    projectCode: request.project.code,
    endUserCompany: request.project.endUserCompany,
    projectName: request.project.name,
    principalName: request.project.principal?.name ?? null,
    solutionName: request.project.solutionCategory?.name ?? null,
    requesterName: request.requester.name,
    assigneeName: request.assignee?.name ?? null,
    requiredBy: request.requiredBy,
    createdAt: request.createdAt,
    flowStopped: request.flowStoppedAt !== null,
    sla: slaOf({
      createdAt: request.createdAt,
      status: request.status,
      completedAt: request.completedAt,
      history: request.statusHistory,
      range: settings[OWNING_ROLE[request.type] as "SOA" | "PURCHASING"].sla,
      now,
    }),
  };
}

export async function listRequests(db: PrismaClient, viewer: Viewer, filter: RequestFilter = {}): Promise<RequestRow[]> {
  assertPermitted(can(viewer.role, "requests.view"));
  const requests = await findWithRelations(db, {
    where: requestWhere(filter),
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? LIST_LIMIT, LIST_LIMIT),
  });
  const settings = await getTeamSettings(db);
  const now = new Date();
  return requests.map((request) => toRow(request, settings, now));
}

export const REQUEST_SORTS = ["created", "code", "project", "requester", "status", "sla", "needed"] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];
export const REQUEST_PAGE_SIZE = 20;
/** The most requests an SLA sort looks at: the SLA is computed, so it cannot be sorted by the database. */
const SLA_SORT_LIMIT = 1000;

export type RequestPage = { rows: RequestRow[]; total: number; page: number; pageCount: number; pageSize: number };

/** One page of requests with search (`q`), the usual filters and a sort. Used by the RFQ list. */
export async function searchRequests(
  db: PrismaClient,
  viewer: Viewer,
  filter: RequestFilter & { sort?: RequestSort; dir?: "asc" | "desc"; page?: number; pageSize?: number },
): Promise<RequestPage> {
  assertPermitted(can(viewer.role, "requests.view"));
  const pageSize = Math.min(Math.max(filter.pageSize ?? REQUEST_PAGE_SIZE, 1), 100);
  const sort = filter.sort ?? "created";
  const dir = filter.dir ?? "desc";
  const where = requestWhere(filter);
  const total = await db.request.count({ where });
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(Math.trunc(filter.page ?? 1) || 1, 1), pageCount);
  const settings = await getTeamSettings(db);
  const now = new Date();

  if (sort === "sla") {
    const all = await findWithRelations(db, { where, orderBy: { createdAt: "desc" }, take: SLA_SORT_LIMIT });
    const sign = dir === "asc" ? 1 : -1;
    const rows = all
      .map((request) => toRow(request, settings, now))
      .sort((a, b) => sign * (a.sla.dueAt.getTime() - b.sla.dueAt.getTime()) || a.code.localeCompare(b.code));
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageCount, pageSize };
  }

  const orderBy: Prisma.RequestOrderByWithRelationInput[] = [
    sort === "code"
      ? { code: dir }
      : sort === "project"
        ? { project: { code: dir } }
        : sort === "requester"
          ? { requester: { name: dir } }
          : sort === "status"
            ? { status: dir }
            : sort === "needed"
              ? { requiredBy: { sort: dir, nulls: "last" } }
              : { createdAt: dir },
    { id: "asc" },
  ];
  const found = await findWithRelations(db, { where, orderBy, take: pageSize, skip: (page - 1) * pageSize });
  return { rows: found.map((request) => toRow(request, settings, now)), total, page, pageCount, pageSize };
}

export async function getProjectByCode(db: PrismaClient, viewer: Viewer, code: string) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.project.findUnique({
    where: { code, deletedAt: null },
    include: {
      salesOwner: { select: { name: true } },
      technicalPic: { select: { name: true } },
      purchasingPic: { select: { name: true } },
      customer: { select: { name: true } },
      principal: { select: { name: true } },
      solutionCategory: { select: { name: true } },
    },
  });
}

/** True when the project has a completed RFQ, which a PO needs. */
export async function hasCompletedRfq(db: PrismaClient, viewer: Viewer, projectId: string): Promise<boolean> {
  assertPermitted(can(viewer.role, "requests.view"));
  return (await db.request.count({ where: { projectId, type: "RFQ", status: "COMPLETED" } })) > 0;
}

export type DecisionRow = { code: string; type: RequestType; title: string; projectCode: string; endUserCompany: string; projectName: string; completedAt: Date | null };

/**
 * Completed BOQs and RFQs whose next step nobody has decided yet: not continued, not stopped. A salesperson sees the ones on
 * their projects; `ownerId` omitted lists everyone's.
 */
export async function listPendingDecisions(db: PrismaClient, viewer: Viewer, ownerId?: string): Promise<DecisionRow[]> {
  assertPermitted(can(viewer.role, "requests.view"));
  const rows = await db.request.findMany({
    where: {
      type: { in: ["BOQ", "RFQ"] },
      status: "COMPLETED",
      flowStoppedAt: null,
      handovers: { none: {} },
      project: { deletedAt: null, ...(ownerId ? { salesOwnerId: ownerId } : {}) },
    },
    orderBy: { completedAt: "asc" },
    take: LIST_LIMIT,
    include: { project: { select: { code: true, endUserCompany: true, name: true } } },
  });
  return rows.map((row) => ({ code: row.code, type: row.type, title: row.title, projectCode: row.project.code, endUserCompany: row.project.endUserCompany, projectName: row.project.name, completedAt: row.completedAt }));
}

const REQUEST_DETAIL = {
  project: true,
  requester: { select: { name: true, role: true, email: true } },
  assignee: { select: { name: true } },
  source: { select: { code: true } },
  handovers: { select: { code: true, type: true }, orderBy: { createdAt: "asc" } },
  flowStoppedBy: { select: { name: true } },
  statusHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { name: true } } } },
} as const;

export async function getRequestByCode(db: PrismaClient, viewer: Viewer, code: string) {
  assertPermitted(can(viewer.role, "requests.view"));
  return db.request.findUnique({ where: { code, project: { deletedAt: null } }, include: REQUEST_DETAIL });
}

/** Every request of a project with the detail the request panel shows, in the order of the flow (BOQ, RFQ, PO), then by age. */
export async function listProjectRequestDetails(db: PrismaClient, viewer: Viewer, projectId: string) {
  assertPermitted(can(viewer.role, "requests.view"));
  const rows = await db.request.findMany({ where: { projectId, project: { deletedAt: null } }, include: REQUEST_DETAIL, orderBy: { createdAt: "asc" } });
  const order = (type: RequestType) => REQUEST_TYPES.indexOf(type);
  return rows.sort((a, b) => order(a.type) - order(b.type) || a.createdAt.getTime() - b.createdAt.getTime());
}

export type RequestDetail = NonNullable<Awaited<ReturnType<typeof getRequestByCode>>>;

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
    db.project.count({ where: { trackStatus: "ON_TRACK", deletedAt: null } }),
    db.request.groupBy({ by: ["type", "status"], where: { project: { deletedAt: null } }, _count: { _all: true } }),
    db.request.count({ where: { project: { deletedAt: null }, assigneeId: null, status: { in: REQUEST_STATUSES.filter(isOpen) } } }),
  ]);
  const zero = () => Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0])) as Record<RequestStatus, number>;
  const statusCounts = Object.fromEntries(REQUEST_TYPES.map((type) => [type, zero()])) as WorkStats["statusCounts"];
  for (const group of groups) statusCounts[group.type][group.status] = group._count._all;
  const openByType = Object.fromEntries(
    REQUEST_TYPES.map((type) => [type, REQUEST_STATUSES.filter(isOpen).reduce((sum, status) => sum + statusCounts[type][status], 0)]),
  ) as WorkStats["openByType"];
  return { projectsActive, openByType, statusCounts, unassignedOpen };
}
