import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { DonutChart } from "@/components/charts/donut-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatPct, METRICS_WINDOW_DAYS, UPCOMING_DAYS } from "@/domain/requests/metrics";
import { REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { HANDOFFS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { getTeamDashboard } from "@/server/dashboards/metrics";
import { DashboardHeader } from "./dashboard-header";
import { StatTile } from "./stat-tile";

const COPY = {
  SOA: {
    title: "Technical Dashboard",
    summary: "The BOQ requests SOA works on: how many are done, what is open, what is late, who carries the load and where requests wait.",
    noun: "BOQ",
    base: `${REQUESTS_PATH}/boq?`,
    emptyText: "No BOQ request has been raised yet, so there is nothing to measure.",
  },
  PURCHASING: {
    title: "Purchasing Dashboard",
    summary: "The RFQ and PO requests Purchasing works on: how many are done, what is open, what is late, who carries the load and how fast quotations come back.",
    noun: "RFQ & PO",
    // One list of both types: the numbers on this page count RFQ and PO together.
    base: `${REQUESTS_PATH}?types=RFQ,PO&`,
    emptyText: "No RFQ or PO request has been raised yet, so there is nothing to measure.",
  },
} as const;

/**
 * One dashboard for the two teams that work requests. Every number is computed from the stored requests and their status history
 * (src/domain/requests/metrics.ts holds the definitions) and links to the filtered list behind it.
 */
export async function TeamDashboard({ viewer, team }: { viewer: SessionUser; team: "SOA" | "PURCHASING" }) {
  const { metrics, summary, awaitingHandoff } = await getTeamDashboard(getDb(), viewer, team);
  const copy = COPY[team];
  const to = (query: string) => `${copy.base}${query}`;
  const measured = metrics.slaMet + metrics.slaLate;
  const empty = metrics.open === 0 && metrics.completedInWindow === 0 && metrics.workload.length === 0;

  return (
    <>
      <DashboardHeader title={copy.title} summary={copy.summary} />
      {empty ? (
        <p role="status" className="mb-6 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {copy.emptyText}
        </p>
      ) : null}

      <section aria-label={`Total ${copy.noun}`} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Total ${copy.noun}`} value={summary.total} href={to("")} note="Every request of the team, open or closed" />
        <StatTile label="Done" value={summary.done} href={to("status=COMPLETED")} note="Completed" />
        <StatTile label="Completion rate" value={formatPct(summary.completionPct)} note={`Done over total (${summary.done} of ${summary.total}); cancelled requests count in the total`} />
        <StatTile label="On going" value={summary.onGoing} href={to("status=IN_PROGRESS")} note="In progress now" />
      </section>

      <section aria-label="Status and PIC charts" className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title={`${copy.noun} by status`} description="Share of the team's requests in each status.">
          <DonutChart
            unit="requests"
            items={summary.byStatus.map((row) => ({ key: row.status, label: REQUEST_STATUS_LABELS[row.status], value: row.count, href: to(`status=${row.status}`) }))}
          />
        </ChartCard>
        <ChartCard title={`${copy.noun} per PIC`} description="Requests handed to each PIC of the team, with how many are done and on going. A PIC with none is listed too.">
          <BarList
            items={summary.byPic.map((row) => ({
              key: row.picId ?? "none",
              label: row.name,
              value: row.total,
              display: String(row.total),
              note: `${row.done} done · ${row.onGoing} on going`,
              neutral: row.picId === null,
              href: to(`assignee=${row.picId ?? "none"}`),
            }))}
            allowEmpty
          />
        </ChartCard>
      </section>

      <section aria-label={`${copy.noun} requests now`} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Open ${copy.noun} requests`} value={metrics.open} href={to("status=open")} note="Not completed or cancelled" />
        <StatTile label="Backlog" value={metrics.backlog} href={to("status=SUBMITTED")} note="Submitted, nobody has started" />
        <StatTile label="Overdue" value={metrics.overdue} href={to("sla=overdue")} note="Past the SLA deadline" />
        <StatTile label="Due now" value={metrics.dueNow} href={to("sla=due_soon")} note="Between the expected date and the deadline" />
        {team === "SOA" ? <StatTile label="In revision" value={metrics.revision} href={to("status=REVISION")} note="Completed BOQs being revised" /> : null}
        <StatTile label="Past needed-by date" value={metrics.pastNeededBy} href={to("deadline=past")} note="Open, and the date asked for has passed" />
        <StatTile label={`Needed in ${UPCOMING_DAYS} days`} value={metrics.upcomingDeadlines} href={to("deadline=soon")} note="Open, needed by today or soon" />
        {team === "SOA" ? (
          <StatTile label="Awaiting handoff" value={awaitingHandoff ?? 0} href={HANDOFFS_PATH} note="Completed BOQs nobody has continued or stopped" />
        ) : (
          <StatTile label="In progress" value={metrics.inProgress} href={to("status=IN_PROGRESS")} note="With Purchasing, quotation or vendor answer pending (vendor response is not a separate status yet)" />
        )}
      </section>

      <section aria-label="Service level and speed" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="SLA compliance"
          value={formatPct(metrics.slaCompliancePct)}
          note={measured === 0 ? `No ${copy.noun} completed in the last ${METRICS_WINDOW_DAYS} days` : `${metrics.slaMet} of ${measured} completed in the last ${METRICS_WINDOW_DAYS} days met the deadline`}
        />
        <StatTile label={team === "PURCHASING" ? "Quotation turnaround" : "Turnaround"} value={formatDuration(metrics.avgTurnaroundHours)} note={`Created to completed, average of ${metrics.completedInWindow} in ${METRICS_WINDOW_DAYS} days`} />
        <StatTile label="Processing time" value={formatDuration(metrics.avgProcessingHours)} note={`Turnaround minus the time in the queue (${formatDuration(metrics.avgQueueHours)})`} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Workload by assignee</h2>
            </CardTitle>
            <CardDescription>Open requests per PIC. A PIC is who a request is handed to; the team&apos;s login is shared.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.workload.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">No open requests.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.workload.map((row) => {
                    const person = row.assigneeId ?? "none";
                    return (
                      <TableRow key={person}>
                        <TableCell className={row.assigneeId === null ? "text-muted-foreground" : undefined}>{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Link href={to(`assignee=${person}&status=open`)} className="text-primary underline-offset-4 hover:underline">
                            {row.open}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.overdue === 0 ? (
                            <span className="text-muted-foreground">0</span>
                          ) : (
                            <Link href={to(`assignee=${person}&sla=overdue`)} className="text-destructive underline-offset-4 hover:underline">
                              {row.overdue}
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Bottlenecks by status</h2>
            </CardTitle>
            <CardDescription>How long the open requests have been in their current status. The oldest one is linked.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.bottlenecks.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">No open requests.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Average time</TableHead>
                    <TableHead>Oldest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.bottlenecks.map((row) => (
                    <TableRow key={row.status}>
                      <TableCell>{REQUEST_STATUS_LABELS[row.status]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Link href={to(`status=${row.status}`)} className="text-primary underline-offset-4 hover:underline">
                          {row.count}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatDuration(row.avgHours)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/request/${row.oldestCode}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                          {row.oldestCode}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">{formatDuration(row.oldestHours)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
