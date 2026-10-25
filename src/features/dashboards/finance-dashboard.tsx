import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CROSSCHECK_FLAGS, CROSSCHECK_FLAG_LABELS } from "@/domain/finance/crosscheck";
import { CROSSCHECK_PATH, PROJECTS_PATH } from "@/features/navigation/links";
import { formatAmount, formatCompact } from "@/features/projects/format";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { listCrosscheck } from "@/server/finance/crosscheck";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { DashboardHeader } from "./dashboard-header";
import { PipelineTiles } from "./pipeline-charts";
import { StatTile } from "./stat-tile";

const SHOWN = 8;

/**
 * Finance's read-only picture: the pipeline and won values, and the projects whose quotation, PO and value references do not
 * agree with their progress (the rules are in src/domain/finance/crosscheck.ts). Each number links to the cross-check list.
 */
export async function FinanceDashboard({ viewer }: { viewer: SessionUser }) {
  const db = getDb();
  const [{ rows, flagCounts }, analytics] = await Promise.all([listCrosscheck(db, viewer), getPipelineAnalytics(db, viewer)]);
  const flagged = rows.filter((row) => row.flags.length > 0);
  const references = rows.flatMap((row) => row.references);
  const completed = (type: "RFQ" | "PO") => references.filter((reference) => reference.type === type && reference.status === "COMPLETED").length;
  const open = (type: "RFQ" | "PO") => references.filter((reference) => reference.type === type && reference.status !== "COMPLETED" && reference.status !== "CANCELLED").length;

  return (
    <>
      <DashboardHeader title="Finance Dashboard" summary="Pencocokan nilai proyek dengan referensi quotation dan purchase order-nya, hanya untuk dibaca." />
      <PipelineTiles analytics={analytics} />

      <section aria-label="Quotation and PO references" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Quotations completed" value={completed("RFQ")} note={`${open("RFQ")} RFQ masih terbuka`} href={CROSSCHECK_PATH} />
        <StatTile label="POs completed" value={completed("PO")} note={`${open("PO")} PO masih terbuka`} href={CROSSCHECK_PATH} />
        {CROSSCHECK_FLAGS.map((flag) => (
          <StatTile key={flag} label={CROSSCHECK_FLAG_LABELS[flag]} value={flagCounts[flag]} href={`${CROSSCHECK_PATH}?flag=${flag}`} note="Proyek yang perlu dicek" />
        ))}
      </section>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Projects to check</h2>
          </CardTitle>
          <CardDescription>
            {flagged.length} project{flagged.length === 1 ? " has" : "s have"} at least one flag.{" "}
            <Link href={CROSSCHECK_PATH} className="underline underline-offset-4">
              Open the full cross-check
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flagged.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "There are no projects yet." : "Every project agrees with its references."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {flagged.slice(0, SHOWN).map((row) => (
                <li key={row.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                  <Link href={`${PROJECTS_PATH}/${row.code}`} className="min-w-0 truncate text-primary underline-offset-4 hover:underline">
                    <span className="font-mono text-xs">{row.code}</span> · {row.endUserCompany} – {row.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{formatAmount(row.finalValue ?? row.estimatedValue)}</span>
                    {row.flags.map((flag) => (
                      <Badge key={flag} variant="secondary" className="bg-warning text-warning-foreground">
                        {CROSSCHECK_FLAG_LABELS[flag]}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="mb-8 text-xs text-muted-foreground">
        Won value {formatCompact(analytics.totals.wonValue)} across {analytics.totals.wonCount} project{analytics.totals.wonCount === 1 ? "" : "s"}.{" "}
        <Link href={CROSSCHECK_PATH} className={buttonVariants({ variant: "link", size: "sm" })}>
          Financial Crosscheck
        </Link>
      </p>
    </>
  );
}
