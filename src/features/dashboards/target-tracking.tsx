import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cumulate, paceAt, percentOf, QUARTER_MONTHS, quartersElapsed, type TargetSummary } from "@/domain/targets/quarters";
import { formatAmount, formatCompact } from "@/features/projects/format";
import { CumulativeGpChart, QuarterlyGpChart, type ChartQuarter } from "@/features/targets/gp-charts";
import { TargetForm } from "@/features/targets/target-form";
import type { SalesBreakdownRow, StoredTargets } from "@/server/targets/service";

const pct = (value: number | null) => (value === null ? "–" : `${value.toFixed(1)}%`);

function Figure({ term, children, note }: { term: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t pt-3 first:border-t-0 first:pt-0">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-xl font-semibold tabular-nums">{children}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/**
 * Where gross profit stands against the annual target for one year. Achieved is the gross profit of Closed Won projects by won date: the
 * project value times its target margin, so it is an estimate until the application stores an actual margin ("Won GP (estimated)"). Open
 * pipeline GP is shown apart and never added to achieved.
 */
export function TargetTracking({
  summary,
  own,
  breakdown,
  today,
}: {
  summary: TargetSummary;
  /** The salesperson's own stored targets; null when the viewer is not a salesperson. */
  own: StoredTargets | null;
  /** Everyone's figures for people who see the whole team; null for a salesperson, who sees only their own page. */
  breakdown: SalesBreakdownRow[] | null;
  today: { year: number; month: number };
}) {
  const { notes, year } = summary;
  const gp = summary.total.grossProfit;
  const target = gp.target;
  const percent = percentOf(gp.won, target);
  const remaining = target === null ? null : Math.max(target - gp.won, 0);
  const over = target !== null && gp.won > target ? gp.won - target : 0;
  const elapsed = quartersElapsed(year, today);
  const cumulative = cumulate(summary.quarters);
  const quarterlySet = summary.quarters.some((q) => q.grossProfit.target !== null);
  const pace = elapsed > 0 ? paceAt(cumulative, elapsed) : null;
  const chartQuarters: ChartQuarter[] = summary.quarters.map((q, i) => ({ quarter: q.quarter, label: `Q${q.quarter}`, target: q.grossProfit.target, won: q.grossProfit.won, cumTarget: cumulative[i]!.target, cumWon: cumulative[i]!.won, reached: q.quarter <= elapsed }));
  const scope = own ? "Target Anda sendiri" : "Gabungan target semua salesperson";

  return (
    <section aria-label="Gross profit target tracking" className="flex flex-col gap-6">
      <div className="grid gap-6 rounded-xl p-5 ring-1 ring-foreground/10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Won GP (estimated), {year}</p>
          <p className="text-4xl font-semibold tracking-tight text-primary tabular-nums">{formatAmount(gp.won)}</p>
          {target === null ? (
            <p className="text-sm text-muted-foreground">Belum ada target GP untuk {year}. {own ? "Isi target per kuartal di bawah." : "Setiap salesperson mengisi targetnya sendiri."}</p>
          ) : (
            <>
              <div
                role="progressbar"
                aria-label={`Achieved GP against the ${year} target`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, percent ?? 0)}
                aria-valuetext={percent === null ? "No target to measure against" : `${pct(percent)} of the annual target`}
                className="h-3 w-full rounded-sm bg-muted"
              >
                <div className="h-3 rounded-sm bg-primary" style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
              </div>
              <p className="text-sm">
                <span className="text-lg font-semibold tabular-nums">{pct(percent)}</span> <span className="text-muted-foreground">dari target tahunan {formatAmount(target)}</span>
              </p>
            </>
          )}
          {pace ? (
            <p className="text-sm" data-testid="gp-pace">
              <span className="font-medium">Sampai Q{elapsed}:</span> rencana {formatAmount(pace.target)}, tercapai {formatAmount(gp.won)}.{" "}
              <span className={pace.gap < 0 ? "font-medium text-destructive" : "font-medium"}>{pace.gap < 0 ? `Tertinggal ${formatAmount(-pace.gap)}` : `Di atas rencana ${formatAmount(pace.gap)}`}.</span>
            </p>
          ) : elapsed > 0 && target !== null ? (
            <p className="text-sm text-muted-foreground">Target per kuartal belum diisi, jadi kecepatan capaian belum bisa dinilai.</p>
          ) : null}
        </div>
        <dl className="flex flex-col gap-3 lg:border-l lg:pl-6">
          <Figure term="Annual GP target" note={scope}>
            {target === null ? <span className="text-muted-foreground">Not set</span> : formatAmount(target)}
          </Figure>
          <Figure term={over > 0 ? "Over target by" : "Remaining GP"} note={over > 0 ? "Target tahunan sudah terlampaui" : undefined}>
            {target === null ? <span className="text-muted-foreground">–</span> : formatAmount(over > 0 ? over : remaining)}
          </Figure>
          <Figure term="Open pipeline GP" note={`Potensi, belum tercapai. Project terbuka dengan target closing di ${year}, tanpa pembobotan probabilitas.`}>
            {formatAmount(summary.openPipelineGp)}
          </Figure>
        </dl>
      </div>

      {notes.wonWithoutDate + notes.wonWithoutMargin + notes.openWithoutTargetDate > 0 ? (
        <div role="status" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
          <p className="font-medium">Belum dihitung karena data project belum lengkap:</p>
          <ul className="mt-1 list-disc pl-5">
            {notes.wonWithoutDate > 0 ? <li>{notes.wonWithoutDate} won project(s) without a won date.</li> : null}
            {notes.wonWithoutMargin > 0 ? <li>{notes.wonWithoutMargin} won project(s) without a Gross Profit (they add nothing to gross profit).</li> : null}
            {notes.openWithoutTargetDate > 0 ? <li>{notes.openWithoutTargetDate} open project(s) with a value but no target closing date.</li> : null}
          </ul>
        </div>
      ) : null}

      {!quarterlySet && target !== null ? (
        <p role="status" className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Belum ada target per kuartal. Grafik menampilkan capaian saja; target tidak dibagi rata secara otomatis.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Quarterly GP Performance</h2>
            </CardTitle>
            <CardDescription>Target dan capaian GP tiap kuartal, berdasarkan tanggal won.</CardDescription>
          </CardHeader>
          <CardContent>
            <QuarterlyGpChart quarters={chartQuarters} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Cumulative GP Achievement</h2>
            </CardTitle>
            <CardDescription>Jumlah berjalan sejak Q1: apakah capaian mengikuti rencana target.</CardDescription>
          </CardHeader>
          <CardContent>
            <CumulativeGpChart quarters={chartQuarters} />
          </CardContent>
        </Card>
      </div>

      <details className="rounded-xl p-4 ring-1 ring-foreground/10">
        <summary className="cursor-pointer text-sm font-medium">Show quarterly figures as a table</summary>
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quarter</TableHead>
                <TableHead className="text-right">Target GP</TableHead>
                <TableHead className="text-right">Achieved GP</TableHead>
                <TableHead className="text-right">Gap</TableHead>
                <TableHead className="text-right">Cumulative target</TableHead>
                <TableHead className="text-right">Cumulative achieved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.quarters.map((q, i) => {
                const reached = q.quarter <= elapsed;
                const target = q.grossProfit.target;
                const gap = q.grossProfit.won - (target ?? 0);
                return (
                  <TableRow key={q.quarter}>
                    <TableCell>
                      Q{q.quarter} <span className="text-xs text-muted-foreground">{QUARTER_MONTHS[q.quarter]}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{target === null ? <span className="text-muted-foreground">Not set</span> : formatAmount(target)}</TableCell>
                    <TableCell className="text-right tabular-nums">{reached ? formatAmount(q.grossProfit.won) : <span className="text-muted-foreground">Not started</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{reached && target !== null ? (gap < 0 ? `▼ ${formatAmount(gap)}` : `+${formatAmount(gap)}`) : "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{cumulative[i]!.target === null ? "–" : formatAmount(cumulative[i]!.target)}</TableCell>
                    <TableCell className="text-right tabular-nums">{reached ? formatAmount(cumulative[i]!.won) : "–"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </details>

      {breakdown ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Sales performance</h2>
            </CardTitle>
            <CardDescription>Target dan capaian GP tiap salesperson di {year}, urut dari capaian terbesar.</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdown.length === 0 ? (
              <p role="status" className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Belum ada salesperson dengan target atau project won di {year}.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sales PIC</TableHead>
                      <TableHead className="text-right">GP target</TableHead>
                      <TableHead className="text-right">Achieved GP</TableHead>
                      <TableHead className="text-right">Achievement</TableHead>
                      <TableHead className="text-right">Remaining GP</TableHead>
                      <TableHead className="text-right">Won projects</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.target === null ? <span className="text-muted-foreground">Not set</span> : formatAmount(row.target)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatAmount(row.won)}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(percentOf(row.won, row.target))}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.target === null ? "–" : formatAmount(Math.max(row.target - row.won, 0))}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.wonCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {own ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>My {year} targets</h2>
            </CardTitle>
            <CardDescription>Isi target GP tiap kuartal. Total tahunan ({formatCompact(target)}) adalah jumlah keempat kuartal.</CardDescription>
          </CardHeader>
          <CardContent>
            <TargetForm year={year} values={own} formKey={`${year}-${JSON.stringify(own)}`} />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
