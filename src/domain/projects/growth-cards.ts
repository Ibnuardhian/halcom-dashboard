import {
  compareCounts,
  GROWTH_CATEGORIES,
  GROWTH_CATEGORY_LABELS,
  GROWTH_COLORS,
  type Comparison,
  type Granularity,
  type GrowthCategory,
  type GrowthPoint,
} from "./growth";

export type GrowthCard = { category: GrowthCategory; label: string; color: string; count: number | null; percent: number | null; comparison: Comparison };

/** The period word of a granularity, for "dibanding minggu sebelumnya". */
export const PERIOD_WORDS: Record<Granularity, string> = { weekly: "minggu", monthly: "bulan", quarterly: "kuartal" };

/**
 * The three cards under the chart: the last period of the chart (the running one) against the one before it, from the same points
 * the chart draws, so the cards and the chart cannot disagree. A period without reliable history gives "N/A", not a made-up change.
 */
export function summariseGrowth(points: readonly GrowthPoint[]): GrowthCard[] {
  const current = points.at(-1) ?? null;
  const previous = points.length > 1 ? points[points.length - 2]! : null;
  return GROWTH_CATEGORIES.map((category) => ({
    category,
    label: GROWTH_CATEGORY_LABELS[category],
    color: GROWTH_COLORS[category],
    count: current?.counts?.[category] ?? null,
    percent: current?.percents?.[category] ?? null,
    comparison: compareCounts(current?.counts?.[category] ?? null, previous?.counts?.[category] ?? null),
  }));
}

/** The text of a tooltip line: "Quoted: 18 proyek (32.1%)". */
export function tooltipLine(category: GrowthCategory, count: number, percent: number): string {
  return `${GROWTH_CATEGORY_LABELS[category]}: ${count} proyek (${percent.toFixed(1)}%)`;
}

/** What the chart's endpoint returns (and the page renders): the points, the cards made from them, and when history starts. */
export type PipelineGrowth = {
  granularity: Granularity;
  timeZone: "Asia/Jakarta";
  points: GrowthPoint[];
  cards: GrowthCard[];
  /**
   * When project stage history starts (the first row of project_progress_history). Periods that ended before it are marked unreliable and
   * carry no counts: the stage of a project before that moment was never stored, and none is invented. Null when there is no history at all.
   */
  historyStartsAt: string | null;
};
