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

function FiguresRow({ label, sub, figures, bold }: { label: string; sub?: string; figures: Figures; bold?: boolean }) {
  const reached = percentOf(figures.won, figures.target);
  const outlook = percentOf(figures.won + figures.forecast, figures.target);
  return (
    <TableRow className={bold ? "font-semibold" : undefined}>
      <TableCell className="whitespace-nowrap">
        {label} {sub ? <span className="text-xs font-normal text-muted-foreground">{sub}</span> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{figures.target === null ? <span className="text-muted-foreground">Not set</span> : formatAmount(figures.target)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatAmount(figures.won)}</TableCell>
      <TableCell>
        <Bar percent={reached} />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">{formatAmount(figures.forecast)}</TableCell>
      <TableCell className="hidden text-right tabular-nums lg:table-cell">{outlook === null ? "–" : `${outlook}%`}</TableCell>
    </TableRow>
  );
}

function Section({ title, description, summary, pick }: { title: string; description: string; summary: TargetSummary; pick: "revenue" | "grossProfit" }) {
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
              <TableHead className="text-right">Target</TableHead>
              <TableHead className="text-right">Won so far</TableHead>
              <TableHead className="text-right">Reached</TableHead>
              <TableHead className="hidden text-right md:table-cell">Forecast (weighted)</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Won + forecast</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.quarters.map((q) => (
              <FiguresRow key={q.quarter} label={`Q${q.quarter}`} sub={QUARTER_MONTHS[q.quarter]} figures={q[pick]} />
            ))}
          </TableBody>
          <TableFooter>
            <FiguresRow label={`${summary.year} total`} figures={summary.total[pick]} bold />
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * Where a salesperson stands against their revenue and gross-profit targets, quarter by quarter, and the form to enter
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
    <section aria-label="Target tracking" className="mb-8 flex flex-col gap-4">
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
          ["Revenue target", summary.total.revenue.target],
          ["Revenue won", summary.total.revenue.won],
          ["Gross profit target", summary.total.grossProfit.target],
          ["Gross profit won", summary.total.grossProfit.won],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl p-4 ring-1 ring-foreground/10">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label as string}</span>
            <span className="mt-1 block text-2xl font-semibold text-primary tabular-nums">{value === null ? "Not set" : formatCompact(value as number)}</span>
          </div>
        ))}
      </div>

      <Section title="Revenue" description="Won is the final PO value of projects closed as won in the quarter. Forecast is estimated value × probability of open projects expected to close in it." summary={summary} pick="revenue" />
      <Section title="Gross profit" description="Value × the project's target margin, counted the same way." summary={summary} pick="grossProfit" />

      {notes.wonWithoutDate + notes.wonWithoutMargin + notes.openWithoutTargetDate + notes.openWithoutProbability > 0 ? (
        <div role="status" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
          <p className="font-medium">Not counted yet, because the project is missing something:</p>
          <ul className="mt-1 list-disc pl-5">
            {notes.wonWithoutDate > 0 ? <li>{notes.wonWithoutDate} won project(s) without a won date.</li> : null}
            {notes.wonWithoutMargin > 0 ? <li>{notes.wonWithoutMargin} won project(s) without a target margin (they count in revenue, not in gross profit).</li> : null}
            {notes.openWithoutTargetDate > 0 ? <li>{notes.openWithoutTargetDate} open project(s) with a value but no target closing date.</li> : null}
            {notes.openWithoutProbability > 0 ? <li>{notes.openWithoutProbability} open project(s) with a value but no probability.</li> : null}
          </ul>
        </div>
      ) : null}

      {own ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>My {summary.year} targets</h2>
            </CardTitle>
            <CardDescription>Enter what you aim to reach in each quarter. The table above shows how far you are.</CardDescription>
          </CardHeader>
          <CardContent>
            <TargetForm year={summary.year} values={own} formKey={`${summary.year}-${JSON.stringify(own)}`} />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
