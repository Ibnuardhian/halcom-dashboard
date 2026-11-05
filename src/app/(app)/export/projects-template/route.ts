import { IMPORT_FIELD_KEYS, sheetDropdowns, templateHeaders } from "@/domain/projects/import";
import { importScope, scopedFieldKeys } from "@/domain/projects/import-scope";
import { requirePermission } from "@/server/auth/current-user";
import { toXlsx, XLSX_CONTENT_TYPE } from "@/server/export/xlsx";

/**
 * The Excel template for importing projects: the header row only, one column per importable field (required ones marked *). Whoever may
 * import may download it. It holds no data, so nothing is written to the audit log.
 */
export async function GET(): Promise<Response> {
  const viewer = await requirePermission("projects.import");
  // A salesperson gets only the columns of their part of the sheet; the Sales PIC is always themselves.
  const keys = viewer.role === "SALES" ? scopedFieldKeys(importScope(viewer.role), IMPORT_FIELD_KEYS) : undefined;
  return new Response(Buffer.from(toXlsx("Projects", templateHeaders(keys), [], sheetDropdowns(keys))), {
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": 'attachment; filename="halcom-projects-import-template.xlsx"',
      "cache-control": "no-store",
    },
  });
}
