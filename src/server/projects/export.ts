import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import type { ExportProject } from "@/domain/projects/export";
import { targetMarginAmount, weightedValue } from "@/domain/projects/pipeline";
import { isOpen } from "@/domain/requests/status";

type Viewer = { id: string; role: Role };

/** Every project with the values the export can show, newest project number first. */
export async function listProjectsForExport(db: PrismaClient, viewer: Viewer): Promise<ExportProject[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.project.findMany({
    include: {
      salesOwner: { select: { name: true } },
      technicalPic: { select: { name: true } },
      principal: { select: { name: true } },
      solutionCategory: { select: { name: true } },
      requests: { select: { status: true } },
    },
  });
  return rows
    .sort((a, b) => Number(b.code.slice(4)) - Number(a.code.slice(4)))
    .map((row) => {
      const estimatedValue = row.estimatedValue?.toNumber() ?? null;
      const finalValue = row.finalValue?.toNumber() ?? null;
      const targetMargin = row.targetMargin?.toNumber() ?? null;
      return {
        code: row.code,
        accountName: row.endUserCompany,
        projectTitle: row.name,
        progress: row.progress,
        trackStatus: row.trackStatus,
        lastUpdated: row.updatedAt,
        quoteReleasedAt: row.quoteReleasedAt,
        estimatedValue,
        probability: row.probability,
        weightedValue: weightedValue(estimatedValue, row.probability),
        targetMargin,
        estimatedGrossProfit: targetMarginAmount(estimatedValue, finalValue, targetMargin),
        finalValue,
        targetDate: row.targetDate,
        wonDate: row.wonDate,
        salesPic: row.salesOwner.name,
        technicalPic: row.technicalPic?.name ?? null,
        principal: row.principal?.name ?? null,
        solution: row.solutionCategory?.name ?? null,
        industry: row.industry,
        location: row.location,
        currentAction: row.currentAction,
        nextAction: row.nextAction,
        openRequests: row.requests.filter((request) => isOpen(request.status)).length,
        totalRequests: row.requests.length,
      };
    });
}
