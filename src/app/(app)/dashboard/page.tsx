import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { PlannedDashboard } from "@/features/dashboards/planned-dashboard";
import { SHARED_DASHBOARD } from "@/features/dashboards/definitions";
import { WorkOverview } from "@/features/dashboards/work-overview";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
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
  const stats = await getWorkStats(getDb(), viewer);
  return (
    <PlannedDashboard definition={SHARED_DASHBOARD}>
      <WorkOverview stats={stats} />
    </PlannedDashboard>
  );
}
