import Link from "next/link";
import { ChartEmpty, seriesColor } from "./chart-card";

/** `href`, when given, makes the slice's legend row a link to the records behind it. */
export type DonutItem = { key: string; label: string; value: number; display?: string; neutral?: boolean; href?: string | null };

const RADIUS = 15.9155; // circumference 100, so a stroke length is a percentage
const GAP = 0.8;
const LINK = "rounded-md outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A donut for the composition of a whole (a few parts). The legend beside it is the data table: label, value and
 * share for every slice, so identity never depends on colour alone. Slices keep their order and colour.
 */
export function DonutChart({ items, unit = "projects", centre }: { items: DonutItem[]; unit?: string; centre?: string }) {
  const parts = items.filter((item) => item.value > 0);
  const total = parts.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return <ChartEmpty />;
  const starts = parts.map((_, index) => (parts.slice(0, index).reduce((sum, item) => sum + item.value, 0) / total) * 100);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg viewBox="0 0 42 42" className="size-36 shrink-0 -rotate-90" role="img" aria-label={`Composition of ${total} ${unit}`}>
        <circle cx="21" cy="21" r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth="6" />
        {parts.map((item, index) => {
          const share = (item.value / total) * 100;
          const length = parts.length === 1 ? share : Math.max(0.5, share - GAP);
          const start = starts[index]!;
          return (
            <circle key={item.key} cx="21" cy="21" r={RADIUS} fill="none" stroke={seriesColor(index, item.neutral)} strokeWidth="6" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start}>
              <title>{`${item.label}: ${item.display ?? item.value} (${Math.round(share)}%)`}</title>
            </circle>
          );
        })}
        <g className="rotate-90 origin-center">
          <text x="21" y="21.5" textAnchor="middle" className="fill-foreground text-[6px] font-semibold">
            {centre ?? total}
          </text>
          <text x="21" y="26.5" textAnchor="middle" className="fill-muted-foreground text-[2.6px]">
            {unit}
          </text>
        </g>
      </svg>
      <ul className="grid w-full min-w-0 gap-1 text-sm">
        {parts.map((item, index) => {
          const row = (
            <>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(index, item.neutral) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="shrink-0 tabular-nums">{item.display ?? item.value}</span>
              <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{Math.round((item.value / total) * 100)}%</span>
            </>
          );
          return (
            <li key={item.key}>
              {item.href ? (
                <Link href={item.href} aria-label={`${item.label}: ${item.display ?? item.value}. Show the projects.`} className={`flex items-center gap-2 px-1 py-0.5 ${LINK}`}>
                  {row}
                </Link>
              ) : (
                <div className="flex items-center gap-2 px-1 py-0.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
