"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NativeSelect } from "@/components/ui/native-select";

const STEP = "inline-flex h-10 min-w-10 items-center justify-center rounded-md px-3 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-40";

/**
 * The year control and everything that depends on it. Moving to another year navigates with the router (no page reload), shows the old
 * content dimmed with a status line while the new year loads, then slides the new content in from the side the year lies on (a later year
 * from the right). The slide is a 300 ms CSS animation that is switched off under prefers-reduced-motion (see globals.css). Arrow keys move
 * between years while focus is inside the control. Only one move can be in flight: the router keeps the answer for the year asked last.
 */
export function YearScope({ year, years, thisYear, basePath, children }: { year: number; years: number[]; thisYear: number; basePath: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seen, setSeen] = useState(year);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  // Adjusting state while rendering is React's way to derive "which way did the year move" from the new prop.
  if (seen !== year) {
    setDirection(year > seen ? "next" : "prev");
    setSeen(year);
  }

  const index = years.indexOf(year);
  const earlier = index > 0 ? years[index - 1]! : null;
  const later = index >= 0 && index < years.length - 1 ? years[index + 1]! : null;

  const go = (target: number | null) => {
    if (target === null || target === year || pending) return;
    startTransition(() => router.push(`${basePath}?year=${target}`));
  };
  const caption = year === thisYear ? "this year" : year < thisYear ? "past" : "upcoming";

  return (
    <>
      <div
        role="group"
        aria-label="Year"
        className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") go(earlier);
          else if (event.key === "ArrowRight") go(later);
          else return;
          event.preventDefault();
        }}
      >
        <div className="inline-flex items-center rounded-lg border p-0.5">
          <button type="button" aria-label={earlier === null ? "Previous year (none available)" : `Previous year, ${earlier}`} aria-disabled={earlier === null || pending} onClick={() => go(earlier)} className={STEP}>
            <span aria-hidden>‹</span>
          </button>
          {earlier !== null ? (
            <button type="button" aria-label={`Show ${earlier}`} aria-disabled={pending} onClick={() => go(earlier)} className={`${STEP} hidden sm:inline-flex`}>
              {earlier}
            </button>
          ) : null}
          <div aria-live="polite" className="flex min-w-24 flex-col items-center rounded-md bg-primary px-4 py-1 text-primary-foreground">
            <span className="text-xl leading-6 font-semibold tabular-nums">{year}</span>
            <span className="text-[11px] leading-3">{caption}</span>
          </div>
          {later !== null ? (
            <button type="button" aria-label={`Show ${later}`} aria-disabled={pending} onClick={() => go(later)} className={`${STEP} hidden sm:inline-flex`}>
              {later}
            </button>
          ) : null}
          <button type="button" aria-label={later === null ? "Next year (none available)" : `Next year, ${later}`} aria-disabled={later === null || pending} onClick={() => go(later)} className={STEP}>
            <span aria-hidden>›</span>
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Go to year
          <NativeSelect value={year} disabled={pending} onChange={(event) => go(Number(event.target.value))} className="w-24">
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p role="status" className="text-sm text-muted-foreground">
          {pending ? "Memuat data tahun lain…" : ""}
        </p>
      </div>
      <div key={year} data-direction={direction ?? undefined} aria-busy={pending} className={`gp-year-content overflow-x-clip ${pending ? "opacity-50 transition-opacity" : ""}`}>
        {children}
      </div>
    </>
  );
}
