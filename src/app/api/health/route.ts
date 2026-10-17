import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getHealthReport } from "@/server/health";

// Probe used by Docker health checks: it stays unauthenticated, so it must never
// expose internal details.
export async function GET(): Promise<Response> {
  await connection(); // evaluate at request time only, never during `next build`
  const report = await getHealthReport(() => getDb().$queryRaw`SELECT 1`);
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
