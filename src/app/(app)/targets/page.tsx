import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { TargetTracking } from "@/features/dashboards/target-tracking";
import { YearScope } from "@/features/targets/year-scope";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getOwnTargets, getSalesBreakdown, getTargetSummary, getTargetYears } from "@/server/targets/service";
import { can } from "@/domain/access/permissions";

export default function SalesTargetsPage({ searchParams }: PageProps<"/targets">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <SalesTargets searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * A salesperson's own gross-profit target against what they won, by month. A salesperson sees and edits only their own (the service
 * writes only the signed-in person's rows); an admin sees everyone's added together, with a row per salesperson, and has no form.
 */
async function SalesTargets({ searchParams }: Pick<PageProps<"/targets">, "searchParams">) {
  const viewer = await requirePermission("dashboard.sales.view");
  const query = await searchParams;
  // Asia/Jakarta decides which year and month are "now" (dates in the database are plain dates).
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "numeric" }).formatToParts(new Date());
  const today = { year: Number(parts.find((p) => p.type === "year")!.value), month: Number(parts.find((p) => p.type === "month")!.value) };
  const wanted = Number(typeof query.year === "string" ? query.year : "");
  const year = Number.isInteger(wanted) && wanted >= 2001 && wanted <= 2099 ? wanted : today.year;
  const ownerId = viewer.role === "SALES" ? viewer.id : undefined;
  const db = getDb();
  const [summary, own, breakdown, knownYears] = await Promise.all([
    getTargetSummary(db, viewer, { year, salesOwnerId: ownerId }),
    ownerId && can(viewer.role, "targets.edit") ? getOwnTargets(db, viewer, year) : Promise.resolve(null),
    ownerId ? Promise.resolve(null) : getSalesBreakdown(db, viewer, year),
    getTargetYears(db, viewer, { salesOwnerId: ownerId, thisYear: today.year }),
  ]);
  const years = [...new Set([...knownYears, year])].sort((a, b) => a - b);

  return (
    <>
      <DashboardHeader title="Sales targets" summary={ownerId ? "Target gross profit Anda dibandingkan dengan yang sudah dimenangkan, per bulan." : "Gabungan target semua orang. Setiap salesperson mengatur targetnya masing-masing."} />
      <YearScope year={year} years={years} thisYear={today.year} basePath="/targets">
        <TargetTracking summary={summary} own={own} breakdown={breakdown} today={today} />
      </YearScope>
    </>
  );
}
