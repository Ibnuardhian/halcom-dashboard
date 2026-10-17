import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardKey } from "@/domain/access/dashboards";
import { REQUESTS_PATH } from "@/features/navigation/links";
import { RequestTable } from "@/features/requests/request-table";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { listRequests, type RequestFilter } from "@/server/requests/queries";

type QueueConfig = { title: string; description: string; filter: RequestFilter; viewAllHref: string; empty: string };

const QUEUES = (viewer: SessionUser): Record<Exclude<DashboardKey, "admin" | "superadmin">, QueueConfig> => ({
  sales: {
    title: "My requests",
    description: "BOQ, RFQ and PO requests you submitted, newest first.",
    filter: { requesterId: viewer.id, limit: 10 },
    viewAllHref: REQUESTS_PATH,
    empty: "You have not submitted any request yet.",
  },
  soa: {
    title: "Open BOQ requests",
    description: "BOQ requests that are not completed or cancelled, newest first.",
    filter: { type: "BOQ", openOnly: true, limit: 10 },
    viewAllHref: `${REQUESTS_PATH}/boq?status=open`,
    empty: "No open BOQ requests.",
  },
  purchasing: {
    title: "Open RFQ and PO requests",
    description: "Requests from Sales and from SOA handovers, newest first.",
    filter: { types: ["RFQ", "PO"], openOnly: true, limit: 10 },
    viewAllHref: `${REQUESTS_PATH}?status=open`,
    empty: "No open RFQ or PO requests.",
  },
  finance: {
    title: "Recent requests",
    description: "Read-only view of the latest requests across projects.",
    filter: { limit: 10 },
    viewAllHref: REQUESTS_PATH,
    empty: "No requests yet.",
  },
  management: {
    title: "Open requests",
    description: "Everything that is still in progress, newest first.",
    filter: { openOnly: true, limit: 10 },
    viewAllHref: `${REQUESTS_PATH}?status=open`,
    empty: "No open requests.",
  },
});

/** A short work queue for a role's dashboard, read from the database. */
export async function RoleQueue({ viewer, dashboard }: { viewer: SessionUser; dashboard: Exclude<DashboardKey, "admin" | "superadmin"> }) {
  const config = QUEUES(viewer)[dashboard];
  const rows = await listRequests(getDb(), viewer, config.filter);
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-base">
          <h2>{config.title}</h2>
        </CardTitle>
        <CardDescription>
          {config.description}{" "}
          <Link href={config.viewAllHref} className="underline underline-offset-4">
            View all
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RequestTable rows={rows} emptyText={config.empty} />
      </CardContent>
    </Card>
  );
}
