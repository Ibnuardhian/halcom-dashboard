import Link from "next/link";
import { ChartEmpty, seriesColor } from "./chart-card";

/** `href`, when given, makes the row a link to the records behind it. */
export type BarItem = { key: string; label: string; value: number; display: string; note?: string; neutral?: boolean; href?: string | null };

const LINK = "block rounded-md outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Horizontal bars, one row per category, largest first as given. Every row carries its exact value as text, so
 * nothing depends on colour or on reading the bar length. One measure on one axis starting at zero.
 */
export function BarList({
  items,
  color = 0,
  allowEmpty = false,
  scaleMax,
  emptyText = "Belum ada nilai yang diisi.",
}: {
  items: BarItem[];
  color?: number;
  allowEmpty?: boolean;
  /** A fixed full-bar value (100 for percentages), instead of the largest row. */
  scaleMax?: number;
  emptyText?: string;
}) {
  const max = scaleMax ?? Math.max(0, ...items.map((item) => item.value));
  if (items.length === 0 || (max === 0 && !allowEmpty)) return <ChartEmpty>{emptyText}</ChartEmpty>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const row = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 tabular-nums">
                {item.display}
                {item.note ? <span className="ml-1.5 text-xs text-muted-foreground">{item.note}</span> : null}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted" aria-hidden>
              <div className="h-2 rounded-r-full rounded-l-sm" style={{ width: `${max === 0 ? 0 : Math.max(2, (item.value / max) * 100)}%`, background: seriesColor(color, item.neutral) }} />
            </div>
          </>
        );
        const summary = `${item.label}: ${item.display}${item.note ? ` (${item.note})` : ""}`;
        return (
          <li key={item.key} title={summary}>
            {item.href ? (
              <Link href={item.href} aria-label={`${summary}. Show the projects.`} className={LINK}>
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
