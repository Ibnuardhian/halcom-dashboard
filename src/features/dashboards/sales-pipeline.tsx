import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REQUEST_TYPES, typeSlug } from "@/domain/requests/types";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { formatAmount, formatPercent } from "@/features/projects/format";
import { formatDateOnly } from "@/features/requests/format";
import { RequestTable } from "@/features/requests/request-table";
import { ProgressBadge, TrackStatusBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { getPipelineAnalytics, listPipelineProjects } from "@/server/projects/analytics";
import { getOwnTargets, getTargetSummary } from "@/server/targets/service";
import { getWorkStats, listRequests } from "@/server/requests/queries";
import { DashboardHeader } from "./dashboard-header";
import { PipelineCharts, PipelineTiles } from "./pipeline-charts";
import { TargetTracking } from "./target-tracking";
import { StatTile } from "./stat-tile";

const NEEDS_MARGIN_SHOWN = 12;

/**
 * The one place a salesperson works from: their pipeline (value, margin, stage), the projects that still need a
 * target margin, and every BOQ, RFQ and PO request they raised, with a button for each kind of new request.
 */
export async function SalesPipeline({ viewer, view, year }: { viewer: SessionUser; view: "table" | "charts" | "tracking"; year: number }) {
  const db = getDb();
  // Sales see their own pipeline; an admin opening this dashboard sees everyone's.
  const ownerId = viewer.role === "SALES" ? viewer.id : undefined;
  const [analytics, projects, requests, stats, targetSummary] = await Promise.all([
    getPipelineAnalytics(db, viewer, { salesOwnerId: ownerId }),
    listPipelineProjects(db, viewer, ownerId),
    listRequests(db, viewer, { requesterId: ownerId, limit: 10 }),
    getWorkStats(db, viewer),
    view === "tracking" ? getTargetSummary(db, viewer, { year, salesOwnerId: ownerId }) : Promise.resolve(null),
  ]);
  const ownTargets = view === "tracking" && ownerId ? await getOwnTargets(db, viewer, year) : null;
  const scope = ownerId ? "mine" : "all";
  const needMargin = projects.filter((p) => p.isOpen && p.estimatedValue !== null && p.targetMargin === null);
  const waiting = requests.filter((r) => r.status === "WAITING_FOR_SALES").length;

  return (
    <>
      <DashboardHeader title="Sales Pipeline" summary="Your projects, target margins and BOQ, RFQ and PO requests in one place." />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`${PROJECTS_PATH}/new`} className={buttonVariants()}>
          New project &amp; request
        </Link>
        <span className="text-xs text-muted-foreground">One form: project details, then choose BOQ, RFQ or PO.</span>
      </div>

      <section aria-label="Request counts" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {REQUEST_TYPES.map((type) => (
          <StatTile key={type} label={`Open ${type}`} value={stats.openByType[type]} href={`${REQUESTS_PATH}/${typeSlug(type)}?status=open`} note="All requests, still open" />
        ))}
        <StatTile label="Waiting for you" value={waiting} href={`${REQUESTS_PATH}?status=WAITING_FOR_SALES`} note="In your latest requests" />
      </section>

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

      <PipelineTiles analytics={analytics} scope={scope} />

      <nav aria-label="View" className="mb-4 inline-flex rounded-lg border p-0.5">
        {(["table", "charts", "tracking"] as const).map((option) => (
          <Link
            key={option}
            href={`/dashboard/sales?view=${option}`}
            aria-current={view === option ? "page" : undefined}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {option === "table" ? "Table" : option === "charts" ? "Charts" : "Tracking"}
          </Link>
        ))}
      </nav>

      {view === "charts" ? <PipelineCharts analytics={analytics} scope={scope} /> : null}
      {view === "tracking" && targetSummary ? <TargetTracking summary={targetSummary} own={ownTargets} years={[year - 1, year, year + 1]} basePath="/dashboard/sales" /> : null}

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
