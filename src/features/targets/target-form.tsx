"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { SaveText } from "@/components/ui/save-text";
import { MONTHS, MONTH_NAMES, QUARTERS, QUARTER_MONTHS, quarterOfMonth, type Quarter } from "@/domain/targets/quarters";
import { formatAmount } from "@/features/projects/format";
import { MoneyInput } from "@/features/projects/money-input";
import type { StoredTargets } from "@/server/targets/service";
import { saveTargetsAction } from "./actions";

const monthsOf = (quarter: Quarter) => MONTHS.filter((m) => quarterOfMonth(m) === quarter);

/** A quarter's stored target cut into three equal months (the last one takes the rounding), to start from. */
function spread(total: number): number[] {
  const share = Math.floor((total / 3) * 100) / 100;
  return [share, share, Math.round((total - 2 * share) * 100) / 100];
}

/**
 * The salesperson's own gross-profit target for each month of a year, grouped by quarter so each quarter's sum is visible. A blank box
 * means no target. Spreading a quarter's stored target evenly is an explicit button that only fills the boxes: nothing is saved until Save.
 */
export function TargetForm({ year, stored }: { year: number; stored: StoredTargets }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveTargetsAction, null);
  const router = useRouter();
  // Refresh the figures above after a save. Done here, after the result is shown, because refreshing from the action itself replaces the form before its result is read.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  // The boxes are remounted whenever the saved months change, so they always show what is stored; a spread lives only until then.
  const storedKey = JSON.stringify(stored.months);
  const [filled, setFilled] = useState<{ base: string; values: Record<number, number> } | null>(null);
  const spreadApplied = filled?.base === storedKey;
  const shown: Record<number, number | null | undefined> = spreadApplied ? { ...stored.months, ...filled.values } : stored.months;

  // A quarter that has a stored target but no month filled in: the only place the evenly-spread button has something to do.
  const spreadable = spreadApplied ? [] : QUARTERS.filter((q) => stored.quarters[q] !== null && monthsOf(q).every((m) => stored.months[m] === null));
  const spreadNow = () => {
    const values: Record<number, number> = {};
    for (const q of spreadable) monthsOf(q).forEach((m, i) => (values[m] = spread(stored.quarters[q]!)[i]!));
    setFilled({ base: storedKey, values });
  };
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="year" value={year} />
      {/* Only the boxes are remounted when the stored months change: the form (and the status of the save) stays. */}
      <div key={`${year}-${storedKey}-${spreadApplied}`} className="flex flex-col gap-4">
        {QUARTERS.map((q) => (
          <fieldset key={q} className="grid gap-3 sm:grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] sm:items-start">
            <legend className="sr-only">
              Q{q} {QUARTER_MONTHS[q]}
            </legend>
            <div className="text-sm font-medium sm:pt-1.5" aria-hidden>
              Q{q} <span className="block text-xs font-normal text-muted-foreground">{QUARTER_MONTHS[q]}</span>
            </div>
            {monthsOf(q).map((m) => (
              <div key={m} className="flex flex-col gap-1.5">
                <Label htmlFor={`grossProfit-${m}`}>{MONTH_NAMES[m - 1]}</Label>
                <MoneyInput id={`grossProfit-${m}`} name={`grossProfit-${m}`} defaultValue={shown[m] === null || shown[m] === undefined ? "" : String(shown[m])} placeholder="100.000.000" />
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      {spreadable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-2 text-sm">
          <p className="min-w-0 flex-1 text-muted-foreground">
            {spreadable.map((q) => `Q${q}`).join(", ")} masih punya target per kuartal ({spreadable.map((q) => formatAmount(stored.quarters[q])).join(", ")}) tanpa target per bulan. Bagi rata hanya mengisi kotak; sesuaikan dengan musim penjualan, lalu Save.
          </p>
          <Button type="button" variant="outline" onClick={spreadNow}>
            Spread evenly
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Jumlah dalam IDR; titik ditambahkan saat Anda mengetik. Kosongkan kolom jika tidak ada target. Target kuartal dan tahun adalah jumlah bulannya. Setiap penyimpanan masuk ke audit log.
      </p>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          <SaveText what={`my ${year} targets`} pending={pending} />
        </Button>
      </div>
    </form>
  );
}
