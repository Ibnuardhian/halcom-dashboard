import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { prepareBackupDownload } from "@/server/system/backup";

/**
 * Downloads one backup file. Only for a holder of `system.backup` (the superadmin); the dump holds all business data, so every
 * download is written to the audit log and the file is never cached.
 */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  const user = await requirePermission("system.backup");
  const { name } = await context.params;
  const result = await prepareBackupDownload(getDb(), { id: user.id, role: user.role }, name);
  if (!result.ok) return new Response(result.message, { status: result.code === "FORBIDDEN" ? 403 : 404 });
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ result.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(result.file.sizeBytes),
      "content-disposition": `attachment; filename="${result.file.name}"`,
      "cache-control": "no-store",
    },
  });
}
