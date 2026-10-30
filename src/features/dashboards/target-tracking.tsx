import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { percentOf, QUARTER_MONTHS, type Figures, type TargetSummary } from "@/domain/targets/quarters";
import { formatAmount, formatCompact } from "@/features/projects/format";
import { TargetForm } from "@/features/targets/target-form";
import type { StoredTargets } from "@/server/targets/service";

function Bar({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-muted-foreground">–</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-2 w-20 rounded-full bg-muted sm:block" aria-hidden>
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, percent)}%`, background: "var(--viz-1)" }} />
      </div>
      <span className="w-14 text-right tabular-nums">{percent}%</span>
    </div>
  );
}

function FiguresRow({ label, sub, figures, bold, withTarget = true }: { label: string; sub?: string; figures: Figures; bold?: boolean; withTarget?: boolean }) {
  const reached = percentOf(figures.won, figures.target);
  const outlook = percentOf(figures.won + figures.forecast, figures.target);
  return (
    <TableRow className={bold ? "font-semibold" : undefined}>
      <TableCell className="whitespace-nowrap">
        {label} {sub ? <span className="text-xs font-normal text-muted-foreground">{sub}</span> : null}
      </TableCell>
      {withTarget ? <TableCell className="text-right tabular-nums">{figures.target === null ? <span className="text-muted-foreground">Not set</span> : formatAmount(figures.target)}</TableCell> : null}
      <TableCell className="text-right tabular-nums">{formatAmount(figures.won)}</TableCell>
      {withTarget ? (
        <TableCell>
          <Bar percent={reached} />
        </TableCell>
      ) : null}
      <TableCell className={withTarget ? "hidden text-right tabular-nums md:table-cell" : "text-right tabular-nums"}>{formatAmount(figures.forecast)}</TableCell>
      {withTarget ? <TableCell className="hidden text-right tabular-nums lg:table-cell">{outlook === null ? "–" : `${outlook}%`}</TableCell> : <TableCell className="text-right tabular-nums">{formatAmount(figures.won + figures.forecast)}</TableCell>}
    </TableRow>
  );
}

function Section({ title, description, summary, pick, withTarget = true }: { title: string; description: string; summary: TargetSummary; pick: "revenue" | "grossProfit"; withTarget?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quarter</TableHead>
              {withTarget ? <TableHead className="text-right">Target</TableHead> : null}
              <TableHead className="text-right">{withTarget ? "Won so far" : "Revenue won (after PO)"}</TableHead>
              {withTarget ? <TableHead className="text-right">Reached</TableHead> : null}
              <TableHead className={withTarget ? "hidden text-right md:table-cell" : "text-right"}>Forecast (weighted)</TableHead>
              <TableHead className={withTarget ? "hidden text-right lg:table-cell" : "text-right"}>Won + forecast</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.quarters.map((q) => (
              <FiguresRow key={q.quarter} label={`Q${q.quarter}`} sub={QUARTER_MONTHS[q.quarter]} figures={q[pick]} withTarget={withTarget} />
            ))}
          </TableBody>
          <TableFooter>
            <FiguresRow label={`${summary.year} total`} figures={summary.total[pick]} bold withTarget={withTarget} />
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * Where a salesperson stands against their gross-profit target, quarter by quarter, and the form to enter
 * those targets. An admin opening the page sees everyone added together and no form.
 */
export function TargetTracking({
  summary,
  own,
  years,
  basePath,
}: {
  summary: TargetSummary;
  /** The salesperson's own stored targets; null when the viewer is not a salesperson. */
  own: StoredTargets | null;
  years: number[];
  basePath: string;
}) {
  const { notes } = summary;
  return (
    <section aria-label="Target tracking" className="mb-6 flex flex-col gap-4">
      <nav aria-label="Year" className="inline-flex w-fit rounded-lg border p-0.5">
        {years.map((year) => (
          <Link
            key={year}
            href={`${basePath}?view=tracking&year=${year}`}
            aria-current={year === summary.year ? "page" : undefined}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${year === summary.year ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {year}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Gross profit target", summary.total.grossProfit.target],
          ["Gross profit won", summary.total.grossProfit.won],
          ["Revenue won (after PO)", summary.total.revenue.won],
          ["Revenue forecast (weighted)", summary.total.revenue.forecast],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl p-4 ring-1 ring-foreground/10">
            <span className="text-xs font-medium text-muted-foreground">{label as string}</span>
            <span className="mt-1 block text-2xl font-semibold text-primary tabular-nums">{value === null ? "Not set" : formatCompact(value as number)}</span>
          </div>
        ))}
      </div>

      <Section title="Revenue" description="Target revenue tidak diatur. Won adalah final PO value proyek yang ditutup sebagai won pada kuartal itu (setelah PO). Forecast adalah estimated value × probabilitas tahap Progress, untuk open project yang diperkirakan ditutup pada kuartal itu." summary={summary} pick="revenue" withTarget={false} />
      <Section title="Gross profit" description="Won adalah final value proyek yang ditutup sebagai won pada kuartal itu (memakai estimasi sampai nilai finalnya diisi) × target margin proyek. Forecast sama untuk open project yang diperkirakan ditutup pada kuartal itu, dibobot dengan probabilitas tahap Progress." summary={summary} pick="grossProfit" />

      {notes.wonWithoutDate + notes.wonWithoutMargin + notes.openWithoutTargetDate > 0 ? (
        <div role="status" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
          <p className="font-medium">Not counted yet, because the project is missing something:</p>
          <ul className="mt-1 list-disc pl-5">
            {notes.wonWithoutDate > 0 ? <li>{notes.wonWithoutDate} won project(s) without a won date.</li> : null}
            {notes.wonWithoutMargin > 0 ? <li>{notes.wonWithoutMargin} won project(s) without a target margin (they add nothing to gross profit).</li> : null}
            {notes.openWithoutTargetDate > 0 ? <li>{notes.openWithoutTargetDate} open project(s) with a value but no target closing date.</li> : null}
          </ul>
        </div>
      ) : null}

      {own ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>My {summary.year} targets</h2>
            </CardTitle>
            <CardDescription>Isi target tiap kuartal. Tabel di atas menunjukkan capaian Anda.</CardDescription>
          </CardHeader>
          <CardContent>
            <TargetForm year={summary.year} values={own} formKey={`${summary.year}-${JSON.stringify(own)}`} />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
