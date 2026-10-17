import { ChartEmpty, seriesColor } from "./chart-card";

export type ColumnItem = { key: string; label: string; value: number; display: string; note?: string };

/** Vertical bars for an ordered scale (the pipeline stages). The exact value sits above each bar. */
export function ColumnChart({ items, color = 0, height = 160 }: { items: ColumnItem[]; color?: number; height?: number }) {
  const max = Math.max(0, ...items.map((item) => item.value));
  if (items.length === 0 || max === 0) return <ChartEmpty>No values entered yet.</ChartEmpty>;
  return (
    <ul className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 flex-col items-center" title={`${item.label}: ${item.display}${item.note ? ` (${item.note})` : ""}`}>
          <span className="mb-1 text-[11px] leading-tight tabular-nums">{item.display}</span>
          <div className="flex w-full items-end justify-center" style={{ height }} aria-hidden>
            <div
              className="w-full max-w-10 rounded-t-md"
              style={{ height: item.value === 0 ? 2 : `${Math.max(2, (item.value / max) * 100)}%`, background: seriesColor(color) }}
            />
          </div>
          <span className="mt-1.5 text-center text-[11px] leading-tight text-muted-foreground">{item.label}</span>
          {item.note ? <span className="text-[10px] leading-tight text-muted-foreground">{item.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
