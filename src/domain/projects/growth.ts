import type { ProjectProgress } from "./progress";

/**
 * Pipeline Growth: how many projects stand in each of three groups of the sales progress scale at the end of each reporting period.
 *
 *  - Opportunity: Qualify, Understand.
 *  - Quoted: Propose (the quotation is submitted), Negotiate, Negotiate (FU), Agree.
 *  - Closed Won.
 *
 * Closed Lost has left the pipeline and is in none of them. The three groups are mutually exclusive, so a project is counted once.
 * "Eligible total" below is Opportunity + Quoted + Closed Won: every project that is, or was, in the pipeline at that moment and was not lost.
 */
export const GROWTH_CATEGORIES = ["OPPORTUNITY", "QUOTED", "CLOSED_WON"] as const;
export type GrowthCategory = (typeof GROWTH_CATEGORIES)[number];

export const GROWTH_CATEGORY_LABELS: Record<GrowthCategory, string> = { OPPORTUNITY: "Opportunity", QUOTED: "Quoted", CLOSED_WON: "Closed Won" };

/** Used for lines, areas, markers, the legend, the tooltip and the summary cards alike. */
export const GROWTH_COLORS: Record<GrowthCategory, string> = { OPPORTUNITY: "#F5B800", QUOTED: "#2F80ED", CLOSED_WON: "#10B981" };

export const GROWTH_STAGES: Record<GrowthCategory, readonly ProjectProgress[]> = {
  OPPORTUNITY: ["QUALIFY", "UNDERSTAND"],
  QUOTED: ["PROPOSE", "NEGOTIATE", "NEGOTIATE_FU", "AGREE"],
  CLOSED_WON: ["CLOSED_WON"],
};

/** The group of a progress step; null for Closed Lost (out of the pipeline) and for a value this code does not know (never guessed into a group). */
export function categoryOf(progress: string): GrowthCategory | null {
  for (const category of GROWTH_CATEGORIES) if ((GROWTH_STAGES[category] as readonly string[]).includes(progress)) return category;
  return null;
}

/** The steps of Propose and beyond, for Pipeline Conversion. */
export const PROPOSE_OR_BEYOND: readonly ProjectProgress[] = GROWTH_STAGES.QUOTED;

/**
 * Pipeline Conversion = open projects at Propose or beyond / open projects x 100.
 * "Open" is the dashboard's: not Closed Won, not Closed Lost, and Status not Done. It is the share of today's open pipeline that has reached
 * the quotation step; it is NOT a historical conversion rate (that needs stage history and a cohort), and a project that closed leaves both sides.
 */
export function pipelineConversion(open: number, openAtPropose: number): { open: number; atPropose: number; percent: number | null } {
  return { open, atPropose: openAtPropose, percent: open > 0 ? Math.round((openAtPropose / open) * 1000) / 10 : null };
}

// ---- Periods ---------------------------------------------------------------------------------------------------------------------------

export const GRANULARITIES = ["weekly", "monthly", "quarterly"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export function isGranularity(value: unknown): value is Granularity {
  return typeof value === "string" && (GRANULARITIES as readonly string[]).includes(value);
}

/** How many periods each granularity shows, ending with the current one (the longest history the chart is asked for). */
export const GRANULARITY_PERIODS: Record<Granularity, number> = { weekly: 12, monthly: 12, quarterly: 8 };

export const GRANULARITY_LABELS: Record<Granularity, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };

/**
 * The business time zone is Asia/Jakarta (request codes use it too). It has no daylight saving and is UTC+7 all year, so a period
 * boundary is a fixed offset from UTC.
 */
export const BUSINESS_UTC_OFFSET_HOURS = 7;
const OFFSET_MS = BUSINESS_UTC_OFFSET_HOURS * 3_600_000;
const DAY_MS = 86_400_000;

/** A period of the chart: [start, endExclusive) in business time. `asOf` is the moment its counts are taken: its last instant, or now for the running period. */
export type Period = { key: string; label: string; start: Date; endExclusive: Date; asOf: Date; running: boolean };

/** Business-time calendar fields of an instant, as a UTC date whose fields are the local ones. */
const local = (instant: Date) => new Date(instant.getTime() + OFFSET_MS);
/** The instant of midnight business time on the given local calendar date. */
const midnight = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day) - OFFSET_MS);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** ISO 8601 week (Monday first; week 1 holds the year's first Thursday) of a local calendar date. */
function isoWeek(localDate: Date): { year: number; week: number } {
  const thursday = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: thursday.getUTCFullYear(), week };
}

const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

function finish(key: string, label: string, start: Date, endExclusive: Date, now: Date): Period {
  const running = now.getTime() < endExclusive.getTime();
  return { key, label, start, endExclusive, running, asOf: running ? now : new Date(endExclusive.getTime() - 1) };
}

/**
 * The periods of a granularity, oldest first, ending with the one that holds `now`. Weeks start on Monday (ISO weeks), months and quarters are
 * calendar ones; every boundary is midnight in business time. A week that crosses a month or year is one week. The last period is still running.
 */
export function buildPeriods(granularity: Granularity, now: Date, count: number = GRANULARITY_PERIODS[granularity]): Period[] {
  const today = local(now);
  const periods: Period[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    if (granularity === "weekly") {
      const mondayOfNow = midnight(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
      const start = new Date(mondayOfNow.getTime() - back * 7 * DAY_MS);
      const endExclusive = new Date(start.getTime() + 7 * DAY_MS);
      const first = local(start);
      const last = local(new Date(endExclusive.getTime() - 1));
      const { year, week } = isoWeek(first);
      const sameMonth = first.getUTCMonth() === last.getUTCMonth();
      const range = sameMonth ? `${first.getUTCDate()}–${dayMonth(last)}` : `${dayMonth(first)} – ${dayMonth(last)}`;
      periods.push(finish(`${year}-W${String(week).padStart(2, "0")}`, `W${String(week).padStart(2, "0")} ${year} · ${range}`, start, endExclusive, now));
    } else if (granularity === "monthly") {
      const month = today.getUTCMonth() - back;
      const start = midnight(today.getUTCFullYear(), month, 1);
      const endExclusive = midnight(today.getUTCFullYear(), month + 1, 1);
      const first = local(start);
      periods.push(finish(`${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`, `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`, start, endExclusive, now));
    } else {
      const quarterIndex = Math.floor(today.getUTCMonth() / 3) - back;
      const start = midnight(today.getUTCFullYear(), quarterIndex * 3, 1);
      const endExclusive = midnight(today.getUTCFullYear(), quarterIndex * 3 + 3, 1);
      const first = local(start);
      const quarter = Math.floor(first.getUTCMonth() / 3) + 1;
      periods.push(finish(`${first.getUTCFullYear()}-Q${quarter}`, `Q${quarter} ${first.getUTCFullYear()}`, start, endExclusive, now));
    }
  }
  return periods;
}

// ---- Points, percentages and comparisons -------------------------------------------------------------------------------------------------

export type GrowthCounts = Record<GrowthCategory, number>;

/** One point of the chart. Counts are null where history cannot say (the period ended before the earliest reliable date). */
export type GrowthPoint = {
  key: string;
  label: string;
  start: string;
  asOf: string;
  running: boolean;
  /** False when the period ended before stage history started: nothing is invented for it. */
  reliable: boolean;
  counts: GrowthCounts | null;
  total: number | null;
  percents: GrowthCounts | null;
};

/** Category share of the eligible total, one decimal. A zero total gives zeros, never NaN or Infinity. */
export function percentOf(count: number, total: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export function percentsOf(counts: GrowthCounts): GrowthCounts {
  const total = GROWTH_CATEGORIES.reduce((sum, category) => sum + counts[category], 0);
  return { OPPORTUNITY: percentOf(counts.OPPORTUNITY, total), QUOTED: percentOf(counts.QUOTED, total), CLOSED_WON: percentOf(counts.CLOSED_WON, total) };
}

export const totalOf = (counts: GrowthCounts) => GROWTH_CATEGORIES.reduce((sum, category) => sum + counts[category], 0);

/** Change of a count against the period before it. "na" when the earlier period is unknown, "new" when it was zero and now is not. */
export type Comparison = { kind: "na" } | { kind: "new"; delta: number } | { kind: "flat"; delta: 0; percent: 0 } | { kind: "change"; delta: number; percent: number };

export function compareCounts(current: number | null, previous: number | null): Comparison {
  if (current === null || previous === null) return { kind: "na" };
  const delta = current - previous;
  if (previous === 0) return current === 0 ? { kind: "flat", delta: 0, percent: 0 } : { kind: "new", delta };
  if (delta === 0) return { kind: "flat", delta: 0, percent: 0 };
  return { kind: "change", delta, percent: Math.round((delta / previous) * 1000) / 10 };
}

/** The wording of a comparison. A fall is not called bad: a project that moved from Opportunity to Quoted is progress. */
export function describeComparison(comparison: Comparison, period: string): string {
  switch (comparison.kind) {
    case "na":
      return "N/A";
    case "new":
      return `Baru (+${comparison.delta})`;
    case "flat":
      return "Tidak berubah";
    case "change":
      return `${comparison.delta > 0 ? "+" : "−"}${Math.abs(comparison.delta)} (${comparison.percent > 0 ? "+" : "−"}${Math.abs(comparison.percent)}%) dibanding ${period} sebelumnya`;
  }
}
