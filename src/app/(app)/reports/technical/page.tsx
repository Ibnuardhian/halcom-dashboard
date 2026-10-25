import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatPct } from "@/domain/requests/metrics";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getTechnicalReport } from "@/server/dashboards/metrics";

export default function TechnicalReportPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <TechnicalReport />
    </Suspense>
  );
}

async function TechnicalReport() {
  const viewer = await requirePermission("reports.technical.view");
  const rows = await getTechnicalReport(getDb(), viewer);
  const empty = rows.every((row) => row.received === 0 && row.completed === 0);

  return (
    <>
      <DashboardHeader
        title="Technical Reports"
        summary="Request BOQ per bulan kalender (waktu Jakarta): berapa yang masuk, berapa yang selesai, seberapa baik SLA terpenuhi, dan berapa lama waktu BOQ dari pengajuan sampai selesai."
      />
      <div className="mb-4 flex justify-end">
        <a href="/export/technical-report" className={buttonVariants({ variant: "outline" })}>
          Download CSV
        </a>
      </div>
      {empty ? (
        <p role="status" className="mb-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No BOQ request was received or completed in the last six months.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">Met SLA</TableHead>
            <TableHead className="text-right">Late</TableHead>
            <TableHead className="text-right">SLA compliance</TableHead>
            <TableHead className="text-right">Average turnaround</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.month}>
              <TableCell className="font-medium tabular-nums">{row.month}</TableCell>
              <TableCell className="text-right tabular-nums">{row.received}</TableCell>
              <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
              <TableCell className="text-right tabular-nums">{row.slaMet}</TableCell>
              <TableCell className="text-right tabular-nums">{row.slaLate}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPct(row.slaCompliancePct)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(row.avgTurnaroundHours)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">Compliance counts the BOQs completed in the month: those that met the SLA deadline over all of them. Waiting time for Sales is not counted against SOA.</p>
    </>
  );
}
