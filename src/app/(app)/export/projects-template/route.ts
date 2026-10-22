import { templateHeaders } from "@/domain/projects/import";
import { requirePermission } from "@/server/auth/current-user";
import { toXlsx, XLSX_CONTENT_TYPE } from "@/server/export/xlsx";

/**
 * The Excel template for importing projects: the header row only, one column per importable field (required ones marked *). Whoever may
 * import may download it. It holds no data, so nothing is written to the audit log.
 */
export async function GET(): Promise<Response> {
  await requirePermission("projects.import");
  return new Response(Buffer.from(toXlsx("Projects", templateHeaders(), [])), {
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": 'attachment; filename="halcom-projects-import-template.xlsx"',
      "cache-control": "no-store",
    },
  });
}
