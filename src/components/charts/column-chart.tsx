import Link from "next/link";
import { ChartEmpty, seriesColor } from "./chart-card";

/** `href`, when given, makes the column a link to the records behind it. */
export type ColumnItem = { key: string; label: string; value: number; display: string; note?: string; href?: string | null };

const FRAME = "flex w-full min-w-0 flex-col items-center px-1";
const LINK = "rounded-md outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Vertical bars for an ordered scale (the pipeline stages). The exact value sits above each bar. Every column keeps a
 * minimum width, so on a narrow card the chart scrolls sideways instead of letting labels run into each other.
 */
export function ColumnChart({ items, color = 0, height = 160 }: { items: ColumnItem[]; color?: number; height?: number }) {
  const max = Math.max(0, ...items.map((item) => item.value));
  if (items.length === 0 || max === 0) return <ChartEmpty>No values entered yet.</ChartEmpty>;
  return (
    <div className="overflow-x-auto pb-2" role="region" aria-label="Scroll sideways to see every step" tabIndex={0}>
    <ul className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(4.75rem, 1fr))` }}>
      {items.map((item) => {
        const column = (
          <>
            <span className="mb-1 text-[11px] leading-tight tabular-nums">{item.display}</span>
            <div className="flex w-full items-end justify-center" style={{ height }} aria-hidden>
              <div
                className="w-full max-w-10 rounded-t-md"
                style={{ height: item.value === 0 ? 2 : `${Math.max(2, (item.value / max) * 100)}%`, background: seriesColor(color) }}
              />
            </div>
            <span className="mt-1.5 text-center text-[11px] leading-tight break-words text-muted-foreground">{item.label}</span>
            {item.note ? <span className="text-[10px] leading-tight text-muted-foreground">{item.note}</span> : null}
          </>
        );
        const summary = `${item.label}: ${item.display}${item.note ? ` (${item.note})` : ""}`;
        return (
          <li key={item.key} className="flex min-w-0" title={summary}>
            {item.href ? (
              <Link href={item.href} aria-label={`${summary}. Show the projects.`} className={`${FRAME} ${LINK}`}>
                {column}
              </Link>
            ) : (
              <div className={FRAME}>{column}</div>
            )}
          </li>
        );
      })}
    </ul>
    </div>
  );
}
