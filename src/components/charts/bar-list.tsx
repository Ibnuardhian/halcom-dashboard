import { ChartEmpty, seriesColor } from "./chart-card";

export type BarItem = { key: string; label: string; value: number; display: string; note?: string; neutral?: boolean };

/**
 * Horizontal bars, one row per category, largest first as given. Every row carries its exact value as text, so
 * nothing depends on colour or on reading the bar length. One measure on one axis starting at zero.
 */
export function BarList({ items, color = 0 }: { items: BarItem[]; color?: number }) {
  const max = Math.max(0, ...items.map((item) => item.value));
  if (items.length === 0 || max === 0) return <ChartEmpty>No values entered yet.</ChartEmpty>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.key} title={`${item.label}: ${item.display}${item.note ? ` (${item.note})` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums">
              {item.display}
              {item.note ? <span className="ml-1.5 text-xs text-muted-foreground">{item.note}</span> : null}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden>
            <div className="h-2 rounded-r-full rounded-l-sm" style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: seriesColor(color, item.neutral) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
