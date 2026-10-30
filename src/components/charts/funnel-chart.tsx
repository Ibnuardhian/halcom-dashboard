import Link from "next/link";
import { ChartEmpty, seriesColor } from "./chart-card";

/** `href`, when given, makes the step a link to the records behind it. */
export type FunnelItem = { key: string; label: string; count: number; display: string; href?: string | null };

const LINK = "rounded-md outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";
const GRID = "grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 text-xs";

/**
 * A funnel: one centred bar per step, as wide as the number of projects that reached it. The count and the value sit in
 * the bar's row, so nothing depends on the bar being wide enough to hold text.
 */
export function FunnelChart({ items }: { items: FunnelItem[] }) {
  const max = Math.max(0, ...items.map((item) => item.count));
  if (items.length === 0 || max === 0) return <ChartEmpty>Belum ada project.</ChartEmpty>;
  return (
    <ol className="flex flex-col gap-1.5">
      {items.map((item, index) => {
        const row = (
          <>
            <span className="truncate text-muted-foreground">{item.label}</span>
            <div className="flex h-7 justify-center" aria-hidden>
              <div className="h-full rounded-sm" style={{ width: `${Math.max(3, (item.count / max) * 100)}%`, background: seriesColor(index === items.length - 1 ? 2 : 0) }} />
            </div>
            <span className="min-w-24 text-right tabular-nums">
              <span className="font-medium">{item.count}</span> <span className="text-muted-foreground">· {item.display}</span>
            </span>
          </>
        );
        const summary = `${item.label}: ${item.count} project${item.count === 1 ? "" : "s"}, ${item.display}`;
        return (
          <li key={item.key} title={summary}>
            {item.href ? (
              <Link href={item.href} aria-label={`${summary}. Show the projects.`} className={`${GRID} ${LINK}`}>
                {row}
              </Link>
            ) : (
              <div className={GRID}>{row}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
