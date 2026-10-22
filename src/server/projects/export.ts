import { effectiveIndustry } from "@/domain/customers/industry";
import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { principalNamesOf } from "@/domain/projects/master-data";
import type { ExportProject } from "@/domain/projects/export";
import { targetMarginAmount, targetMarginPercentOf, weightedValue } from "@/domain/projects/pipeline";
import { PROGRESS_PERCENT } from "@/domain/projects/progress";
import { isOpen } from "@/domain/requests/status";

type Viewer = { id: string; role: Role };

/** Every project with the values the export can show, newest project number first. */
export async function listProjectsForExport(db: PrismaClient, viewer: Viewer): Promise<ExportProject[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.project.findMany({
    where: { deletedAt: null },
    include: {
      salesOwner: { select: { name: true } },
      customer: { select: { industry: true } },
      technicalPic: { select: { name: true } },
      principal: { select: { name: true } },
      principals: { orderBy: { position: "asc" }, select: { principal: { select: { name: true } } } },
      solutionCategory: { select: { name: true } },
      requests: { select: { status: true } },
    },
  });
  return rows
    .sort((a, b) => Number(b.code.slice(9)) - Number(a.code.slice(9)))
    .map((row) => {
      const estimatedValue = row.estimatedValue?.toNumber() ?? null;
      const finalValue = row.finalValue?.toNumber() ?? null;
      const percent = row.targetMargin?.toNumber() ?? null;
      const fixed = row.targetMarginValue?.toNumber() ?? null;
      return {
        code: row.code,
        accountName: row.endUserCompany,
        projectTitle: row.name,
        progress: row.progress,
        trackStatus: row.trackStatus,
        lastUpdated: row.updatedAt,
        quoteReleasedAt: row.quoteReleasedAt,
        estimatedValue,
        probability: PROGRESS_PERCENT[row.progress],
        weightedValue: weightedValue(estimatedValue, row.progress),
        targetMargin: targetMarginPercentOf(estimatedValue, finalValue, percent, fixed),
        estimatedGrossProfit: targetMarginAmount(estimatedValue, finalValue, percent, fixed),
        finalValue,
        targetDate: row.targetDate,
        wonDate: row.wonDate,
        salesPic: row.salesOwner?.name ?? null,
        sourceType: row.sourceType,
        externalSourceName: row.externalSourceName,
        externalContact: row.externalContact,
        externalReference: row.externalReference,
        sourceNotes: row.sourceNotes,
        technicalPic: row.technicalPic?.name ?? null,
        principal: principalNamesOf(row).join("; ") || null,
        solution: row.solutionCategory?.name ?? null,
        industry: effectiveIndustry(row.customer?.industry, row.industry),
        location: row.location,
        currentAction: row.currentAction,
        nextAction: row.nextAction,
        openRequests: row.requests.filter((request) => isOpen(request.status)).length,
        totalRequests: row.requests.length,
      };
    });
}
