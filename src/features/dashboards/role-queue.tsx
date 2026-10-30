import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REQUESTS_PATH } from "@/features/navigation/links";
import { RequestTable } from "@/features/requests/request-table";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { listRequests, type RequestFilter } from "@/server/requests/queries";

type QueueConfig = { title: string; description: string; filter: RequestFilter; viewAllHref: string; empty: string };

const QUEUES = (): Record<"management", QueueConfig> => ({
  management: {
    title: "Open requests",
    description: "Semua yang masih berjalan, terbaru di atas.",
    filter: { openOnly: true, limit: 10 },
    viewAllHref: `${REQUESTS_PATH}?status=open`,
    empty: "Tidak ada request terbuka.",
  },
});

/** A short work queue for a role's dashboard, read from the database. */
export async function RoleQueue({ viewer, dashboard }: { viewer: SessionUser; dashboard: "management" }) {
  const config = QUEUES()[dashboard];
  const rows = await listRequests(getDb(), viewer, config.filter);
  return (
    <Card className="mb-6">
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
