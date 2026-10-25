import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { TargetTracking } from "@/features/dashboards/target-tracking";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getOwnTargets, getTargetSummary } from "@/server/targets/service";
import { can } from "@/domain/access/permissions";

export default function SalesTargetsPage({ searchParams }: PageProps<"/targets">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <SalesTargets searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * A salesperson's own targets against what they won, by quarter. A salesperson sees and edits only their own (the service
 * writes only the signed-in person's rows); an admin sees everyone's added together and has no form.
 */
async function SalesTargets({ searchParams }: Pick<PageProps<"/targets">, "searchParams">) {
  const viewer = await requirePermission("dashboard.sales.view");
  const query = await searchParams;
  const thisYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric" }).format(new Date()));
  const wanted = Number(typeof query.year === "string" ? query.year : "");
  const year = Number.isInteger(wanted) && wanted >= 2001 && wanted <= 2099 ? wanted : thisYear;
  const ownerId = viewer.role === "SALES" ? viewer.id : undefined;
  const db = getDb();
  const [summary, own] = await Promise.all([
    getTargetSummary(db, viewer, { year, salesOwnerId: ownerId }),
    ownerId && can(viewer.role, "targets.edit") ? getOwnTargets(db, viewer, year) : Promise.resolve(null),
  ]);

  return (
    <>
      <DashboardHeader title="Sales Targets" summary={ownerId ? "Target gross profit Anda dibandingkan dengan yang sudah dimenangkan, per kuartal." : "Gabungan target semua orang. Setiap salesperson mengatur targetnya masing-masing."} />
      <TargetTracking summary={summary} own={own} years={[year - 1, year, year + 1]} basePath="/targets" />
    </>
  );
}
