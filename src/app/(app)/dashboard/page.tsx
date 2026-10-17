import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { PlannedDashboard } from "@/features/dashboards/planned-dashboard";
import { SHARED_DASHBOARD } from "@/features/dashboards/definitions";
import { requirePermission } from "@/server/auth/current-user";

export default function SharedDashboardPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <SharedDashboard />
    </Suspense>
  );
}

async function SharedDashboard() {
  await requirePermission("dashboard.shared.view");
  return <PlannedDashboard definition={SHARED_DASHBOARD} />;
}
