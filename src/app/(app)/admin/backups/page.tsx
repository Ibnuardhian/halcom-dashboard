import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { BACKUPS_PATH } from "@/features/navigation/links";
import { BackupForm } from "@/features/system/backup-form";
import { formatBytes } from "@/features/system/format";
import { requirePermission } from "@/server/auth/current-user";
import { isAutomaticBackup, listBackups } from "@/server/system/backup";

export default function BackupsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Backups />
    </Suspense>
  );
}

async function Backups() {
  await requirePermission("system.backup");
  const state = await listBackups();

  return (
    <>
      <DashboardHeader
        title="Backups"
        summary="Cadangan PostgreSQL di folder host. Aplikasi hanya menambah berkas baru."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Create a backup</h2>
            </CardTitle>
            <CardDescription>
              A full custom-format dump (<code>pg_dump</code>) of the application database. The file contains all business data, so keep the
              folder private and copy it off the machine as well: download it from the list, and every download is written to the audit log.
              The server also makes one backup a day by itself (<code>halcom-auto-…</code>) and keeps them for 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <BackupForm />
            <p className="text-xs text-muted-foreground">
              Restoring is a deliberate manual step that needs approval: see README, Backups. There is no restore button on purpose.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Existing backups</h2>
            </CardTitle>
            <CardDescription>
              Folder cadangan: <code>{state.dir}</code>. Aplikasi tidak menghapus berkas; berkas otomatis dihapus oleh server setelah 30 hari, berkas buatan tangan tidak pernah.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!state.ok ? (
              <p role="alert" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
                {state.error}
              </p>
            ) : state.files.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                No backups yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Written</TableHead>
                    <TableHead>Made by</TableHead>
                    <TableHead className="text-right">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.files.map((file) => (
                    <TableRow key={file.name}>
                      <TableCell className="font-mono text-xs">{file.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(file.sizeBytes)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(file.modifiedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{isAutomaticBackup(file.name) ? "Daily job" : "Superadmin"}</TableCell>
                      <TableCell className="text-right">
                        {/* A plain link, not next/link: a prefetch would call the route and write a download to the audit log. */}
                        <a className="text-primary underline-offset-4 hover:underline" href={`${BACKUPS_PATH}/download/${file.name}`} download>
                          Download
                        </a>
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
