import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UPCOMING_DAYS } from "@/domain/requests/metrics";
import { ACTIVE_STATUSES, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { REQUEST_TYPES, typeSlug } from "@/domain/requests/types";
import { getRequesterSummary } from "@/server/dashboards/metrics";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { formatAmount, formatPercent } from "@/features/projects/format";
import { formatDateOnly } from "@/features/requests/format";
import { RequestTable } from "@/features/requests/request-table";
import { ProgressBadge, TrackStatusBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { getPipelineAnalytics, listPipelineProjects } from "@/server/projects/analytics";
import { getWorkStats, listPendingDecisions, listRequests } from "@/server/requests/queries";
import { DashboardHeader } from "./dashboard-header";
import { PipelineCharts, PipelineTiles } from "./pipeline-charts";
import { StatTile } from "./stat-tile";

const NEEDS_MARGIN_SHOWN = 12;

/**
 * The one place a salesperson works from. Every number is the signed-in salesperson's own (an administrator sees all). Sales
 * performance comes first (pipeline value, weighted value, margin, won), then the BOQ, RFQ and PO requests on their projects.
 * Targets have their own page (Sales Targets) and are not repeated here.
 */
export async function SalesPipeline({ viewer, view }: { viewer: SessionUser; view: "table" | "charts" }) {
  const db = getDb();
  // Sales see their own pipeline; an admin opening this dashboard sees everyone's.
  const ownerId = viewer.role === "SALES" ? viewer.id : undefined;
  const [analytics, projects, requests, stats, decisions, summary] = await Promise.all([
    getPipelineAnalytics(db, viewer, { salesOwnerId: ownerId }),
    listPipelineProjects(db, viewer, ownerId),
    listRequests(db, viewer, { projectOwnerId: ownerId, limit: 10 }),
    getWorkStats(db, viewer, ownerId),
    listPendingDecisions(db, viewer, ownerId),
    getRequesterSummary(db, viewer, ownerId),
  ]);
  const scope = ownerId ? "mine" : "all";
  const needMargin = projects.filter((p) => p.isOpen && p.estimatedValue !== null && p.estimatedGrossProfit === null);
  // "mine" keeps a salesperson's drill-down to the requests on their own projects; an admin sees everyone's.
  const mineQuery = ownerId ? "&mine=1" : "";

  return (
    <>
      <DashboardHeader title="Sales Pipeline" summary="Your projects, target margins and BOQ, RFQ and PO requests in one place." />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`${PROJECTS_PATH}/new`} className={buttonVariants()}>
          New project &amp; request
        </Link>
        <span className="text-xs text-muted-foreground">One form: project details, then choose BOQ, RFQ or PO.</span>
      </div>

      <PipelineTiles analytics={analytics} scope={scope} />

      <section aria-label="Request counts" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {REQUEST_TYPES.map((type) => (
          <StatTile key={type} label={`Open ${type}`} value={stats.openByType[type]} href={`${REQUESTS_PATH}/${typeSlug(type)}?status=open${mineQuery}`} note={ownerId ? "On your projects, still open" : "All requests, still open"} />
        ))}
      </section>

      <section aria-label="Your requests by status" className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{ownerId ? "Requests on your projects, by status" : "Requests on all projects, by status"}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ACTIVE_STATUSES.map((status) => (
            <StatTile key={status} label={REQUEST_STATUS_LABELS[status]} value={summary.byStatus[status]} href={`${REQUESTS_PATH}?status=${status}${mineQuery}`} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile label="Overdue requests" value={summary.overdue} href={`${REQUESTS_PATH}?sla=overdue${mineQuery}`} note="Past the SLA deadline of the team they went to" />
          <StatTile label="Past needed-by date" value={summary.pastNeededBy} href={`${REQUESTS_PATH}?deadline=past${mineQuery}`} note="Open, and the date you asked for has passed" />
          <StatTile label={`Needed in ${UPCOMING_DAYS} days`} value={summary.upcomingDeadlines} href={`${REQUESTS_PATH}?deadline=soon${mineQuery}`} note="Open, needed by today or within the week" />
        </div>
      </section>

      {decisions.length > 0 ? (
        <Card className="mb-6 border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Decide the next step</h2>
            </CardTitle>
            <CardDescription>
              {decisions.length} completed BOQ or RFQ {decisions.length === 1 ? "is" : "are"} waiting for you to decide: continue to the next step (BOQ, then RFQ, then PO), or not.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {decisions.slice(0, NEEDS_MARGIN_SHOWN).map((d) => (
                <li key={d.code}>
                  <Link href={`/request/${d.code}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {d.code} · {d.endUserCompany} → {d.type === "BOQ" ? "RFQ?" : "PO?"}
                  </Link>
                </li>
              ))}
              {decisions.length > NEEDS_MARGIN_SHOWN ? <li className="self-center text-xs text-muted-foreground">and {decisions.length - NEEDS_MARGIN_SHOWN} more</li> : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {needMargin.length > 0 ? (
        <Card className="mb-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Set a target margin</h2>
            </CardTitle>
            <CardDescription>
              {needMargin.length} of your open project{needMargin.length === 1 ? " has" : "s have"} a value but no target margin yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {needMargin.slice(0, NEEDS_MARGIN_SHOWN).map((p) => (
                <li key={p.code}>
                  <Link href={`${PROJECTS_PATH}/${p.code}#commercial`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {p.code} · {p.accountName}
                  </Link>
                </li>
              ))}
              {needMargin.length > NEEDS_MARGIN_SHOWN ? (
                <li className="self-center text-xs text-muted-foreground">and {needMargin.length - NEEDS_MARGIN_SHOWN} more in the table below</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <nav aria-label="View" className="mb-4 inline-flex rounded-lg border p-0.5">
        {(["table", "charts"] as const).map((option) => (
          <Link
            key={option}
            href={`/dashboard/sales?view=${option}`}
            aria-current={view === option ? "page" : undefined}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {option === "table" ? "Table" : "Charts"}
          </Link>
        ))}
      </nav>

      {view === "charts" ? <PipelineCharts analytics={analytics} scope={scope} /> : null}

      {view === "table" ? (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>{ownerId ? "My projects" : "Projects"}</h2>
          </CardTitle>
          <CardDescription>Open projects first. Open a project to change its progress, status, value or target margin.</CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              You have no project yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Last Updated</TableHead>
                  <TableHead className="hidden lg:table-cell">Quote Released</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Project Title</TableHead>
                  <TableHead className="text-right">Estimated PO Value</TableHead>
                  <TableHead className="text-right">Estimated Gross Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.code} className={p.isOpen ? undefined : "text-muted-foreground"}>
                    <TableCell>
                      <ProgressBadge progress={p.progress} />
                    </TableCell>
                    <TableCell>
                      <TrackStatusBadge status={p.trackStatus} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">{formatDateOnly(p.lastUpdated)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateOnly(p.quoteReleasedAt)}</TableCell>
                    <TableCell className="max-w-44 truncate">{p.accountName}</TableCell>
                    <TableCell className="max-w-64">
                      <Link href={`${PROJECTS_PATH}/${p.code}`} className="block truncate text-primary underline-offset-4 hover:underline">
                        {p.projectTitle}
                      </Link>
                      <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(p.estimatedValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.estimatedGrossProfit !== null ? (
                        <>
                          {formatAmount(p.estimatedGrossProfit)}
                          <span className="block text-[11px] text-muted-foreground">{formatPercent(p.targetMargin)}</span>
                        </>
                      ) : p.estimatedValue !== null && p.isOpen ? (
                        <Link href={`${PROJECTS_PATH}/${p.code}#commercial`} className="text-primary underline-offset-4 hover:underline">
                          Set margin
                        </Link>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      ) : null}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>My requests</h2>
          </CardTitle>
          <CardDescription>
            BOQ, RFQ and PO requests you submitted, newest first.{" "}
            <Link href={REQUESTS_PATH} className="underline underline-offset-4">
              View all
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestTable rows={requests} emptyText="You have not submitted any request yet." />
        </CardContent>
      </Card>
    </>
  );
}
