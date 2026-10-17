import { chooseColumns } from "@/domain/projects/export";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { toCsv } from "@/server/export/csv";
import { toXlsx, XLSX_CONTENT_TYPE } from "@/server/export/xlsx";
import { listProjectsForExport } from "@/server/projects/export";

/**
 * Downloads the projects as an Excel file (.xlsx, or CSV with `format=csv`) with the columns the person ticked on the overview (`?c=code&c=progress...`).
 * Anyone who may read projects may export them; each export is written to the audit log.
 */
export async function GET(request: Request): Promise<Response> {
  const viewer = await requirePermission("projects.view");
  const columns = chooseColumns(new URL(request.url).searchParams.getAll("c"));
  if (columns.length === 0) {
    return new Response("Choose at least one column to export.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const db = getDb();
  const projects = await listProjectsForExport(db, viewer);
  const headers = columns.map((column) => column.label);
  const rows = projects.map((project) => columns.map((column) => column.value(project)));
  const asCsv = new URL(request.url).searchParams.get("format") === "csv";
  await db.auditEvent.create({
    data: {
      actorId: viewer.id,
      action: "export.projects",
      entityType: "export",
      entityId: "projects",
      after: { columns: columns.map((column) => column.key), rows: projects.length, format: asCsv ? "csv" : "xlsx" },
    },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  if (asCsv) {
    return new Response(toCsv(headers, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="halcom-projects-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(Buffer.from(toXlsx("Projects", headers, rows)), {
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="halcom-projects-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
