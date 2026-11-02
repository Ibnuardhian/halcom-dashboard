"use client";

import { Label } from "@/components/ui/label";
import { MoneyInput } from "./money-input";

/**
 * The target margin is typed as an amount only (a number, no percentage): every project's margin is worked out on its own, so a percentage
 * would hide that. The form still sends `marginMode`, which keeps `marginFields` storing it in the amount field; the percentage is shown, not entered.
 */
export function MarginInput({ id, defaultValue = "", hint = true }: { id: string; defaultValue?: string; hint?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Target margin (amount)</Label>
      <input type="hidden" name="marginMode" value="amount" />
      <MoneyInput id={id} name="marginInput" grouped defaultValue={defaultValue} />
      {hint ? <span className="text-xs text-muted-foreground">Angka saja, dalam rupiah, misalnya 150000000. Dipakai apa adanya; persentasenya dihitung dari nilai.</span> : null}
    </div>
  );
}
