import { CLOSED_PROGRESSES, PROGRESS_PERCENT, type ProjectProgress, type TrackStatus } from "@/domain/projects/progress";
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
  targetMargin: number | null;
  targetMarginValue: number | null;
  wonDate: Date | null;
  targetDate: Date | null;
};

export type TargetRow = { quarter: Quarter; revenueTarget: number | null; grossProfitTarget: number | null };

export type Figures = {
  /** Null when no target was entered. */
  target: number | null;
  /** Closed Won projects whose won date is in the quarter. */
  won: number;
  /** Open projects expected to close in the quarter, valued by estimate × the probability of their Progress. */
  forecast: number;
};

export type MonthFigures = { month: number; /** Null when no target is set for the month (not the same as a target of zero). */ target: number | null; /** Gross profit of Closed Won projects whose won date is in the month. */ won: number };

export type QuarterFigures = { quarter: Quarter; revenue: Figures; grossProfit: Figures };

export type TargetSummary = {
  year: number;
  quarters: QuarterFigures[];
  total: { revenue: Figures; grossProfit: Figures };
  /** January to December, gross profit only. */
  months: MonthFigures[];
  /** Closed Won projects with a won date in the year. */
  wonCount: number;
  /** Gross profit of open projects expected to close in the year, as entered: no probability applied, never part of won. */
  openPipelineGp: number;
  /** Things that keep the numbers from being complete; shown to the person instead of being guessed. */
  notes: { wonWithoutDate: number; wonWithoutMargin: number; openWithoutTargetDate: number };
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
 * Forecast uses the weighted value of open projects by their target closing date. A project missing a date or margin
 * adds nothing to the figure it needs and is counted in `notes` instead. A fixed margin amount is used as it is.
 */
export function summariseTargets(year: number, projects: readonly TargetProject[], targets: readonly TargetRow[], monthTargets: readonly { month: number; grossProfitTarget: number }[] = []): TargetSummary {
  const blank = (): Figures => ({ target: null, won: 0, forecast: 0 });
  const quarters: QuarterFigures[] = QUARTERS.map((quarter) => ({ quarter, revenue: blank(), grossProfit: blank() }));
  const at = (quarter: Quarter) => quarters[quarter - 1]!;
  const months: MonthFigures[] = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, target: null, won: 0 }));
  for (const row of monthTargets) months[row.month - 1]!.target = row.grossProfitTarget;
  let wonCount = 0;
  let openPipelineGp = 0;
  const notes = { wonWithoutDate: 0, wonWithoutMargin: 0, openWithoutTargetDate: 0 };

  for (const row of targets) {
    at(row.quarter).revenue.target = row.revenueTarget;
    at(row.quarter).grossProfit.target = row.grossProfitTarget;
  }

  for (const project of projects) {
    const value = project.finalValue ?? project.estimatedValue ?? 0;
    const percent = project.targetMargin;
    const fixed = project.targetMarginValue;
    if (project.progress === "CLOSED_WON") {
      if (!project.wonDate) {
        notes.wonWithoutDate += 1;
        continue;
      }
      const when = quarterOf(project.wonDate);
      if (when.year !== year) continue;
      at(when.quarter).revenue.won += value;
      wonCount += 1;
      const profit = fixed ?? (percent === null ? null : (value * percent) / 100);
      if (profit === null) notes.wonWithoutMargin += 1;
      else {
        at(when.quarter).grossProfit.won += profit;
        months[project.wonDate.getUTCMonth()]!.won += profit;
      }
    } else if (isOpenProject(project)) {
      if (!project.targetDate) {
        if (value > 0 || fixed !== null) notes.openWithoutTargetDate += 1;
        continue;
      }
      const when = quarterOf(project.targetDate);
      if (when.year !== year) continue;
      const open = fixed ?? (percent === null || project.estimatedValue === null ? null : (project.estimatedValue * percent) / 100);
      if (open !== null) openPipelineGp += open;
      const weighted = weightedValue(project.estimatedValue, project.progress);
      // The Gross Profit alone is enough for its forecast; the revenue forecast needs a value.
      if (weighted === null && fixed === null) continue;
      if (weighted !== null) at(when.quarter).revenue.forecast += weighted;
      if (fixed !== null) at(when.quarter).grossProfit.forecast += (fixed * PROGRESS_PERCENT[project.progress]) / 100;
      else if (percent !== null && weighted !== null) at(when.quarter).grossProfit.forecast += (weighted * percent) / 100;
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
  for (const m of months) m.won = round(m.won);
  return { year, quarters, months, wonCount, openPipelineGp: round(openPipelineGp), total: { revenue: total((q) => q.revenue), grossProfit: total((q) => q.grossProfit) }, notes };
}

export type CumulativePoint = { month: number; target: number | null; won: number };

/**
 * Running totals from January. The target line exists only when at least one month has a target; months without one add nothing to it
 * (the chart says so), and the line is never spread evenly on the person's behalf.
 */
export function cumulate(months: readonly MonthFigures[]): CumulativePoint[] {
  const hasTargets = months.some((m) => m.target !== null);
  let target = 0;
  let won = 0;
  return months.map((m) => {
    target += m.target ?? 0;
    won = Math.round((won + m.won) * 100) / 100;
    return { month: m.month, target: hasTargets ? target : null, won };
  });
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const MONTH_SHORT = MONTH_NAMES.map((name) => name.slice(0, 3));

export const quarterOfMonth = (month: number): Quarter => (Math.floor((month - 1) / 3) + 1) as Quarter;

/** The last month that counts as running or finished: 12 for a past year, 0 for a future one, the current month for this year. */
export function monthsElapsed(year: number, today: { year: number; month: number }): number {
  return year < today.year ? 12 : year > today.year ? 0 : today.month;
}

/** Achieved against the target planned up to `asOf` (months elapsed); null when no month has a target or nothing has elapsed. */
export function paceAt(points: readonly CumulativePoint[], asOf: number): { target: number; won: number; gap: number; percent: number | null } | null {
  const point = points[asOf - 1];
  if (!point || point.target === null) return null;
  return { target: point.target, won: point.won, gap: Math.round((point.won - point.target) * 100) / 100, percent: percentOf(point.won, point.target) };
}
