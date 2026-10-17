import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { dashboardFromSlug } from "@/domain/access/dashboards";
import { AdminDashboard } from "@/features/dashboards/admin-dashboard";
import { PlannedDashboard } from "@/features/dashboards/planned-dashboard";
import { ROLE_DASHBOARDS } from "@/features/dashboards/definitions";
import { RoleQueue } from "@/features/dashboards/role-queue";
import { requirePermission } from "@/server/auth/current-user";

export default function RoleDashboardPage({ params }: PageProps<"/dashboard/[role]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <RoleDashboard params={params} />
    </Suspense>
  );
}

async function RoleDashboard({ params }: Pick<PageProps<"/dashboard/[role]">, "params">) {
  const key = dashboardFromSlug((await params).role);
  if (!key) notFound();

  const viewer = await requirePermission(`dashboard.${key}.view`);

  if (key === "admin" || key === "superadmin") {
    return <AdminDashboard viewer={viewer} scope={key} />;
  }
  return (
    <PlannedDashboard definition={ROLE_DASHBOARDS[key]}>
      <RoleQueue viewer={viewer} dashboard={key} />
    </PlannedDashboard>
  );
}
