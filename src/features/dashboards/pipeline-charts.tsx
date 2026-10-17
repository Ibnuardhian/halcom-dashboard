import { BarList, type BarItem } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { buildFunnel } from "@/domain/projects/funnel";
import { PROGRESS_NAMES, type ProjectProgress } from "@/domain/projects/progress";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { formatAmount, formatCompact } from "@/features/projects/format";
import type { PipelineAnalytics, Slice } from "@/server/projects/analytics";
import { StatTile } from "./stat-tile";

const isNeutral = (slice: Slice) => slice.key === "other" || slice.label === "Not set";

const countItems = (slices: Slice[]): DonutItem[] => slices.map((s) => ({ key: s.key, label: s.label, value: s.count, neutral: isNeutral(s) }));

/** Value bars skip slices with no value at all, so "Not set" with no money does not show an empty row. */
const valueItems = (slices: Slice[], pick: (s: Slice) => number): BarItem[] =>
  slices
    .filter((s) => pick(s) > 0)
    .map((s) => ({ key: s.key, label: s.label, value: pick(s), display: formatCompact(pick(s)), note: `${s.count} project${s.count === 1 ? "" : "s"}`, neutral: isNeutral(s) }));

/** The headline numbers of the pipeline. Money is the sum of estimated PO values as entered; weighted is estimate times probability. */
export function PipelineTiles({ analytics, scope = "all" }: { analytics: PipelineAnalytics; scope?: "all" | "mine" }) {
  const { totals } = analytics;
  // Each tile opens the Projects list with the same filter; a salesperson's tiles keep to their own projects.
  const to = (show: string) => `${PROJECTS_PATH}?show=${show}${scope === "mine" ? "&mine=1" : ""}`;
  return (
    <section aria-label="Pipeline numbers" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatTile label={scope === "mine" ? "My open projects" : "Open projects"} value={totals.open} href={to("open")} note={`of ${totals.projects} in total`} />
      <StatTile label="Open pipeline" value={formatCompact(totals.openValue)} href={to("pipeline")} note={`${formatAmount(totals.openValue)} estimated`} />
      <StatTile label="Weighted pipeline" value={formatCompact(totals.openWeighted)} href={to("weighted")} note="Estimate × probability" />
      <StatTile label="Estimated gross profit" value={formatCompact(totals.openTargetMargin)} href={to("margin")} note={`${totals.openWithMargin} of ${totals.open} open projects have a target margin`} />
      <StatTile label="Won" value={formatCompact(totals.wonValue)} href={to("won")} note={`${totals.wonCount} project${totals.wonCount === 1 ? "" : "s"}`} />
    </section>
  );
}

/**
 * The charts of the pipeline. The overview (everyone, all projects) shows how the projects split by progress,
 * principal (brand), solution, industry and salesperson; a salesperson's own view keeps to progress and status.
 * Projects without a value count in the numbers of projects but add nothing to the money charts.
 */
export function PipelineCharts({ analytics, scope = "all" }: { analytics: PipelineAnalytics; scope?: "all" | "mine" }) {
  const own = scope === "mine";
  return (
    <section aria-label="Pipeline charts" className="mb-8 grid gap-4 lg:grid-cols-2">
      <ChartCard title="Sales funnel" description="Projects that reached each step, with their estimated value. Closed Lost projects have left the funnel.">
        <FunnelChart items={buildFunnel(analytics.byProgress).map((s) => ({ key: s.key, label: s.label, count: s.count, display: formatCompact(s.value) }))} />
      </ChartCard>
      <ChartCard title="Pipeline by progress" description="Estimated PO value of the projects at each progress step; the count is under the label.">
        <ColumnChart items={analytics.byProgress.map((s) => ({ key: s.key, label: PROGRESS_NAMES[s.key as ProjectProgress], value: s.value, display: formatCompact(s.value), note: `${s.count}` }))} />
      </ChartCard>
      {own ? (
        <ChartCard title="Projects by status" description="On track, on hold, done or blocked.">
          <DonutChart items={countItems(analytics.byStatus)} />
        </ChartCard>
      ) : (
        <>
          <ChartCard title="Projects by principal" description="Share of projects per brand (principal).">
            <DonutChart items={countItems(analytics.byPrincipal)} />
          </ChartCard>
          <ChartCard title="Value by principal" description="Estimated value per brand, largest first.">
            <BarList items={valueItems(analytics.byPrincipal, (s) => s.value)} />
          </ChartCard>
          <ChartCard title="Solution mix" description="Share of projects per solution category.">
            <DonutChart items={countItems(analytics.bySolution)} />
          </ChartCard>
          <ChartCard title="Value by industry" description="Estimated value per customer industry.">
            <BarList items={valueItems(analytics.byIndustry, (s) => s.value)} color={2} />
          </ChartCard>
          <ChartCard title="Weighted value by salesperson" description="Estimate × probability, per Sales PIC.">
            <BarList items={valueItems(analytics.bySalesPerson, (s) => s.weighted)} color={1} />
          </ChartCard>
        </>
      )}
    </section>
  );
}
