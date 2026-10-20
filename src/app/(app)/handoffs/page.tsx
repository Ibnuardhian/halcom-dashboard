import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatUtc } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { StatusBadge, TypeBadge } from "@/features/requests/status-badges";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listPendingDecisions, listRecentHandovers } from "@/server/requests/queries";

export default function HandoffsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Handoffs />
    </Suspense>
  );
}

async function Handoffs() {
  const viewer = await requirePermission("handoffs.view");
  const [pending, handovers] = await Promise.all([listPendingDecisions(getDb(), viewer), listRecentHandovers(getDb(), viewer)]);
  // SOA hands over BOQs; a completed RFQ waits for Sales or an admin to raise the PO, so it is not SOA's to hand over.
  const boqs = pending.filter((row) => row.type === "BOQ");

  return (
    <>
      <DashboardHeader
        title="Purchasing Handoff"
        summary="Completed BOQs and where they went. A completed BOQ never authorises a purchase by itself: someone decides whether it continues to Purchasing as an RFQ."
      />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Ready for handoff</h2>
          </CardTitle>
          <CardDescription>Completed BOQs that were neither continued nor marked “do not continue”, oldest first. Open one to decide.</CardDescription>
        </CardHeader>
        <CardContent>
          {boqs.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No completed BOQ is waiting for a decision.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>BOQ</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="hidden md:table-cell">Summary</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell className="font-mono text-xs font-medium whitespace-nowrap">
                      <Link href={`/request/${row.code}`} className="text-primary underline-offset-4 hover:underline">
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      <Link href={`${PROJECTS_PATH}/${row.projectCode}`} className="hover:underline">
                        {row.endUserCompany} – {row.projectName}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden max-w-64 truncate md:table-cell">{row.title}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.completedAt ? formatUtc(row.completedAt) : "–"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Recently handed over</h2>
          </CardTitle>
          <CardDescription>The latest requests created by continuing a completed BOQ or RFQ, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {handovers.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing has been handed over yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                  <TableHead className="hidden lg:table-cell">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {handovers.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/request/${row.code}`} className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline">
                        {row.code}
                      </Link>{" "}
                      <TypeBadge type={row.type} />
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      <Link href={`/request/${row.sourceCode}`} className="hover:underline">
                        {row.sourceCode}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {row.endUserCompany} – {row.projectName}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{row.handedBy}</TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatUtc(row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
