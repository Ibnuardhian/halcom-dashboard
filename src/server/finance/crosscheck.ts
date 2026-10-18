import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { CROSSCHECK_FLAGS, crosscheckFlags, type CrosscheckFlag } from "@/domain/finance/crosscheck";
import type { ProjectProgress, TrackStatus } from "@/domain/projects/progress";
import type { ProjectSourceType } from "@/domain/projects/source";
import { salesSideName } from "@/domain/projects/source";
import type { RequestStatus } from "@/domain/requests/status";
import type { RequestType } from "@/domain/requests/types";

type Viewer = { id: string; role: Role };

export type CrosscheckRow = {
  code: string;
  endUserCompany: string;
  name: string;
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  sourceType: ProjectSourceType;
  salesSide: string;
  estimatedValue: number | null;
  finalValue: number | null;
  wonDate: Date | null;
  references: { code: string; type: RequestType; status: RequestStatus }[];
  flags: CrosscheckFlag[];
  /** How many audit events the project has, and when the last one happened. */
  auditEvents: number;
  lastAuditAt: Date | null;
};

export type CrosscheckFilter = { flag?: CrosscheckFlag; search?: string };

export const CROSSCHECK_LIMIT = 500;

/**
 * Projects with their value, quotation and PO references and the cross-check flags, newest first. Read-only: the Finance role
 * holds no permission to change a project or a request. The flags are computed for every project; the filter narrows the list
 * afterwards, so a count shown elsewhere always matches the list it links to.
 */
export async function listCrosscheck(db: PrismaClient, viewer: Viewer, filter: CrosscheckFilter = {}): Promise<{ rows: CrosscheckRow[]; flagCounts: Record<CrosscheckFlag, number>; total: number }> {
  if (!can(viewer.role, "finance.crosscheck.view")) throw new Error("Forbidden: missing permission for this query.");
  const search = filter.search?.trim();
  const projects = await db.project.findMany({
    where: {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { endUserCompany: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { externalSourceName: { contains: search, mode: "insensitive" } },
              { requests: { some: { code: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      salesOwner: { select: { name: true } },
      requests: { where: { type: { in: ["RFQ", "PO"] } }, select: { code: true, type: true, status: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const audit = await db.auditEvent.groupBy({
    by: ["entityId"],
    where: { entityType: "project", entityId: { in: projects.map((project) => project.id) } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const auditOf = new Map(audit.map((row) => [row.entityId, row]));

  const flagCounts = Object.fromEntries(CROSSCHECK_FLAGS.map((flag) => [flag, 0])) as Record<CrosscheckFlag, number>;
  const rows: CrosscheckRow[] = projects
    .sort((a, b) => Number(b.code.slice(4)) - Number(a.code.slice(4)))
    .map((project) => {
      const finalValue = project.finalValue?.toNumber() ?? null;
      const flags = crosscheckFlags({ progress: project.progress, finalValue, requests: project.requests });
      for (const flag of flags) flagCounts[flag] += 1;
      const events = auditOf.get(project.id);
      return {
        code: project.code,
        endUserCompany: project.endUserCompany,
        name: project.name,
        progress: project.progress,
        trackStatus: project.trackStatus,
        sourceType: project.sourceType,
        salesSide: salesSideName(project),
        estimatedValue: project.estimatedValue?.toNumber() ?? null,
        finalValue,
        wonDate: project.wonDate,
        references: project.requests,
        flags,
        auditEvents: events?._count._all ?? 0,
        lastAuditAt: events?._max.createdAt ?? null,
      };
    });
  const shown = filter.flag ? rows.filter((row) => row.flags.includes(filter.flag!)) : rows;
  return { rows: shown.slice(0, CROSSCHECK_LIMIT), flagCounts, total: shown.length };
}
