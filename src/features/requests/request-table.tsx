import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUtc } from "@/features/dashboards/format";
import type { RequestRow } from "@/server/requests/queries";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";
import { StatusBadge, TypeBadge } from "./status-badges";

/** Request list. Less important columns drop out on narrow screens; the table scrolls sideways if it still does not fit. */
export function RequestTable({ rows, emptyText = "No requests yet." }: { rows: RequestRow[]; emptyText?: string }) {
  if (rows.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Request ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Project</TableHead>
          <TableHead className="hidden md:table-cell">Summary</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">SLA</TableHead>
          <TableHead className="hidden lg:table-cell">Owner</TableHead>
          <TableHead className="hidden lg:table-cell">Needed by</TableHead>
          <TableHead className="hidden xl:table-cell">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs font-medium whitespace-nowrap">
              <Link href={`/request/${row.code}`} className="text-primary underline-offset-4 hover:underline">
                {row.code}
              </Link>
            </TableCell>
            <TableCell>
              <TypeBadge type={row.type} />
              {row.phase ? <span className="mt-1 block text-[11px] text-muted-foreground">{SOA_PHASE_LABELS[row.phase]}</span> : null}
            </TableCell>
            <TableCell className="max-w-56">
              <Link href={`/projects/${row.projectCode}`} className="block truncate hover:underline">
                {row.endUserCompany} – {row.projectName}
              </Link>
            </TableCell>
            <TableCell className="hidden max-w-64 truncate md:table-cell">{row.title}</TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <SlaBadge sla={row.sla} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{row.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
            <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateOnly(row.requiredBy)}</TableCell>
            <TableCell className="hidden whitespace-nowrap xl:table-cell">{formatUtc(row.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
