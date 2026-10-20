import { CROSSCHECK_FLAG_LABELS, isCrosscheckFlag } from "@/domain/finance/crosscheck";
import { SOURCE_LABELS } from "@/domain/projects/source";
import { PROGRESS_LABELS } from "@/domain/projects/progress";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { toCsv } from "@/server/export/csv";
import { listCrosscheck } from "@/server/finance/crosscheck";

const HEADERS = ["Project ID", "End user", "Project", "Progress", "Project source", "Sales side", "Estimated value", "Final value", "Won date", "Quotation (RFQ) references", "PO references", "Flags", "Audit events"];

/** Downloads the cross-check as CSV. Read-only like the page, limited to roles that may see it, and written to the audit log. */
export async function GET(request: Request): Promise<Response> {
  const viewer = await requirePermission("finance.crosscheck.view");
  const flagParam = new URL(request.url).searchParams.get("flag") ?? "";
  const flag = isCrosscheckFlag(flagParam) ? flagParam : undefined;
  const db = getDb();
  const { rows } = await listCrosscheck(db, viewer, { flag });
  const refs = (row: (typeof rows)[number], type: "RFQ" | "PO") =>
    row.references
      .filter((reference) => reference.type === type)
      .map((reference) => `${reference.code} (${reference.status.toLowerCase()})`)
      .join("; ");
  const body = rows.map((row) => [
    row.code,
    row.endUserCompany,
    row.name,
    PROGRESS_LABELS[row.progress],
    SOURCE_LABELS[row.sourceType],
    row.salesSide,
    row.estimatedValue,
    row.finalValue,
    row.wonDate ? row.wonDate.toISOString().slice(0, 10) : null,
    refs(row, "RFQ"),
    refs(row, "PO"),
    row.flags.map((item) => CROSSCHECK_FLAG_LABELS[item]).join("; "),
    row.auditEvents,
  ]);
  await db.auditEvent.create({
    data: { actorId: viewer.id, action: "export.crosscheck", entityType: "export", entityId: "crosscheck", after: { rows: rows.length, flag: flag ?? null, format: "csv" } },
  });
  return new Response(toCsv(HEADERS, body), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="halcom-crosscheck-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
