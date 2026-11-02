import { can } from "@/domain/access/permissions";
import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { ExportDialog } from "@/features/dashboards/export-dialog";
import { PipelineCharts, PipelineTiles } from "@/features/dashboards/pipeline-charts";
import { PlannedDashboard } from "@/features/dashboards/planned-dashboard";
import { SHARED_DASHBOARD } from "@/features/dashboards/definitions";
import { StaleProjects } from "@/features/dashboards/stale-projects";
import { WorkOverview } from "@/features/dashboards/work-overview";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { getWorkStats, searchProjects } from "@/server/requests/queries";

export default function SharedDashboardPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <SharedDashboard />
    </Suspense>
  );
}

async function SharedDashboard() {
  const viewer = await requirePermission("dashboard.shared.view");
  const [stats, analytics, stale] = await Promise.all([
    getWorkStats(getDb(), viewer),
    getPipelineAnalytics(getDb(), viewer),
    searchProjects(getDb(), viewer, { show: "open" }, { pageSize: 25, sort: "lastUpdate", dir: "asc" }),
  ]);
  return (
    <PlannedDashboard definition={SHARED_DASHBOARD}>
      <PipelineTiles analytics={analytics} />
      <div className="mb-4 flex justify-end">
        <ExportDialog />
      </div>
      <PipelineCharts analytics={analytics} customerLinks={can(viewer.role, "customers.view")} />
      <StaleProjects projects={stale.rows.slice(0, 5)} />
      <WorkOverview stats={stats} />
    </PlannedDashboard>
  );
}
