import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CROSSCHECK_FLAGS, CROSSCHECK_FLAG_LABELS, isCrosscheckFlag } from "@/domain/finance/crosscheck";
import { SOURCE_LABELS } from "@/domain/projects/source";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { CROSSCHECK_PATH, PROJECTS_PATH } from "@/features/navigation/links";
import { formatAmount } from "@/features/projects/format";
import { formatDateOnly } from "@/features/requests/format";
import { ProgressBadge, StatusBadge, TypeBadge } from "@/features/requests/status-badges";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { CROSSCHECK_LIMIT, listCrosscheck } from "@/server/finance/crosscheck";

export default function CrosscheckPage({ searchParams }: PageProps<"/finance/crosscheck">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Crosscheck searchParams={searchParams} />
    </Suspense>
  );
}

async function Crosscheck({ searchParams }: Pick<PageProps<"/finance/crosscheck">, "searchParams">) {
  const viewer = await requirePermission("finance.crosscheck.view");
  const query = await searchParams;
  const flagParam = typeof query.flag === "string" ? query.flag : "";
  const flag = isCrosscheckFlag(flagParam) ? flagParam : undefined;
  const search = (typeof query.q === "string" ? query.q : "").slice(0, 100);
  const { rows, flagCounts, total } = await listCrosscheck(getDb(), viewer, { flag, search });
  const flagged = Object.values(flagCounts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <DashboardHeader
        title="Financial Crosscheck"
        summary="Setiap proyek beserta nilainya, referensi quotation (RFQ) dan PO-nya, serta bagian yang tidak sesuai dengan progress-nya. Hanya untuk dibaca: tidak ada perubahan pada proyek atau request dari halaman ini."
      />
      <nav aria-label="Filter by flag" className="mb-3 flex flex-wrap gap-1.5">
        <Link href={CROSSCHECK_PATH} aria-current={!flag ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted", !flag && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}>
          All projects
        </Link>
        {CROSSCHECK_FLAGS.map((option) => (
          <Link
            key={option}
            href={`${CROSSCHECK_PATH}?flag=${option}`}
            aria-current={flag === option ? "true" : undefined}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium hover:bg-muted", flag === option && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
          >
            {CROSSCHECK_FLAG_LABELS[option]} ({flagCounts[option]})
          </Link>
        ))}
      </nav>
      <form role="search" className="mb-3 flex gap-2">
        {flag ? <input type="hidden" name="flag" value={flag} /> : null}
        <Input name="q" defaultValue={search} placeholder="Search project, end user, source or request ID" aria-label="Search the crosscheck" maxLength={100} className="max-w-md" />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Search
        </button>
        <a href={`/export/crosscheck${flag ? `?flag=${flag}` : ""}`} className={buttonVariants({ variant: "outline" })}>
          Download CSV
        </a>
      </form>
      <p role="status" className="mb-4 text-sm text-muted-foreground">
        {total} project{total === 1 ? "" : "s"}
        {flag ? `: ${CROSSCHECK_FLAG_LABELS[flag]}` : ""}
        {search ? ` matching “${search}”` : ""}. {flagged} flag{flagged === 1 ? "" : "s"} across all projects.
        {total > CROSSCHECK_LIMIT ? ` Showing the first ${CROSSCHECK_LIMIT}.` : ""} Supporting documents are not stored in the application yet; the request IDs are the references.
      </p>
      {rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {flag || search ? "Tidak ada project yang cocok." : "Belum ada project."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="hidden md:table-cell">Source</TableHead>
              <TableHead className="text-right">Estimated</TableHead>
              <TableHead className="text-right">Final</TableHead>
              <TableHead>Quotation / PO references</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="hidden xl:table-cell">Audit history</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.code}>
                <TableCell className="max-w-56">
                  <Link href={`${PROJECTS_PATH}/${row.code}`} className="block truncate text-primary underline-offset-4 hover:underline">
                    {row.endUserCompany} – {row.name}
                  </Link>
                  <span className="font-mono text-[11px] text-muted-foreground">{row.code}</span>
                </TableCell>
                <TableCell>
                  <ProgressBadge progress={row.progress} />
                  {row.wonDate ? <span className="mt-1 block text-[11px] text-muted-foreground">won {formatDateOnly(row.wonDate)}</span> : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {SOURCE_LABELS[row.sourceType]}
                  <span className="block max-w-36 truncate text-[11px] text-muted-foreground">{row.salesSide}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount(row.estimatedValue)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount(row.finalValue)}</TableCell>
                <TableCell>
                  {row.references.length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {row.references.map((reference) => (
                        <li key={reference.code} className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/request/${reference.code}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                            {reference.code}
                          </Link>
                          <TypeBadge type={reference.type} />
                          <StatusBadge status={reference.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell>
                  {row.flags.length === 0 ? (
                    <span className="text-muted-foreground">–</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {row.flags.map((item) => (
                        <li key={item}>
                          <Badge variant="secondary" className="bg-warning text-warning-foreground whitespace-normal">
                            {CROSSCHECK_FLAG_LABELS[item]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                  {row.auditEvents} event{row.auditEvents === 1 ? "" : "s"}
                  {row.lastAuditAt ? <span className="block">last {formatDay(row.lastAuditAt)}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
