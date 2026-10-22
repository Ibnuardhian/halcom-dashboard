import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { dashboardFromSlug } from "@/domain/access/dashboards";
import { AdminDashboard } from "@/features/dashboards/admin-dashboard";
import { FinanceDashboard } from "@/features/dashboards/finance-dashboard";
import { PlannedDashboard } from "@/features/dashboards/planned-dashboard";
import { TeamDashboard } from "@/features/dashboards/team-dashboard";
import { ROLE_DASHBOARDS } from "@/features/dashboards/definitions";
import { RoleQueue } from "@/features/dashboards/role-queue";
import { SalesPipeline } from "@/features/dashboards/sales-pipeline";
import { requirePermission } from "@/server/auth/current-user";

export default function RoleDashboardPage({ params, searchParams }: PageProps<"/dashboard/[role]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <RoleDashboard params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RoleDashboard({ params, searchParams }: Pick<PageProps<"/dashboard/[role]">, "params" | "searchParams">) {
  const key = dashboardFromSlug((await params).role);
  if (!key) notFound();

  const viewer = await requirePermission(`dashboard.${key}.view`);

  if (key === "admin" || key === "superadmin") {
    return <AdminDashboard viewer={viewer} />;
  }
  if (key === "sales") {
    const query = await searchParams;
    const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
    // Targets live on their own page; an old link to the tracking view goes there.
    if (one(query.view) === "tracking") redirect(`/targets${one(query.year) ? `?year=${encodeURIComponent(one(query.year))}` : ""}`);
    return <SalesPipeline viewer={viewer} view={one(query.view) === "charts" ? "charts" : "table"} />;
  }
  if (key === "soa") return <TeamDashboard viewer={viewer} team="SOA" />;
  if (key === "purchasing") return <TeamDashboard viewer={viewer} team="PURCHASING" />;
  if (key === "finance") return <FinanceDashboard viewer={viewer} />;
  return (
    <PlannedDashboard definition={ROLE_DASHBOARDS[key]}>
      <RoleQueue viewer={viewer} dashboard={key} />
    </PlannedDashboard>
  );
}
