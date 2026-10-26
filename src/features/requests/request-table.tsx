import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay } from "@/features/dashboards/format";
import type { RequestRow, RequestSort } from "@/server/requests/queries";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";
import { StatusBadge, TypeBadge } from "./status-badges";

/** Sortable headers: `href` builds the link for a column, `sort` and `dir` say how the rows are ordered now. */
export type TableSorting = { sort: RequestSort; dir: "asc" | "desc"; href: (sort: RequestSort) => string };

function SortableHead({ label, column, sorting, className }: { label: string; column: RequestSort; sorting?: TableSorting; className?: string }) {
  if (!sorting) return <TableHead className={className}>{label}</TableHead>;
  const active = sorting.sort === column;
  return (
    <TableHead className={className} aria-sort={active ? (sorting.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={sorting.href(column)} className="inline-flex items-center gap-1 hover:underline">
        {label}
        {active ? <span aria-hidden>{sorting.dir === "asc" ? "↑" : "↓"}</span> : null}
      </Link>
    </TableHead>
  );
}

/**
 * Request list. Less important columns drop out on narrow screens; the table scrolls sideways if it still does not fit.
 * `detailed` adds who asked, the Principal and Solution and the item details, for the full request lists.
 */
export function RequestTable({
  rows,
  emptyText = "Belum ada request.",
  detailed = false,
  sorting,
}: {
  rows: RequestRow[];
  emptyText?: string;
  detailed?: boolean;
  sorting?: TableSorting;
}) {
  if (rows.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <Table topScroll>
      <TableHeader>
        <TableRow>
          <SortableHead label="Request ID" column="code" sorting={sorting} />
          <TableHead>Type</TableHead>
          <SortableHead label="Project" column="project" sorting={sorting} />
          {detailed ? <SortableHead label="Requester" column="requester" sorting={sorting} className="hidden md:table-cell" /> : null}
          {detailed ? <TableHead className="hidden lg:table-cell">Principal / Solution</TableHead> : null}
          <TableHead className="hidden md:table-cell">{detailed ? "Item details" : "Summary"}</TableHead>
          <SortableHead label="Status" column="status" sorting={sorting} />
          <SortableHead label="SLA" column="sla" sorting={sorting} className="hidden sm:table-cell" />
          <TableHead className="hidden lg:table-cell">{detailed ? "PIC" : "Owner"}</TableHead>
          <SortableHead label="Needed by" column="needed" sorting={sorting} className="hidden lg:table-cell" />
          <SortableHead label="Created" column="created" sorting={sorting} className="hidden xl:table-cell" />
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
              {row.phase ? <span className="mt-1 block text-[11px] text-muted-foreground">{row.phaseLabel}</span> : null}
            </TableCell>
            <TableCell className="max-w-56">
              <Link href={`/projects/${row.projectCode}`} className="block truncate hover:underline">
                {row.endUserCompany} – {row.projectName}
              </Link>
            </TableCell>
            {detailed ? <TableCell className="hidden md:table-cell">{row.requesterName}</TableCell> : null}
            {detailed ? (
              <TableCell className="hidden max-w-48 lg:table-cell">
                {row.principalName || row.solutionName ? (
                  <>
                    <span className="block truncate">{row.principalName ?? "–"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.solutionName ?? "–"}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </TableCell>
            ) : null}
            <TableCell className="hidden max-w-64 md:table-cell">
              <span className="block truncate">{row.title}</span>
              {detailed && row.description ? <span className="block truncate text-xs text-muted-foreground">{row.description}</span> : null}
            </TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <SlaBadge sla={row.sla} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{row.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
            <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDateOnly(row.requiredBy)}</TableCell>
            <TableCell className="hidden whitespace-nowrap xl:table-cell">{formatDay(row.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
