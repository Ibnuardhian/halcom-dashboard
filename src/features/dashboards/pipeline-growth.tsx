"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { areaPath, labelStep, monotonePath, niceTicks, runs, type XY } from "@/components/charts/line-math";
import { Button } from "@/components/ui/button";
import {
  GRANULARITIES,
  GRANULARITY_LABELS,
  GROWTH_CATEGORIES,
  GROWTH_CATEGORY_LABELS,
  GROWTH_COLORS,
  GROWTH_STAGES,
  describeComparison,
  type Granularity,
  type GrowthPoint,
} from "@/domain/projects/growth";
import { PERIOD_WORDS, tooltipLine, type PipelineGrowth } from "@/domain/projects/growth-cards";
import { PROGRESS_NAMES } from "@/domain/projects/progress";

const HEIGHT = 280;
const MARGIN = { top: 14, right: 34, bottom: 30, left: 34 };
const AREA_OPACITY = 0.14;

type Phase = { kind: "ready" } | { kind: "loading" } | { kind: "error"; message: string };

/** The tick under a point: the week number or the month or quarter, without the date range that the tooltip carries. */
const tickLabel = (point: GrowthPoint) => point.label.split(" · ")[0]!;

function isGrowth(value: unknown): value is PipelineGrowth {
  const v = value as Partial<PipelineGrowth> | null;
  return !!v && typeof v === "object" && Array.isArray(v.points) && Array.isArray(v.cards) && typeof v.granularity === "string";
}

const formatDate = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(iso));

/** The width of an element, kept up to date as it is resized, so the chart can drop labels instead of overflowing on a phone. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Pipeline Growth: projects in each of three groups (Opportunity, Quoted, Closed Won) at the end of each week, month or quarter, from the
 * project stage history. The page gives the first (monthly) data; choosing another period fetches it without leaving the page, and an answer
 * to an older choice never replaces a newer one. A period before the history started has no point: the line breaks there.
 */
export function PipelineGrowthChart({ initial }: { initial: PipelineGrowth }) {
  const [data, setData] = useState<PipelineGrowth>(initial);
  const [granularity, setGranularity] = useState<Granularity>(initial.granularity);
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [active, setActive] = useState<number | null>(null);
  const latest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [frame, width] = useWidth();

  const load = useCallback(async (next: Granularity) => {
    const ticket = ++latest.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase({ kind: "loading" });
    setActive(null);
    try {
      const response = await fetch(`/api/pipeline-growth?granularity=${next}`, { signal: abort.signal, cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) throw new Error("Sesi Anda sudah berakhir. Masuk lagi untuk melihat chart ini.");
      if (!response.ok) throw new Error("Chart tidak bisa dimuat.");
      const body: unknown = await response.json();
      if (!isGrowth(body)) throw new Error("Chart tidak bisa dibaca.");
      if (ticket !== latest.current) return; // a newer choice was made while this one was on its way
      setData(body);
      setPhase({ kind: "ready" });
    } catch (error) {
      if (ticket !== latest.current || (error instanceof DOMException && error.name === "AbortError")) return;
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Chart tidak bisa dimuat." });
    }
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  const choose = (next: Granularity) => {
    if (next === granularity && phase.kind !== "error") return;
    setGranularity(next);
    void load(next);
  };

  const points = data.points;
  const measured = points.filter((point) => point.counts !== null);
  const empty = measured.length === 0;
  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(0, ...measured.flatMap((point) => GROWTH_CATEGORIES.map((category) => point.counts![category])));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const x = (index: number) => MARGIN.left + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => MARGIN.top + innerHeight - (value / top) * innerHeight;
  const step = labelStep(points.length, Math.max(0, ...points.map((point) => tickLabel(point).length)) * 6.5, innerWidth);
  const unreliableCount = points.length - measured.length;
  const activePoint = active === null ? null : (points[active] ?? null);
  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active), 96), width - 96);

  return (
    <section aria-label="Pipeline Growth" className="mb-6 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10" data-testid="pipeline-growth">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Pipeline Growth</h2>
          <p className="text-sm text-muted-foreground">
            Jumlah proyek per akhir {PERIOD_WORDS[granularity]} berdasarkan tanggal dibuat (Quoted = Propose 30%, Closed Won = 100%, tanpa Closed Lost). Minggu dimulai hari Senin; zona waktu Asia/Jakarta.
          </p>
        </div>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border p-0.5">
          {GRANULARITIES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={granularity === option}
              onClick={() => choose(option)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${granularity === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {GRANULARITY_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Legend">
        {GROWTH_CATEGORIES.map((category) => (
          <li key={category} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: GROWTH_COLORS[category] }} />
            <span className="font-medium">{GROWTH_CATEGORY_LABELS[category]}</span>
            <span className="text-muted-foreground">({GROWTH_STAGES[category].map((stage) => PROGRESS_NAMES[stage]).join(", ")})</span>
          </li>
        ))}
      </ul>

      <div ref={frame} className="relative" aria-busy={phase.kind === "loading"}>
        {phase.kind === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-4 text-sm">
            <p>{phase.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load(granularity)}>
              Try again
            </Button>
          </div>
        ) : empty ? (
          <p role="status" className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            {phase.kind === "loading"
              ? "Memuat…"
              : data.historyStartsAt
                ? `Belum ada periode chart ini yang tercakup: riwayat tahap mulai dicatat pada ${formatDate(data.historyStartsAt)}.`
                : "Belum ada riwayat tahap yang tercatat."}
          </p>
        ) : (
          <>
            <svg
              width="100%"
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`Pipeline Growth, ${GRANULARITY_LABELS[granularity].toLowerCase()}: jumlah proyek di Opportunity, Quoted, dan Closed Won per ${PERIOD_WORDS[granularity]}. Tabel dengan angka yang sama ada di bawahnya.`}
              className={phase.kind === "loading" ? "opacity-50 transition-opacity" : "transition-opacity"}
              onPointerLeave={() => setActive(null)}
            >
              {ticks.map((tick) => (
                <g key={tick}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={tick === 0 ? 0.3 : 0.1} />
                  <text x={MARGIN.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
                    {tick}
                  </text>
                </g>
              ))}
              {points.map((point, index) =>
                index % step === 0 || index === points.length - 1 ? (
                  <text key={point.key} x={x(index)} y={HEIGHT - 9} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
                    {tickLabel(point)}
                  </text>
                ) : null,
              )}
              {active !== null ? <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" /> : null}
              {GROWTH_CATEGORIES.map((category) => {
                const series = points.map((point, index) => (point.counts ? ({ x: x(index), y: y(point.counts[category]) } satisfies XY) : null));
                return (
                  <g key={category} data-category={category}>
                    {runs(series).map((run) => (
                      <g key={run.start}>
                        <path d={areaPath(run.items, y(0))} fill={GROWTH_COLORS[category]} fillOpacity={AREA_OPACITY} stroke="none" />
                        <path d={monotonePath(run.items)} fill="none" stroke={GROWTH_COLORS[category]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    ))}
                    {series.map((point, index) =>
                      point ? <circle key={index} cx={point.x} cy={point.y} r={active === index ? 5 : 3.5} fill={GROWTH_COLORS[category]} stroke="var(--card, #fff)" strokeWidth={2} /> : null,
                    )}
                  </g>
                );
              })}
              {points.map((point, index) => {
                const left = index === 0 ? MARGIN.left : (x(index - 1) + x(index)) / 2;
                const right = index === points.length - 1 ? width - MARGIN.right : (x(index) + x(index + 1)) / 2;
                return (
                  <rect
                    key={point.key}
                    x={left}
                    y={MARGIN.top}
                    width={Math.max(1, right - left)}
                    height={innerHeight}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${point.label}${point.counts ? `: ${GROWTH_CATEGORIES.map((c) => `${GROWTH_CATEGORY_LABELS[c]} ${point.counts![c]}`).join(", ")}` : ": belum ada riwayat untuk periode ini"}`}
                    onPointerEnter={() => setActive(index)}
                    onPointerMove={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                    onClick={() => setActive(index)}
                    className="outline-none focus-visible:stroke-ring"
                  />
                );
              })}
            </svg>
            {activePoint ? (
              <div
                role="status"
                data-testid="pipeline-growth-tooltip"
                className="pointer-events-none absolute top-1 z-10 w-48 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                style={{ left: tipLeft }}
              >
                <p className="mb-1 font-semibold">
                  {activePoint.label}
                  {activePoint.running ? " (sejauh ini)" : ""}
                </p>
                {activePoint.counts && activePoint.percents ? (
                  <>
                    <ul className="flex flex-col gap-0.5">
                      {GROWTH_CATEGORIES.map((category) => (
                        <li key={category} className="flex items-center gap-1.5">
                          <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: GROWTH_COLORS[category] }} />
                          {tooltipLine(category, activePoint.counts![category], activePoint.percents![category])}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-muted-foreground">{activePoint.total} proyek secara total</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Belum tercatat: riwayat tahap mulai {data.historyStartsAt ? formatDate(data.historyStartsAt) : "nanti"}.</p>
                )}
              </div>
            ) : null}
            {phase.kind === "loading" ? (
              <p role="status" className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
                Memuat…
              </p>
            ) : null}
          </>
        )}
      </div>

      {data.historyStartsAt && points.length > 0 && new Date(points[0]!.start).getTime() < new Date(data.historyStartsAt).getTime() && !empty ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="pipeline-growth-notice">
          Riwayat tahap mulai dicatat pada {formatDate(data.historyStartsAt)}. Sebelum itu, proyek dihitung Quoted sejak Quote released dan Closed Won sejak Won date; tanpa tanggal tersebut dihitung sebagai Opportunity.
        </p>
      ) : unreliableCount > 0 && !empty ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="pipeline-growth-notice">
          Sebagian periode tidak ditampilkan: tahap proyek saat itu tidak tercatat, dan tidak diperkirakan.
        </p>
      ) : null}

      <ul aria-label="Summary" className="mt-4 grid gap-3 sm:grid-cols-3">
        {data.cards.map((card) => (
          <li key={card.category} data-testid={`growth-card-${card.category}`} className="rounded-lg border p-3" style={{ borderLeft: `4px solid ${card.color}` }}>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: card.color }} />
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.count === null ? "N/A" : card.count}</p>
            <p className="text-xs text-muted-foreground">
              {card.percent === null ? "Belum ada riwayat untuk periode ini" : `${card.percent.toFixed(1)}% dari ${data.points.at(-1)?.total ?? 0} proyek di pipeline`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <span aria-hidden>{card.comparison.kind === "change" || card.comparison.kind === "new" ? (card.comparison.delta > 0 ? "▲ " : "▼ ") : ""}</span>
              {describeComparison(card.comparison, PERIOD_WORDS[granularity])}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Kartu menampilkan {PERIOD_WORDS[granularity]} terbaru sejauh ini dibanding {PERIOD_WORDS[granularity]} sebelumnya. Angka turun belum tentu buruk: proyek yang pindah dari Opportunity ke Quoted keluar dari satu grup dan masuk ke grup berikutnya. Ini jumlah pada satu waktu, bukan conversion rate.
      </p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Tampilkan angka sebagai tabel</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">Jumlah proyek per grup pada akhir tiap periode</caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Periode
                </th>
                {GROWTH_CATEGORIES.map((category) => (
                  <th key={category} scope="col" className="py-1 pr-3 font-medium">
                    {GROWTH_CATEGORY_LABELS[category]}
                  </th>
                ))}
                <th scope="col" className="py-1 font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.key} className="border-t">
                  <th scope="row" className="py-1 pr-3 font-normal">
                    {point.label}
                  </th>
                  {GROWTH_CATEGORIES.map((category) => (
                    <td key={category} className="py-1 pr-3">
                      {point.counts && point.percents ? `${point.counts[category]} (${point.percents[category].toFixed(1)}%)` : "–"}
                    </td>
                  ))}
                  <td className="py-1">{point.total ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
