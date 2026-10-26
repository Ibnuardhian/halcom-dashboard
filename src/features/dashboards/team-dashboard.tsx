import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { DonutChart } from "@/components/charts/donut-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatPct, METRICS_WINDOW_DAYS, UPCOMING_DAYS } from "@/domain/requests/metrics";
import { REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { HANDOFFS_PATH, PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { getTeamDashboard } from "@/server/dashboards/metrics";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { CollapsibleSection } from "./collapsible-section";
import { ProjectMixCharts } from "./pipeline-charts";
import { DashboardHeader } from "./dashboard-header";
import { StatTile } from "./stat-tile";

const COPY = {
  SOA: {
    title: "Technical Dashboard",
    summary: "Proyek dan request BOQ yang dikerjakan SOA: proyek terbuka, beban PIC, dan sebaran principal, solusi serta industri; di bawahnya request BOQ: berapa yang selesai, apa yang masih terbuka, apa yang terlambat, siapa yang menanggung beban kerja, dan di mana request menunggu.",
    noun: "BOQ",
    base: `${REQUESTS_PATH}/boq?`,
    emptyText: "Belum ada request BOQ yang diajukan, jadi belum ada yang bisa diukur.",
  },
  PURCHASING: {
    title: "Purchasing Dashboard",
    summary: "Request RFQ dan PO yang dikerjakan Purchasing: berapa yang selesai, apa yang masih terbuka, apa yang terlambat, siapa yang menanggung beban kerja, dan seberapa cepat quotation kembali.",
    noun: "RFQ & PO",
    // One list of both types: the numbers on this page count RFQ and PO together.
    base: `${REQUESTS_PATH}?types=RFQ,PO&`,
    emptyText: "Belum ada request RFQ atau PO yang diajukan, jadi belum ada yang bisa diukur.",
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

  // The technical team works on projects first: their numbers lead and the requests come below (Purchasing has only requests).
  const analytics = team === "SOA" ? await getPipelineAnalytics(getDb(), viewer) : null;

  const requests = (
    <>
      <section aria-label={`Total ${copy.noun}`} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Total ${copy.noun}`} value={summary.total} href={to("")} note="Semua request tim, terbuka maupun tertutup" />
        <StatTile label="Done" value={summary.done} href={to("status=COMPLETED")} note="Status Completed" />
        <StatTile label="Completion rate" value={formatPct(summary.completionPct)} note={`Done dibagi total (${summary.done} dari ${summary.total}); request yang Cancelled ikut dihitung di total`} />
        <StatTile label="On going" value={summary.onGoing} href={to("status=IN_PROGRESS")} note="Sedang In progress" />
      </section>

      <section aria-label="Status and PIC charts" className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title={`${copy.noun} by status`} description="Porsi request tim pada tiap status.">
          <DonutChart
            unit="requests"
            items={summary.byStatus.map((row) => ({ key: row.status, label: REQUEST_STATUS_LABELS[row.status], value: row.count, href: to(`status=${row.status}`) }))}
          />
        </ChartCard>
        <ChartCard title={`${copy.noun} per PIC`} description="Progres Request per PIC Tim.">
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
        <StatTile label={`Open ${copy.noun} requests`} value={metrics.open} href={to("status=open")} note="Belum Completed atau Cancelled" />
        <StatTile label="Backlog" value={metrics.backlog} href={to("status=SUBMITTED")} note="Submitted, belum ada yang memulai" />
        <StatTile label="Overdue" value={metrics.overdue} href={to("sla=overdue")} note="Melewati batas SLA" />
        <StatTile label="Due now" value={metrics.dueNow} href={to("sla=due_soon")} note="Antara tanggal yang diharapkan dan batas waktu" />
        {team === "SOA" ? <StatTile label="In revision" value={metrics.revision} href={to("status=REVISION")} note="BOQ Completed yang sedang direvisi" /> : null}
        <StatTile label="Past needed-by date" value={metrics.pastNeededBy} href={to("deadline=past")} note="Masih terbuka, dan tanggal yang diminta sudah lewat" />
        <StatTile label={`Needed in ${UPCOMING_DAYS} days`} value={metrics.upcomingDeadlines} href={to("deadline=soon")} note="Masih terbuka, dibutuhkan hari ini atau segera" />
        {team === "SOA" ? (
          <StatTile label="Awaiting handoff" value={awaitingHandoff ?? 0} href={HANDOFFS_PATH} note="BOQ Completed yang belum dilanjutkan atau dihentikan siapa pun" />
        ) : (
          <StatTile label="In progress" value={metrics.inProgress} href={to("status=IN_PROGRESS")} note="Status Request: Menunggu Respon Vendor (Purchasing)" />
        )}
      </section>

      <section aria-label="Service level and speed" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="SLA compliance"
          value={formatPct(metrics.slaCompliancePct)}
          note={measured === 0 ? `Belum ada ${copy.noun} yang selesai dalam ${METRICS_WINDOW_DAYS} hari terakhir` : `${metrics.slaMet} dari ${measured} yang selesai dalam ${METRICS_WINDOW_DAYS} hari terakhir memenuhi batas waktu`}
        />
        <StatTile label={team === "PURCHASING" ? "Quotation turnaround" : "Turnaround"} value={formatDuration(metrics.avgTurnaroundHours)} note={`Dari dibuat sampai selesai, rata-rata dari ${metrics.completedInWindow} dalam ${METRICS_WINDOW_DAYS} hari`} />
        <StatTile label="Processing time" value={formatDuration(metrics.avgProcessingHours)} note={`Turnaround dikurangi waktu antre (${formatDuration(metrics.avgQueueHours)})`} />
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

  return (
    <>
      <DashboardHeader title={copy.title} summary={copy.summary} />
      {empty ? (
        <p role="status" className="mb-6 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {copy.emptyText}
        </p>
      ) : null}

      {analytics ? (
        <>
          <section aria-label="Open projects" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Open projects" value={analytics.totals.open} href={`${PROJECTS_PATH}?show=open`} note={`dari ${analytics.totals.projects} proyek`} />
          </section>
          <ProjectMixCharts analytics={analytics} />
          <CollapsibleSection id="request-overview" title="Requests (BOQ)" note={`${metrics.open} terbuka`}>
            {requests}
          </CollapsibleSection>
        </>
      ) : (
        requests
      )}
    </>
  );
}
