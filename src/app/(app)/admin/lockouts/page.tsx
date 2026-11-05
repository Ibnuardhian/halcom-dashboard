import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_FAILURES, WINDOW_MINUTES } from "@/domain/access/login-throttle";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { UnlockButton } from "@/features/lockouts/unlock-button";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listLockouts } from "@/server/auth/lockouts";

export default function LockoutsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Lockouts />
    </Suspense>
  );
}

const TIME = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

async function Lockouts() {
  const viewer = await requirePermission("logins.manage");
  const rows = await listLockouts(getDb(), viewer);

  return (
    <>
      <DashboardHeader
        title="Locked accounts"
        summary={`Akun dan alamat yang terkunci karena ${MAX_FAILURES.email} kali salah kata sandi dalam ${WINDOW_MINUTES} menit (alamat jaringan: ${MAX_FAILURES.ip} kali). Kunci habis sendiri; di sini Anda bisa membukanya lebih awal.`}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Currently locked</h2>
          </CardTitle>
          <CardDescription>Sisa waktu dihitung saat halaman dibuka; muat ulang untuk memperbaruinya. Setiap pembukaan masuk ke audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p role="status" className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Tidak ada akun atau alamat yang terkunci sekarang.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account or address</TableHead>
                    <TableHead className="text-right">Failed attempts</TableHead>
                    <TableHead>Locked until</TableHead>
                    <TableHead className="text-right">Cooldown left</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.scope === "email" ? (
                          <>
                            <span className="font-medium">{row.name ?? "Bukan akun terdaftar"}</span>
                            <span className="block text-xs text-muted-foreground">{row.label}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">Alamat jaringan</span>
                            <span className="block font-mono text-xs text-muted-foreground">{row.label}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.failures}</TableCell>
                      <TableCell className="whitespace-nowrap">{TIME.format(row.lockedUntil)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.minutesLeft} menit</TableCell>
                      <TableCell className="text-right">
                        <UnlockButton id={row.id} label={row.name ?? row.label} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
