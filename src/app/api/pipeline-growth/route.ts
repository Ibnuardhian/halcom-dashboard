import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/domain/access/permissions";
import { GRANULARITIES, isGranularity } from "@/domain/projects/growth";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { getPipelineGrowth } from "@/server/projects/growth";

// Never cached: the answer depends on who asks and on the clock.
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The data of the Pipeline Growth chart: `GET /api/pipeline-growth?granularity=weekly|monthly|quarterly`. A salesperson gets their own
 * projects only; everyone else who may see projects gets all of them. The server decides the scope, so the URL cannot widen it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see this." }, { status: 401, headers: NO_STORE });
  if (!can(user.role, "projects.view")) return NextResponse.json({ error: "You may not see this." }, { status: 403, headers: NO_STORE });

  const granularity = request.nextUrl.searchParams.get("granularity");
  if (!isGranularity(granularity)) {
    return NextResponse.json({ error: `granularity must be one of: ${GRANULARITIES.join(", ")}.` }, { status: 400, headers: NO_STORE });
  }
  const growth = await getPipelineGrowth(getDb(), user, { granularity, salesOwnerId: user.role === "SALES" ? user.id : undefined });
  return NextResponse.json(growth, { headers: NO_STORE });
}
