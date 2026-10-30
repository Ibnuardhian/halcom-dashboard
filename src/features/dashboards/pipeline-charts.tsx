import { BarList, type BarItem } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { FILTER_EXTERNAL, projectsHref, type DrillFilters } from "@/domain/projects/drilldown";
import { buildFunnel } from "@/domain/projects/funnel";
import { pipelineConversion } from "@/domain/projects/growth";
import { PROGRESS_NAMES, type ProjectProgress, type TrackStatus } from "@/domain/projects/progress";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { formatAmount, formatCompact } from "@/features/projects/format";
import type { PipelineAnalytics, Slice } from "@/server/projects/analytics";
import { StatTile } from "./stat-tile";

const isNeutral = (slice: Slice) => slice.key === "other" || slice.label === "Not set";

/** Where a slice leads: the Projects list filtered to the projects it counts. A slice with no filter value is not a link. */
type SliceHref = (slice: Slice) => string | null;

const countItems = (slices: Slice[], href?: SliceHref): DonutItem[] => slices.map((s) => ({ key: s.key, label: s.label, value: s.count, neutral: isNeutral(s), href: href?.(s) ?? null }));

/** Value bars skip slices with no value at all, so "Not set" with no money does not show an empty row. */
const valueItems = (slices: Slice[], pick: (s: Slice) => number, href?: SliceHref): BarItem[] =>
  slices
    .filter((s) => pick(s) > 0)
    .map((s) => ({ key: s.key, label: s.label, value: pick(s), display: formatCompact(pick(s)), note: `${s.count} proyek`, neutral: isNeutral(s), href: href?.(s) ?? null }));

/** The headline numbers of the pipeline. Money is the sum of estimated PO values as entered. Pipeline conversion is the share of open projects at Propose or beyond. */
export function PipelineTiles({ analytics, scope = "all" }: { analytics: PipelineAnalytics; scope?: "all" | "mine" }) {
  const { totals } = analytics;
  // Today's open projects that have reached the quotation step; not a historical conversion rate (see src/domain/projects/growth.ts).
  const conversion = pipelineConversion(totals.open, totals.openQuoted);
  // Each tile opens the Projects list with the same filter; a salesperson's tiles keep to their own projects.
  const to = (show: string) => `${PROJECTS_PATH}?show=${show}${scope === "mine" ? "&mine=1" : ""}`;
  return (
    <section aria-label="Pipeline numbers" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatTile label={scope === "mine" ? "My open projects" : "Open projects"} value={totals.open} href={to("open")} note={`dari ${totals.projects} proyek`} />
      <StatTile label="Open pipeline" value={formatCompact(totals.openValue)} href={to("pipeline")} note={`${formatAmount(totals.openValue)} estimasi`} />
      <StatTile
        label="Pipeline conversion"
        value={conversion.percent === null ? "N/A" : `${conversion.percent}%`}
        href={to("quoted")}
        note={`${conversion.atPropose} dari ${conversion.open} open project (Propose+)`}
      />
      <StatTile label="Estimated gross profit" value={formatCompact(totals.openTargetMargin)} href={to("margin")} note={`${totals.openWithMargin} dari ${totals.open} open project punya target margin`} />
      <StatTile label="Won" value={formatCompact(totals.wonValue)} href={to("won")} note={`${totals.wonCount} proyek`} />
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
  // Every bar and slice opens the Projects list filtered to exactly the projects it counts; a salesperson's charts keep to their own.
  const to = (filters: DrillFilters) => projectsHref(PROJECTS_PATH, filters, { mine: own });
  const by = (name: "principal" | "solution" | "industry" | "owner"): SliceHref => (slice) => (slice.drill && slice.drill.length > 0 ? to({ [name]: slice.drill }) : null);
  const principal = by("principal");
  return (
    <section aria-label="Pipeline charts" className="mb-6 grid gap-4 lg:grid-cols-2">
      <ChartCard title="Sales funnel" description="Funnel Proyek & Estimasi Nilai (Tanpa Closed Lost)">
        <FunnelChart items={buildFunnel(analytics.byProgress).map((s) => ({ key: s.key, label: s.label, count: s.count, display: formatCompact(s.value), href: to({ reached: s.key }) }))} />
      </ChartCard>
      <ChartCard title="Pipeline by progress" description="Estimasi Nilai PO per Tahap Progres.">
        <ColumnChart items={analytics.byProgress.map((s) => ({ key: s.key, label: PROGRESS_NAMES[s.key as ProjectProgress], value: s.value, display: formatCompact(s.value), note: `${s.count}`, href: to({ progress: s.key as ProjectProgress }) }))} />
      </ChartCard>
      {own ? (
        <ChartCard title="Projects by status" description="On Track, On Hold, Done, atau Block.">
          <DonutChart items={countItems(analytics.byStatus, (slice) => to({ status: slice.key as TrackStatus }))} />
        </ChartCard>
      ) : (
        <>
          <ChartCard title="Projects by principal" description="Jumlah proyek per brand (principal). Proyek dengan beberapa principal dihitung di masing-masing.">
            <DonutChart items={countItems(analytics.byPrincipal, principal)} />
          </ChartCard>
          <ChartCard title="Value by principal" description="Estimasi Nilai per Brand (Hitung Ganda Multi-Principal)">
            <BarList items={valueItems(analytics.byPrincipal, (s) => s.value, principal)} />
          </ChartCard>
          <ChartCard title="Solution mix" description="Porsi proyek per solution category.">
            <DonutChart items={countItems(analytics.bySolution, by("solution"))} />
          </ChartCard>
          <ChartCard title="Value by industry" description="Estimated value per industri customer.">
            <BarList items={valueItems(analytics.byIndustry, (s) => s.value, by("industry"))} color={2} />
          </ChartCard>
          <ChartCard
            title="Pipeline conversion"
            description="Perbandingan porsi proyek aktif (tahap Propose+) per Sales PIC"
          >
            <BarList
              items={analytics.conversionBySalesPerson.map((row) => ({
                key: row.key,
                label: row.label,
                value: row.percent,
                display: `${row.percent}%`,
                note: `${row.quoted} dari ${row.open} terbuka`,
                neutral: row.drill === FILTER_EXTERNAL,
                // The denominator: this person's open projects (the note says how many of them are at Propose or beyond).
                href: `${to({ owner: [row.drill] })}&show=open`,
              }))}
              color={1}
              scaleMax={100}
              allowEmpty
              emptyText="Belum ada open project."
            />
          </ChartCard>
        </>
      )}
    </section>
  );
}

/**
 * The project side of the Technical dashboard: open projects per SOA PIC, then how all projects split by principal, solution and
 * industry (the same charts and drill-downs as the Overview, without the sales-only ones).
 */
export function ProjectMixCharts({ analytics }: { analytics: PipelineAnalytics }) {
  const to = (filters: DrillFilters) => projectsHref(PROJECTS_PATH, filters, { mine: false });
  const by = (name: "principal" | "solution" | "industry"): SliceHref => (slice) => (slice.drill && slice.drill.length > 0 ? to({ [name]: slice.drill }) : null);
  const principal = by("principal");
  return (
    <section aria-label="Project charts" className="mb-6 grid gap-4 lg:grid-cols-2">
      <ChartCard title="PIC Workload" description="Hanya project yang masih open (belum Closed Won/Lost dan belum Done), per PIC SOA. Project yang sudah ditutup tidak dihitung. Tanpa PIC tampil sebagai Not set.">
        <BarList
          items={analytics.bySoaPic.map((s) => ({ key: s.key, label: s.label, value: s.count, display: String(s.count), note: s.value > 0 ? formatCompact(s.value) : undefined, neutral: isNeutral(s), href: s.drill && s.drill.length > 0 ? `${to({ soaPic: s.drill })}&show=open` : null }))}
          allowEmpty
          emptyText="Belum ada open project."
        />
      </ChartCard>
      <ChartCard title="Projects by principal" description="Jumlah proyek per brand (principal). Proyek dengan beberapa principal dihitung di masing-masing.">
        <DonutChart items={countItems(analytics.byPrincipal, principal)} />
      </ChartCard>
      <ChartCard title="Value by principal" description="Estimasi Nilai per Brand (Hitung Ganda Multi-Principal)">
        <BarList items={valueItems(analytics.byPrincipal, (s) => s.value, principal)} />
      </ChartCard>
      <ChartCard title="Solution mix" description="Porsi proyek per solution category.">
        <DonutChart items={countItems(analytics.bySolution, by("solution"))} />
      </ChartCard>
      <ChartCard title="Value by industry" description="Estimated value per industri customer.">
        <BarList items={valueItems(analytics.byIndustry, (s) => s.value, by("industry"))} color={2} />
      </ChartCard>
    </section>
  );
}
