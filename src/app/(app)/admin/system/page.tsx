import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { formatBytes, formatCount, formatDuration, formatPercent } from "@/features/system/format";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getSystemSnapshot } from "@/server/system/snapshot";

export default function SystemPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <System />
    </Suspense>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

async function System() {
  const viewer = await requirePermission("system.monitor");
  const snapshot = await getSystemSnapshot(getDb(), viewer);
  const { app, database } = snapshot;

  return (
    <>
      <DashboardHeader
        title="System"
        summary={`Application and database health at ${formatDay(snapshot.generatedAt)}. Reload the page to refresh; history is not recorded yet.`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Application</h2>
            </CardTitle>
            <CardDescription>
              Environment {app.environment}, Node.js {app.nodeVersion}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Metric label="Uptime" value={formatDuration(app.uptimeSeconds)} />
              <Metric label="Memory (RSS)" value={formatBytes(app.memory.rssBytes)} />
              <Metric
                label="Heap used / total"
                value={`${formatBytes(app.memory.heapUsedBytes)} / ${formatBytes(app.memory.heapTotalBytes)}`}
              />
              <Metric label="Event loop utilization" value={formatPercent(app.eventLoopUtilization)} />
              <Metric label="VM load average (1 min)" value={app.vm.loadAverage1m.toFixed(2)} />
              <Metric
                label="VM memory free / total"
                value={`${formatBytes(app.vm.freeMemoryBytes)} / ${formatBytes(app.vm.totalMemoryBytes)}`}
              />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Database</h2>
            </CardTitle>
            <CardDescription>
              {database.version}, database {database.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Metric label="Query round trip" value={`${database.latencyMs.toFixed(1)} ms`} />
              <Metric label="Size" value={formatBytes(database.sizeBytes)} />
              <Metric label="Cache hit ratio" value={formatPercent(database.cacheHitRatio)} />
              <Metric label="Commits / rollbacks" value={`${formatCount(database.commits)} / ${formatCount(database.rollbacks)}`} />
              <Metric label="Deadlocks" value={formatCount(database.deadlocks)} />
              <Metric label="Max connections" value={formatCount(database.maxConnections)} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Other database connections</h2>
            </CardTitle>
            <CardDescription>Sessions on this database, not counting this page&apos;s own connection.</CardDescription>
          </CardHeader>
          <CardContent>
            {database.connections.length === 0 ? (
              <p className="text-sm text-muted-foreground">None right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Oldest statement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {database.connections.map((connection) => (
                    <TableRow key={connection.state}>
                      <TableCell>{connection.state}</TableCell>
                      <TableCell className="text-right">{connection.count}</TableCell>
                      <TableCell className="text-right">
                        {connection.oldestSeconds === null ? "–" : formatDuration(connection.oldestSeconds)}
                      </TableCell>
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
              <h2>Largest tables</h2>
            </CardTitle>
            <CardDescription>Including indexes. Row counts are PostgreSQL estimates.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Rows (est.)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {database.largestTables.map((table) => (
                  <TableRow key={table.name}>
                    <TableCell>{table.name}</TableCell>
                    <TableCell className="text-right">{formatBytes(table.sizeBytes)}</TableCell>
                    <TableCell className="text-right">{formatCount(table.estimatedRows)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
