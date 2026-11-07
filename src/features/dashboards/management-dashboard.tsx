import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countBySeverity, PROJECT_STALE_DAYS, SLA_COMPLIANCE_WARNING_PCT } from "@/domain/management/concerns";
import { NOTIFICATION_SEVERITIES, SEVERITY_LABELS } from "@/domain/notifications/severity";
import { formatDuration, formatPct, METRICS_WINDOW_DAYS, type MonthlyRow } from "@/domain/requests/metrics";
import { REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { CROSSCHECK_PATH, HANDOFFS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { SEVERITY_CARD_CLASS, SEVERITY_LABEL_CLASS, SEVERITY_LINK_CLASS } from "@/features/notifications/severity-style";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/server/auth/session-store";
import { getDb } from "@/lib/db";
import { getManagementDashboard, type ManagementDashboard } from "@/server/dashboards/management";
import { CollapsibleSection } from "./collapsible-section";
import { DashboardHeader } from "./dashboard-header";
import { formatDay } from "./format";
import { StaleProjects } from "./stale-projects";
import { StatTile } from "./stat-tile";

const TEAMS = {
  SOA: { title: "SOA", noun: "BOQ", base: `${REQUESTS_PATH}/boq?`, dashboard: "/dashboard/soa" },
  PURCHASING: { title: "Purchasing", noun: "RFQ & PO", base: `${REQUESTS_PATH}?types=RFQ,PO&`, dashboard: "/dashboard/purchasing" },
} as const;

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The Management view (read only): what each team is struggling with, what is stuck between teams, and the ranked list of concerns on
 * top. Every number is one the team dashboards already show, computed by the same functions, and links to the list behind it
 * (src/server/dashboards/management.ts, src/domain/management/concerns.ts; D-085).
 */
export async function ManagementDashboardView({ viewer }: { viewer: SessionUser }) {
  const data = await getManagementDashboard(getDb(), viewer);
  const counts = countBySeverity(data.concerns);

  return (
    <>
      <DashboardHeader
        title="Management dashboard"
        summary="Kesehatan operasional di semua tim: hal yang perlu perhatian di urutan teratas, lalu bottleneck dan beban kerja SOA dan Purchasing, request yang menggantung antar tim, dan project yang lama tidak diperbarui."
      />
      <Concerns data={data} counts={counts} />
      {(["SOA", "PURCHASING"] as const).map((team) => (
        <TeamSection key={team} team={team} data={data} />
      ))}
      <CollapsibleSection id="between-teams" title="Antar tim" note={`${data.awaitingHandoff.count} BOQ menunggu keputusan Sales`}>
        <section aria-label="Between teams" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="BOQ selesai belum dilanjutkan"
            value={data.awaitingHandoff.count}
            href={HANDOFFS_PATH}
            note={data.awaitingHandoff.oldestDays === null ? "Tidak ada yang menunggu" : `Yang terlama menunggu ${data.awaitingHandoff.oldestDays} hari`}
          />
          <StatTile label="Project terbuka tidak diperbarui" value={data.stale.count} note={`Lebih dari ${PROJECT_STALE_DAYS} hari tanpa perubahan, aksi, atau request`} />
          {data.financeFlagged === null ? null : <StatTile label="Project dicek Finance" value={data.financeFlagged} href={CROSSCHECK_PATH} note="Ada selisih quotation, PO, atau nilai project" />}
        </section>
        <StaleProjects projects={data.stale.top} />
      </CollapsibleSection>
    </>
  );
}

function Concerns({ data, counts }: { data: ManagementDashboard; counts: ReturnType<typeof countBySeverity> }) {
  const { concerns } = data;
  return (
    <section aria-label="Perlu perhatian" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold">Perlu perhatian</h2>
        <ul aria-label="Jumlah per tingkat" className="flex flex-wrap gap-2 text-xs">
          {[...NOTIFICATION_SEVERITIES].reverse().map((severity) => (
            <li key={severity} className={cn("rounded px-1.5 py-0.5 font-semibold tabular-nums", counts[severity] > 0 ? SEVERITY_LABEL_CLASS[severity] : "bg-muted text-muted-foreground")}>
              {SEVERITY_LABELS[severity]} {counts[severity]}
            </li>
          ))}
        </ul>
      </div>
      {concerns.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Tidak ada yang perlu perhatian saat ini: tidak ada request overdue, tanpa PIC, atau menggantung.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {concerns.map((concern) => (
            <li key={concern.key} data-severity={concern.severity}>
              <Card className={SEVERITY_CARD_CLASS[concern.severity].unread}>
                <CardContent className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <span className={cn("mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-semibold", SEVERITY_LABEL_CLASS[concern.severity])}>{SEVERITY_LABELS[concern.severity]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <span className="text-muted-foreground">{concern.area}: </span>
                      {concern.href ? (
                        <Link href={concern.href} className={cn("underline-offset-4 hover:underline", SEVERITY_LINK_CLASS[concern.severity])}>
                          {concern.title}
                        </Link>
                      ) : (
                        concern.title
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{concern.detail}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamSection({ team, data }: { team: "SOA" | "PURCHASING"; data: ManagementDashboard }) {
  const copy = TEAMS[team];
  const { metrics } = data.teams[team];
  const to = (query: string) => `${copy.base}${query}`;
  const measured = metrics.slaMet + metrics.slaLate;
  const late = data.late[team];

  return (
    <CollapsibleSection id={`team-${team.toLowerCase()}`} title={copy.title} note={`${metrics.open} ${copy.noun} terbuka · ${metrics.overdue} overdue`}>
      <section aria-label={`${copy.title} now`} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open" value={metrics.open} href={to("status=open")} note="Belum Completed atau Cancelled" />
        <StatTile label="Backlog" value={metrics.backlog} href={to("status=SUBMITTED")} note="Submitted, belum ada yang memulai" />
        <StatTile label="Overdue" value={metrics.overdue} href={to("sla=overdue")} note="Melewati batas SLA" />
        <StatTile label="Due now" value={metrics.dueNow} href={to("sla=due_soon")} note="Mendekati batas SLA" />
        <StatTile label="Tanpa PIC" value={metrics.unassigned} href={to("assignee=none&status=open")} note="Terbuka, belum diserahkan ke PIC" />
        <StatTile label="Past needed-by date" value={metrics.pastNeededBy} href={to("deadline=past")} note="Tanggal yang diminta sudah lewat" />
        <StatTile
          label="SLA compliance"
          value={formatPct(metrics.slaCompliancePct)}
          note={measured === 0 ? `Belum ada yang selesai dalam ${METRICS_WINDOW_DAYS} hari terakhir` : `${metrics.slaMet} dari ${measured} selesai tepat waktu (target ${SLA_COMPLIANCE_WARNING_PCT}%)`}
        />
        <StatTile label="Turnaround" value={formatDuration(metrics.avgTurnaroundHours)} note={`Antre ${formatDuration(metrics.avgQueueHours)} · diproses ${formatDuration(metrics.avgProcessingHours)}`} />
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Bottleneck per status</h3>
            </CardTitle>
            <CardDescription>Lama request terbuka di status saat ini; yang terlama bisa diklik.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.bottlenecks.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">Tidak ada request terbuka.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Request</TableHead>
                    <TableHead className="text-right">Rata-rata</TableHead>
                    <TableHead>Terlama</TableHead>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Beban per PIC</h3>
            </CardTitle>
            <CardDescription>Request terbuka per PIC (PIC bukan akun login).</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.workload.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">Tidak ada request terbuka.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PIC</TableHead>
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Enam bulan terakhir</h3>
            </CardTitle>
            <CardDescription>Request masuk, selesai, dan kepatuhan SLA per bulan.</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyTable rows={data.monthly[team]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Keterlambatan dan alasannya</h3>
            </CardTitle>
            <CardDescription>
              Yang melewati batas SLA (terbuka, atau selesai terlambat dalam {METRICS_WINDOW_DAYS} hari), terlama dulu.{" "}
              <Link href={copy.dashboard} className="underline underline-offset-4">
                Dashboard {copy.title}
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {late.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">Tidak ada keterlambatan.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Request</TableHead>
                    <TableHead>PIC</TableHead>
                    <TableHead className="text-right">Hari</TableHead>
                    <TableHead>Alasan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {late.map((row) => (
                    <TableRow key={row.code}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/request/${row.code}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                          {row.code}
                        </Link>
                        <span className="block text-[11px] text-muted-foreground">{formatDay(row.requestIn)}</span>
                      </TableCell>
                      <TableCell>{row.pic ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-medium text-destructive">{row.overdueDays}</span>
                        <span className="block text-[11px] text-muted-foreground">{row.completed ? "selesai terlambat" : "masih terbuka"}</span>
                      </TableCell>
                      <TableCell className="max-w-56 whitespace-normal">
                        {row.note ? <span className="line-clamp-3 text-sm">{row.note}</span> : <span className="text-muted-foreground">{row.completed ? "Tanpa catatan" : "Belum ada"}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </CollapsibleSection>
  );
}

function MonthlyTable({ rows }: { rows: MonthlyRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bulan</TableHead>
          <TableHead className="text-right">Masuk</TableHead>
          <TableHead className="text-right">Selesai</TableHead>
          <TableHead className="text-right">SLA</TableHead>
          <TableHead className="text-right">Turnaround</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.month}>
            <TableCell className="whitespace-nowrap">{monthLabel(row.month)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.received}</TableCell>
            <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(row.slaCompliancePct)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatDuration(row.avgTurnaroundHours)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
