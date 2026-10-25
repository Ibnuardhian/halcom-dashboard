import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { BackupForm } from "@/features/system/backup-form";
import { formatBytes } from "@/features/system/format";
import { requirePermission } from "@/server/auth/current-user";
import { backupsSupported, listBackups } from "@/server/system/backup";

export default function BackupsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Backups />
    </Suspense>
  );
}

async function Backups() {
  await requirePermission("system.backup");
  // On a serverless platform there is no pg_dump and no disk that outlives the request; the database provider backs up instead.
  const supported = backupsSupported();
  const state = await listBackups();

  return (
    <>
      <DashboardHeader
        title="Backups"
        summary="Hasil dump PostgreSQL yang disimpan ke folder di mesin host. Aplikasi hanya menambahkan berkas baru; tidak pernah menghapus atau memulihkan berkas yang ada."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Create a backup</h2>
            </CardTitle>
            <CardDescription>
              A full custom-format dump (<code>pg_dump</code>) of the application database. The file contains all business data, so keep the
              folder private and copy it off the machine as well.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {supported ? (
              <BackupForm />
            ) : (
              <p role="status" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
                This deployment cannot write backups: it runs without <code>pg_dump</code> and without a disk that outlives a request. The database
                provider keeps the backups instead (with Neon: point-in-time restore and branches). See docs/deployment/VERCEL.md.
              </p>
            )}
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
              Folder in the container: <code>{state.dir}</code> (the host folder is set by BACKUP_HOST_DIR). No retention is applied yet.
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.files.map((file) => (
                    <TableRow key={file.name}>
                      <TableCell className="font-mono text-xs">{file.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(file.sizeBytes)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(file.modifiedAt)}</TableCell>
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
