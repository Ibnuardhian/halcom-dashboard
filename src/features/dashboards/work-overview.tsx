import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACTIVE_STATUSES, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { OWNING_TEAM_LABELS, REQUEST_TYPES, typeSlug } from "@/domain/requests/types";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import type { WorkStats } from "@/server/requests/queries";

function Scorecard({ label, value, href, note }: { label: string; value: number; href: string; note?: string }) {
  return (
    <Link href={href} className="group block rounded-xl ring-1 ring-foreground/10 transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex flex-col gap-1 p-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-3xl font-semibold tabular-nums text-primary">{value}</span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
    </Link>
  );
}

/**
 * Real counts from the database. Every number links to the list behind it. Metric definitions:
 * "open" is any request that is not Completed or Cancelled; "unassigned" is an open request with no assignee.
 */
export function WorkOverview({ stats }: { stats: WorkStats }) {
  return (
    <section aria-label="Work overview" className="mb-6 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Scorecard label="Active projects" value={stats.projectsActive} href={PROJECTS_PATH} />
        {REQUEST_TYPES.map((type) => (
          <Scorecard
            key={type}
            label={`Open ${type}`}
            value={stats.openByType[type]}
            href={`${REQUESTS_PATH}/${typeSlug(type)}?status=open`}
            note={`Dimiliki ${OWNING_TEAM_LABELS[type]}`}
          />
        ))}
        <Scorecard label="Unassigned (open)" value={stats.unassignedOpen} href={`${REQUESTS_PATH}?status=open`} note="Request terbuka tanpa penanggung jawab" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Requests by type and status</h2>
          </CardTitle>
          <CardDescription>Click a number to see the requests behind it.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                {ACTIVE_STATUSES.map((status) => (
                  <TableHead key={status} className="text-right">
                    {REQUEST_STATUS_LABELS[status]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {REQUEST_TYPES.map((type) => (
                <TableRow key={type}>
                  <TableCell className="font-mono font-medium">{type}</TableCell>
                  {ACTIVE_STATUSES.map((status) => {
                    const count = stats.statusCounts[type][status];
                    return (
                      <TableCell key={status} className="text-right tabular-nums">
                        {count === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <Link href={`${REQUESTS_PATH}/${typeSlug(type)}?status=${status}`} className="text-primary underline-offset-4 hover:underline">
                            {count}
                          </Link>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
