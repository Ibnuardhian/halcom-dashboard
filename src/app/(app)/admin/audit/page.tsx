import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { AUDIT_PATH } from "@/features/navigation/links";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listAuditEntityTypes, listAuditEvents } from "@/server/users/queries";

/** A record's id is shortened; anything else (the address a refused sign-in used) is shown whole. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

async function Audit({ searchParams }: Pick<PageProps<"/admin/audit">, "searchParams">) {
  const viewer = await requirePermission("audit.view");
  const db = getDb();
  const types = await listAuditEntityTypes(db, viewer);
  const { type } = await searchParams;
  const entityType = typeof type === "string" && types.includes(type) ? type : undefined;
  const events = await listAuditEvents(db, viewer, { entityType });

  return (
    <>
      <DashboardHeader
        title="Audit log"
        summary="Catatan perubahan administratif dan alur kerja yang hanya bertambah (tidak bisa diubah atau dihapus). 200 kejadian terbaru ditampilkan."
      />
      <nav aria-label="Filter by entity" className="mb-4 flex flex-wrap gap-1.5">
        {[{ label: "All", value: undefined }, ...types.map((t) => ({ label: t, value: t }))].map((chip) => (
          <Link
            key={chip.label}
            href={chip.value ? `${AUDIT_PATH}?type=${encodeURIComponent(chip.value)}` : AUDIT_PATH}
            aria-current={chip.value === entityType ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors hover:bg-muted",
              chip.value === entityType && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {chip.label}
          </Link>
        ))}
      </nav>
      {events.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No audit events.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Entity</TableHead>
              <TableHead className="hidden lg:table-cell">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap">{formatDay(event.createdAt)}</TableCell>
                <TableCell>{event.actorName ?? "System"}</TableCell>
                <TableCell className="font-mono text-xs">{event.action}</TableCell>
                <TableCell className="hidden font-mono text-xs md:table-cell">
                  {event.entityType} {UUID.test(event.entityId) ? event.entityId.slice(0, 8) : event.entityId}
                </TableCell>
                <TableCell className="hidden max-w-md truncate font-mono text-xs text-muted-foreground lg:table-cell">{event.summary}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
