import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { PipelineCharts, PipelineTiles } from "@/features/dashboards/pipeline-charts";
import { PlannedDashboard } from "@/features/dashboards/planned-dashboard";
import { SHARED_DASHBOARD } from "@/features/dashboards/definitions";
import { WorkOverview } from "@/features/dashboards/work-overview";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { getWorkStats } from "@/server/requests/queries";

export default function SharedDashboardPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <SharedDashboard />
    </Suspense>
  );
}

async function SharedDashboard() {
  const viewer = await requirePermission("dashboard.shared.view");
  const [stats, analytics] = await Promise.all([getWorkStats(getDb(), viewer), getPipelineAnalytics(getDb(), viewer)]);
  return (
    <PlannedDashboard definition={SHARED_DASHBOARD}>
      <PipelineTiles analytics={analytics} />
      <PipelineCharts analytics={analytics} />
      <WorkOverview stats={stats} />
    </PlannedDashboard>
  );
}
