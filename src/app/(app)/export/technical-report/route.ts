import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { toCsv } from "@/server/export/csv";
import { getTechnicalReport } from "@/server/dashboards/metrics";

const HEADERS = ["Month", "Received", "Completed", "Met SLA", "Late", "SLA compliance (%)", "Average turnaround (hours)"];

/** The technical report as CSV, for the roles that may read it; written to the audit log. */
export async function GET(): Promise<Response> {
  const viewer = await requirePermission("reports.technical.view");
  const db = getDb();
  const rows = await getTechnicalReport(db, viewer);
  const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  const body = rows.map((row) => [row.month, row.received, row.completed, row.slaMet, row.slaLate, round(row.slaCompliancePct), round(row.avgTurnaroundHours)]);
  await db.auditEvent.create({ data: { actorId: viewer.id, action: "export.technical_report", entityType: "export", entityId: "technical-report", after: { months: rows.length, format: "csv" } } });
  return new Response(toCsv(HEADERS, body), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="halcom-technical-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
