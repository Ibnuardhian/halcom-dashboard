"use client";

import { useState } from "react";
import { labelStep, monotonePath, niceTicks, type XY } from "@/components/charts/line-math";
import { ChartEmpty } from "@/components/charts/chart-card";
import { useWidth } from "@/features/dashboards/pipeline-growth";
import { formatAmount, formatCompact } from "@/features/projects/format";

/** One calendar quarter as the charts need it. `reached` is false for a quarter that has not started: it has no achieved figure yet. */
export type ChartQuarter = { quarter: number; label: string; target: number | null; won: number; cumTarget: number | null; cumWon: number; reached: boolean };

const HEIGHT = 260;
const MARGIN = { top: 22, right: 12, bottom: 28, left: 52 };
const ACHIEVED = "var(--viz-1)";
const TARGET = "var(--muted-foreground)";
const SHORTFALL = "var(--destructive)";

/** The tooltip text and the amount without the currency (it is IDR, see format.ts). */
function Tip({ left, children }: { left: number; children: React.ReactNode }) {
  return (
    <div role="status" className="pointer-events-none absolute top-1 z-10 w-52 -translate-x-1/2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md" style={{ left }}>
      {children}
    </div>
  );
}

function Axis({ ticks, y, width }: { ticks: number[]; y: (v: number) => number; width: number }) {
  return ticks.map((tick) => (
    <g key={tick}>
      <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={tick === 0 ? 0.3 : 0.1} />
      <text x={MARGIN.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>
        {formatCompact(tick)}
      </text>
    </g>
  ));
}

function Legend({ items }: { items: { label: string; swatch: React.ReactNode }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

const gapText = (won: number, target: number) => {
  const gap = won - target;
  return gap >= 0 ? `${formatAmount(gap)} over target` : `${formatAmount(-gap)} short of target`;
};

/**
 * Quarterly GP Performance: for each quarter the target (outlined bar) beside what was won (solid bar). A quarter with no target set shows no
 * target bar and says so; a target of zero is a thin line. A quarter that has ended below its target carries a red triangle; the same
 * facts are in the table under the charts, so colour is never the only signal.
 */
export function QuarterlyGpChart({ quarters }: { quarters: ChartQuarter[] }) {
  const [frame, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const inner = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(0, ...quarters.flatMap((m) => [m.target ?? 0, m.won]));
  if (max === 0) return <ChartEmpty>Belum ada target atau capaian GP untuk tahun ini.</ChartEmpty>;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const y = (v: number) => MARGIN.top + innerHeight - (v / top) * innerHeight;
  const slot = inner / quarters.length;
  const bar = Math.min(40, (slot - 6) / 2);
  const centre = (i: number) => MARGIN.left + slot * i + slot / 2;
  const current = active === null ? null : quarters[active]!;

  return (
    <div>
      <Legend
        items={[
          { label: "Target GP", swatch: <span aria-hidden className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: TARGET }} /> },
          { label: "Achieved GP", swatch: <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: ACHIEVED }} /> },
          { label: "Ended below target", swatch: <span aria-hidden style={{ color: SHORTFALL }}>▼</span> },
        ]}
      />
      <div ref={frame} className="relative">
        <svg width="100%" viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label="Quarterly GP Performance: target and achieved gross profit for each quarter. The same numbers are in the table below." onPointerLeave={() => setActive(null)}>
          <Axis ticks={ticks} y={y} width={width} />
          {quarters.map((m, i) => {
            const behind = m.reached && m.target !== null && m.won < m.target;
            const pair = m.target !== null && m.reached ? 2 : 1;
            return (
              <g key={m.quarter}>
                {m.target !== null ? (
                  <rect
                    x={centre(i) - (pair === 2 ? bar : bar / 2)}
                    y={y(m.target) - (m.target === 0 ? 1 : 0)}
                    width={bar}
                    height={Math.max(2, y(0) - y(m.target))}
                    fill="none"
                    stroke={TARGET}
                    strokeWidth={1.5}
                    rx={2}
                  />
                ) : null}
                {m.reached && m.won > 0 ? <rect x={centre(i) + (m.target !== null ? 0 : -bar / 2)} y={y(m.won)} width={bar} height={y(0) - y(m.won)} fill={ACHIEVED} rx={2} /> : null}
                {behind ? (
                  <text x={centre(i)} y={Math.min(y(Math.max(m.target!, m.won)), y(0)) - 5} textAnchor="middle" fontSize={10} fill={SHORTFALL}>
                    ▼
                  </text>
                ) : null}
                <text x={centre(i)} y={HEIGHT - 9} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>
                  {m.label}
                </text>
                <rect
                  x={MARGIN.left + slot * i}
                  y={MARGIN.top}
                  width={slot}
                  height={innerHeight}
                  fill={active === i ? "currentColor" : "transparent"}
                  fillOpacity={0.06}
                  tabIndex={0}
                  role="button"
                  aria-label={`${m.label}: target ${m.target === null ? "not set" : formatAmount(m.target)}, achieved ${m.reached ? formatAmount(m.won) : "not started"}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(i)}
                  className="outline-none focus-visible:stroke-ring focus-visible:stroke-2"
                />
              </g>
            );
          })}
        </svg>
        {current ? (
          <Tip left={Math.min(Math.max(centre(active!), 104), width - 104)}>
            <p className="mb-1 font-semibold">{current.label}</p>
            <p>Target: {current.target === null ? "not set" : formatAmount(current.target)}</p>
            <p>Achieved: {current.reached ? formatAmount(current.won) : "quarter not started"}</p>
            {current.reached && current.target !== null ? <p className="mt-1 text-muted-foreground">{gapText(current.won, current.target)}</p> : null}
          </Tip>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Cumulative GP Achievement: running target (dashed) against running achieved (solid) from January. The achieved line stops at the last
 * quarter that has started; the target line is drawn only when at least one quarter has a target, and a quarter without one adds nothing to it.
 */
export function CumulativeGpChart({ quarters }: { quarters: ChartQuarter[] }) {
  const [frame, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const inner = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = Math.max(0, ...quarters.flatMap((m) => [m.cumTarget ?? 0, m.reached ? m.cumWon : 0]));
  if (max === 0) return <ChartEmpty>Belum ada target atau capaian GP untuk tahun ini.</ChartEmpty>;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const y = (v: number) => MARGIN.top + innerHeight - (v / top) * innerHeight;
  const x = (i: number) => MARGIN.left + (inner / (quarters.length - 1)) * i;
  const step = labelStep(quarters.length, 30, inner);
  const targetLine: XY[] = quarters.flatMap((m, i) => (m.cumTarget === null ? [] : [{ x: x(i), y: y(m.cumTarget) }]));
  const wonLine: XY[] = quarters.flatMap((m, i) => (m.reached ? [{ x: x(i), y: y(m.cumWon) }] : []));
  const latest = quarters.reduce((found, m, i) => (m.reached ? i : found), -1);
  const current = active === null ? null : quarters[active]!;

  return (
    <div>
      <Legend
        items={[
          { label: "Cumulative target GP", swatch: <svg aria-hidden width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={TARGET} strokeWidth="2" strokeDasharray="5 3" /></svg> },
          { label: "Cumulative achieved GP", swatch: <svg aria-hidden width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={ACHIEVED} strokeWidth="2.5" /></svg> },
        ]}
      />
      <div ref={frame} className="relative">
        <svg width="100%" viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label="Cumulative GP Achievement: running target and running achieved gross profit from Q1. The same numbers are in the table below." onPointerLeave={() => setActive(null)}>
          <Axis ticks={ticks} y={y} width={width} />
          {quarters.map((m, i) =>
            i % step === 0 || i === quarters.length - 1 ? (
              <text key={m.quarter} x={x(i)} y={HEIGHT - 9} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>
                {m.label}
              </text>
            ) : null,
          )}
          {active !== null ? <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + innerHeight} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" /> : null}
          {targetLine.length > 0 ? <path d={monotonePath(targetLine)} fill="none" stroke={TARGET} strokeWidth={2} strokeDasharray="6 4" strokeLinecap="round" /> : null}
          {wonLine.length > 0 ? <path d={monotonePath(wonLine)} fill="none" stroke={ACHIEVED} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
          {latest >= 0 ? <circle cx={x(latest)} cy={y(quarters[latest]!.cumWon)} r={5} fill={ACHIEVED} stroke="var(--card, #fff)" strokeWidth={2} /> : null}
          {latest >= 0 && quarters[latest]!.cumTarget !== null ? <circle cx={x(latest)} cy={y(quarters[latest]!.cumTarget!)} r={4} fill="var(--card, #fff)" stroke={TARGET} strokeWidth={2} /> : null}
          {quarters.map((m, i) => (
            <rect
              key={m.quarter}
              x={i === 0 ? MARGIN.left : x(i) - inner / (quarters.length - 1) / 2}
              y={MARGIN.top}
              width={inner / (quarters.length - 1) / (i === 0 || i === quarters.length - 1 ? 2 : 1)}
              height={innerHeight}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`Through ${m.label}: target ${m.cumTarget === null ? "not set" : formatAmount(m.cumTarget)}, achieved ${m.reached ? formatAmount(m.cumWon) : "quarter not started"}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              className="outline-none focus-visible:stroke-ring focus-visible:stroke-2"
            />
          ))}
        </svg>
        {current ? (
          <Tip left={Math.min(Math.max(x(active!), 104), width - 104)}>
            <p className="mb-1 font-semibold">Through {current.label}</p>
            <p>Target: {current.cumTarget === null ? "not set" : formatAmount(current.cumTarget)}</p>
            <p>Achieved: {current.reached ? formatAmount(current.cumWon) : "quarter not started"}</p>
            {current.reached && current.cumTarget !== null ? <p className="mt-1 text-muted-foreground">{gapText(current.cumWon, current.cumTarget)}</p> : null}
          </Tip>
        ) : null}
      </div>
    </div>
  );
}
