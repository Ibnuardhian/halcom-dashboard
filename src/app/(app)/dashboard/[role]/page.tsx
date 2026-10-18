import { Suspense } from "react";
import { notFound } from "next/navigation";
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
    return <AdminDashboard viewer={viewer} scope={key} />;
  }
  if (key === "sales") {
    const query = await searchParams;
    const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
    const view = one(query.view) === "charts" ? "charts" : one(query.view) === "tracking" ? "tracking" : "table";
    const thisYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric" }).format(new Date()));
    const wanted = Number(one(query.year));
    const year = Number.isInteger(wanted) && wanted >= 2001 && wanted <= 2099 ? wanted : thisYear;
    return <SalesPipeline viewer={viewer} view={view} year={year} />;
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
