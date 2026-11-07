import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { scanSlaAlerts } from "@/server/notifications/sla-alerts";

// Never cached: it writes, and the answer depends on the clock.
const NO_STORE = { "Cache-Control": "no-store" };

function secretMatches(header: string | null, secret: string): boolean {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const wanted = Buffer.from(secret);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * The SLA alert scan (D-083), called by cron on the server (deploy/sla-scan.sh) with `Authorization: Bearer $CRON_SECRET`. There is no
 * session here, so the secret is the only gate: without CRON_SECRET in the environment the route answers 404 as if it did not exist, and
 * a wrong or missing secret gets 401 with no detail. Counts only in the answer.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  if (!secretMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
  const result = await scanSlaAlerts(getDb());
  return NextResponse.json(result, { headers: NO_STORE });
}
