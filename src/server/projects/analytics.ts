import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { targetMarginAmount, targetMarginPercentOf, weightedValue } from "@/domain/projects/pipeline";
import { FILTER_EXTERNAL, FILTER_NONE } from "@/domain/projects/drilldown";
import { industryKey } from "@/domain/projects/drilldown";
import {
  CLOSED_PROGRESSES,
  PROGRESS_LABELS,
  PROJECT_PROGRESSES,
  TRACK_STATUSES,
  TRACK_STATUS_LABELS,
  type ProjectProgress,
  type TrackStatus,
} from "@/domain/projects/progress";

type Viewer = { id: string; role: Role };

/**
 * One bar or slice: how many projects, and their summed estimated and weighted value. `drill` is what the Projects list filters by
 * to show exactly these projects when the bar is clicked (an id, "none" for "Not set", "external" for the Other source); the folded
 * "Other (n)" slice carries the values of every slice folded into it.
 */
export type Slice = { key: string; label: string; count: number; value: number; weighted: number; drill?: string[] };

export type PipelineAnalytics = {
  /** Open means Sales have not closed it (Closed Won / Closed Lost) and its Status is not Done. */
  totals: {
    projects: number;
    open: number;
    openValue: number;
    openWeighted: number;
    /** Sum of the estimated gross profit (value × target margin) over open projects that have both. */
    openTargetMargin: number;
    openWithMargin: number;
    wonCount: number;
    wonValue: number;
  };
  byProgress: Slice[];
  byStatus: Slice[];
  byPrincipal: Slice[];
  bySolution: Slice[];
  byIndustry: Slice[];
  bySalesPerson: Slice[];
};

const UNSET = "Not set";
const EXTERNAL_KEY = "external-source";
const EXTERNAL_LABEL = "Other";
export const MAX_SLICES = 7;

/**
 * The projects behind each slice, kept aside so a folded slice can count a project once even when it sits in several of the folded
 * slices (a project built on three principals is under each of them, but it is one project in "Other").
 */
const MEMBERS = new WeakMap<Slice, Map<string, { estimated: number; weighted: number }>>();

function add(map: Map<string, Slice>, key: string, label: string, estimated: number | null, weighted: number | null, drill: string = key, projectId?: string): void {
  const slice = map.get(key) ?? { key, label, count: 0, value: 0, weighted: 0, drill: [drill] };
  if (projectId !== undefined) {
    const members = MEMBERS.get(slice) ?? new Map<string, { estimated: number; weighted: number }>();
    members.set(projectId, { estimated: estimated ?? 0, weighted: weighted ?? 0 });
    MEMBERS.set(slice, members);
  }
  slice.count += 1;
  slice.value += estimated ?? 0;
  slice.weighted += weighted ?? 0;
  map.set(key, slice);
}

/** Largest first by value, then by count; everything past `limit` is folded into one "Other" slice, "Not set" last. */
export function topSlices(slices: Iterable<Slice>, limit: number = MAX_SLICES): Slice[] {
  const all = [...slices];
  const unset = all.find((slice) => slice.label === UNSET);
  const named = all.filter((slice) => slice !== unset).sort((a, b) => b.value - a.value || b.count - a.count || a.label.localeCompare(b.label));
  const kept = named.slice(0, limit);
  const rest = named.slice(limit);
  if (rest.length > 0) {
    // A project that is in several folded slices is one project here.
    const union = new Map<string, { estimated: number; weighted: number }>();
    let tracked = true;
    for (const slice of rest) {
      const members = MEMBERS.get(slice);
      if (!members) tracked = false;
      else for (const [projectId, amounts] of members) union.set(projectId, amounts);
    }
    const folded: Slice = {
      key: "other",
      label: `Other (${rest.length})`,
      count: tracked ? union.size : rest.reduce((n, s) => n + s.count, 0),
      value: tracked ? [...union.values()].reduce((n, m) => n + m.estimated, 0) : rest.reduce((n, s) => n + s.value, 0),
      weighted: tracked ? [...union.values()].reduce((n, m) => n + m.weighted, 0) : rest.reduce((n, s) => n + s.weighted, 0),
      drill: rest.flatMap((s) => s.drill ?? [s.key]),
    };
    kept.push(folded);
  }
  if (unset) kept.push(unset);
  return kept;
}

/** Open: not closed by Sales and not Done. */
export function isOpenProject(progress: ProjectProgress, trackStatus: TrackStatus): boolean {
  return !CLOSED_PROGRESSES.includes(progress) && trackStatus !== "DONE";
}

/**
 * Pipeline composition for the charts, computed from the stored projects (never estimated). A project with no
 * value counts in the number of projects but adds nothing to the money columns. `salesOwnerId` narrows it to one
 * salesperson's projects.
 */
export async function getPipelineAnalytics(db: PrismaClient, viewer: Viewer, options: { salesOwnerId?: string } = {}): Promise<PipelineAnalytics> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const projects = await db.project.findMany({
    where: { deletedAt: null, ...(options.salesOwnerId ? { salesOwnerId: options.salesOwnerId } : {}) },
    select: {
      id: true,
      progress: true,
      trackStatus: true,
      estimatedValue: true,
      finalValue: true,
      targetMargin: true,
      targetMarginValue: true,
      industry: true,
      principal: { select: { id: true, name: true } },
      principals: { orderBy: { position: "asc" }, select: { principal: { select: { id: true, name: true } } } },
      solutionCategory: { select: { id: true, name: true } },
      salesOwner: { select: { id: true, name: true } },
    },
  });

  const progresses = new Map<string, Slice>(PROJECT_PROGRESSES.map((p) => [p, { key: p, label: PROGRESS_LABELS[p], count: 0, value: 0, weighted: 0 }]));
  const statuses = new Map<string, Slice>(TRACK_STATUSES.map((s) => [s, { key: s, label: TRACK_STATUS_LABELS[s], count: 0, value: 0, weighted: 0 }]));
  const principals = new Map<string, Slice>();
  const solutions = new Map<string, Slice>();
  const industries = new Map<string, Slice>();
  const salespeople = new Map<string, Slice>();
  const totals: PipelineAnalytics["totals"] = { projects: projects.length, open: 0, openValue: 0, openWeighted: 0, openTargetMargin: 0, openWithMargin: 0, wonCount: 0, wonValue: 0 };

  for (const project of projects) {
    const estimated = project.estimatedValue?.toNumber() ?? null;
    const finalValue = project.finalValue?.toNumber() ?? null;
    const weighted = weightedValue(estimated, project.progress);

    add(progresses, project.progress, PROGRESS_LABELS[project.progress], estimated, weighted);
    add(statuses, project.trackStatus, TRACK_STATUS_LABELS[project.trackStatus], estimated, weighted);
    // A project built on several principals counts under each of them (so these slices can add up to more than the projects).
    const brands = project.principals.length > 0 ? project.principals.map((link) => link.principal) : project.principal ? [project.principal] : [];
    if (brands.length === 0) add(principals, UNSET, UNSET, estimated, weighted, FILTER_NONE, project.id);
    for (const brand of brands) add(principals, brand.id, brand.name, estimated, weighted, brand.id, project.id);
    add(solutions, project.solutionCategory?.id ?? UNSET, project.solutionCategory?.name ?? UNSET, estimated, weighted, project.solutionCategory ? undefined : FILTER_NONE, project.id);
    const industry = project.industry?.trim() || UNSET;
    add(industries, industry.toLowerCase(), industry, estimated, weighted, industryKey(project.industry) ?? FILTER_NONE, project.id);
    // A project from another source has no internal Sales PIC; its numbers stay in the totals under one "external" row.
    add(salespeople, project.salesOwner?.id ?? EXTERNAL_KEY, project.salesOwner?.name ?? EXTERNAL_LABEL, estimated, weighted, project.salesOwner ? undefined : FILTER_EXTERNAL, project.id);

    if (isOpenProject(project.progress, project.trackStatus)) {
      totals.open += 1;
      totals.openValue += estimated ?? 0;
      totals.openWeighted += weighted ?? 0;
      const margin = targetMarginAmount(estimated, null, project.targetMargin?.toNumber() ?? null, project.targetMarginValue?.toNumber() ?? null);
      if (margin !== null) {
        totals.openTargetMargin += margin;
        totals.openWithMargin += 1;
      }
    }
    if (project.progress === "CLOSED_WON") {
      totals.wonCount += 1;
      totals.wonValue += finalValue ?? estimated ?? 0;
    }
  }

  return {
    totals,
    byProgress: [...progresses.values()],
    byStatus: [...statuses.values()].filter((slice) => slice.count > 0),
    byPrincipal: topSlices(principals.values()),
    bySolution: topSlices(solutions.values()),
    byIndustry: topSlices(industries.values()),
    bySalesPerson: topSlices(salespeople.values()),
  };
}

/** One row of the Sales project table: the columns of Sales' tracking sheet, in their order. */
export type PipelineProjectRow = {
  code: string;
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  /** When anything on the project last changed (an edit, or a current-action or next-action update). */
  lastUpdated: Date;
  quoteReleasedAt: Date | null;
  accountName: string;
  projectTitle: string;
  estimatedValue: number | null;
  targetMargin: number | null;
  /** Estimated gross profit: value × target margin; empty until both are known. */
  estimatedGrossProfit: number | null;
  isOpen: boolean;
};

/**
 * The projects of a salesperson (everyone's when `salesOwnerId` is omitted) for the Sales project table. Open projects
 * come first; among them the ones that have a value but no target margin, which Sales still have to fill in, then
 * the largest values.
 */
export async function listPipelineProjects(db: PrismaClient, viewer: Viewer, salesOwnerId?: string): Promise<PipelineProjectRow[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.project.findMany({ where: { deletedAt: null, ...(salesOwnerId ? { salesOwnerId } : {}) } });
  const mapped = rows.map((row): PipelineProjectRow => {
    const estimatedValue = row.estimatedValue?.toNumber() ?? null;
    const finalValue = row.finalValue?.toNumber() ?? null;
    const percent = row.targetMargin?.toNumber() ?? null;
    const fixed = row.targetMarginValue?.toNumber() ?? null;
    return {
      code: row.code,
      progress: row.progress,
      trackStatus: row.trackStatus,
      lastUpdated: row.updatedAt,
      quoteReleasedAt: row.quoteReleasedAt,
      accountName: row.endUserCompany,
      projectTitle: row.name,
      estimatedValue,
      targetMargin: targetMarginPercentOf(estimatedValue, finalValue, percent, fixed),
      estimatedGrossProfit: targetMarginAmount(estimatedValue, finalValue, percent, fixed),
      isOpen: isOpenProject(row.progress, row.trackStatus),
    };
  });
  const rank = (row: PipelineProjectRow) => (!row.isOpen ? 2 : row.estimatedValue !== null && row.estimatedGrossProfit === null ? 0 : 1);
  return mapped.sort((a, b) => rank(a) - rank(b) || (b.estimatedValue ?? -1) - (a.estimatedValue ?? -1) || a.code.localeCompare(b.code));
}
