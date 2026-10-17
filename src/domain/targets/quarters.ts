import { CLOSED_PROGRESSES, type ProjectProgress, type TrackStatus } from "@/domain/projects/progress";
import { weightedValue } from "@/domain/projects/pipeline";

/**
 * Calendar quarters (Q1 is January to March). Assumption, not a confirmed rule: the target year is the calendar year
 * (OPEN_QUESTIONS T-16).
 */
export const QUARTERS = [1, 2, 3, 4] as const;
export type Quarter = (typeof QUARTERS)[number];

export const QUARTER_MONTHS: Record<Quarter, string> = { 1: "Jan–Mar", 2: "Apr–Jun", 3: "Jul–Sep", 4: "Oct–Dec" };

/** The quarter a calendar date falls in. Dates are stored as plain dates (UTC midnight), so the UTC parts are the date. */
export function quarterOf(date: Date): { year: number; quarter: Quarter } {
  return { year: date.getUTCFullYear(), quarter: (Math.floor(date.getUTCMonth() / 3) + 1) as Quarter };
}

/** The project facts a target is measured against. */
export type TargetProject = {
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  estimatedValue: number | null;
  finalValue: number | null;
  probability: number | null;
  targetMargin: number | null;
  wonDate: Date | null;
  targetDate: Date | null;
};

export type TargetRow = { quarter: Quarter; revenueTarget: number | null; grossProfitTarget: number | null };

export type Figures = {
  /** Null when no target was entered. */
  target: number | null;
  /** Closed Won projects whose won date is in the quarter. */
  won: number;
  /** Open projects expected to close in the quarter, valued by estimate × probability. */
  forecast: number;
};

export type QuarterFigures = { quarter: Quarter; revenue: Figures; grossProfit: Figures };

export type TargetSummary = {
  year: number;
  quarters: QuarterFigures[];
  total: { revenue: Figures; grossProfit: Figures };
  /** Things that keep the numbers from being complete; shown to the person instead of being guessed. */
  notes: { wonWithoutDate: number; wonWithoutMargin: number; openWithoutTargetDate: number; openWithoutProbability: number };
};

const isOpenProject = (project: TargetProject) => !CLOSED_PROGRESSES.includes(project.progress) && project.trackStatus !== "DONE";

/** Achieved over target as a percentage; null when there is no target (or it is zero) to measure against. */
export function percentOf(part: number, target: number | null): number | null {
  return target === null || target === 0 ? null : Math.round((part / target) * 1000) / 10;
}

const sumTargets = (values: (number | null)[]): number | null => (values.every((v) => v === null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0));

/**
 * Revenue and gross profit per quarter against the targets entered. Won uses the final value (the estimate until one
 * is entered) of Closed Won projects by their won date; gross profit is that value times the project's target margin.
 * Forecast uses the weighted value of open projects by their target closing date. A project missing a date, margin or
 * probability adds nothing to the figure it needs and is counted in `notes` instead.
 */
export function summariseTargets(year: number, projects: readonly TargetProject[], targets: readonly TargetRow[]): TargetSummary {
  const blank = (): Figures => ({ target: null, won: 0, forecast: 0 });
  const quarters: QuarterFigures[] = QUARTERS.map((quarter) => ({ quarter, revenue: blank(), grossProfit: blank() }));
  const at = (quarter: Quarter) => quarters[quarter - 1]!;
  const notes = { wonWithoutDate: 0, wonWithoutMargin: 0, openWithoutTargetDate: 0, openWithoutProbability: 0 };

  for (const row of targets) {
    at(row.quarter).revenue.target = row.revenueTarget;
    at(row.quarter).grossProfit.target = row.grossProfitTarget;
  }

  for (const project of projects) {
    const value = project.finalValue ?? project.estimatedValue ?? 0;
    const margin = project.targetMargin;
    if (project.progress === "CLOSED_WON") {
      if (!project.wonDate) {
        notes.wonWithoutDate += 1;
        continue;
      }
      const when = quarterOf(project.wonDate);
      if (when.year !== year) continue;
      at(when.quarter).revenue.won += value;
      if (margin === null) notes.wonWithoutMargin += 1;
      else at(when.quarter).grossProfit.won += (value * margin) / 100;
    } else if (isOpenProject(project)) {
      if (!project.targetDate) {
        if (value > 0) notes.openWithoutTargetDate += 1;
        continue;
      }
      const when = quarterOf(project.targetDate);
      if (when.year !== year) continue;
      const weighted = weightedValue(project.estimatedValue, project.probability, project.progress);
      if (weighted === null) {
        if (project.estimatedValue !== null) notes.openWithoutProbability += 1;
        continue;
      }
      at(when.quarter).revenue.forecast += weighted;
      if (margin !== null) at(when.quarter).grossProfit.forecast += (weighted * margin) / 100;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  for (const quarter of quarters) {
    for (const figures of [quarter.revenue, quarter.grossProfit]) {
      figures.won = round(figures.won);
      figures.forecast = round(figures.forecast);
    }
  }
  const total = (pick: (q: QuarterFigures) => Figures): Figures => ({
    target: sumTargets(quarters.map((q) => pick(q).target)),
    won: round(quarters.reduce((sum, q) => sum + pick(q).won, 0)),
    forecast: round(quarters.reduce((sum, q) => sum + pick(q).forecast, 0)),
  });
  return { year, quarters, total: { revenue: total((q) => q.revenue), grossProfit: total((q) => q.grossProfit) }, notes };
}
