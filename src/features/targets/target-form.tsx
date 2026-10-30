"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/features/projects/money-input";
import { QUARTERS, QUARTER_MONTHS } from "@/domain/targets/quarters";
import type { StoredTargets } from "@/server/targets/service";
import { saveTargetsAction } from "./actions";

/** The salesperson's own gross-profit target for each quarter of a year. A blank box means no target. */
export function TargetForm({ year, values, formKey }: { year: number; values: StoredTargets; formKey: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveTargetsAction, null);
  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="year" value={year} />
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[6rem_minmax(0,24rem)] sm:items-end">
        <span className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:block">Quarter</span>
        <span className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:block">Gross profit target</span>
        {QUARTERS.map((q) => (
          <div key={q} className="contents">
            <div className="text-sm font-medium sm:pb-2">
              Q{q} <span className="text-xs font-normal text-muted-foreground">{QUARTER_MONTHS[q]}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`grossProfit-${q}`} className="sm:sr-only">
                Q{q} gross profit target
              </Label>
              <MoneyInput id={`grossProfit-${q}`} name={`grossProfit-${q}`} defaultValue={values[q].grossProfit === null ? "" : String(values[q].grossProfit)} placeholder="contoh: 300.000.000" />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Jumlah dalam IDR; titik ditambahkan saat Anda mengetik. Kosongkan kolom jika tidak ada target. Setiap penyimpanan masuk ke audit log.</p>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : `Save my ${year} targets`}
        </Button>
      </div>
    </form>
  );
}
