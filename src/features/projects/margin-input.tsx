"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import type { MarginMode } from "@/domain/projects/margin";
import { MoneyInput } from "./money-input";

/**
 * One box for the target margin with a choice of how it is entered: as an amount (the default) or as a percentage of the
 * sale. The form sends `marginMode` and `marginInput`; the server stores it in one field and clears the other.
 */
export function MarginInput({ id, defaultMode = "amount", defaultValue = "", hint = true }: { id: string; defaultMode?: MarginMode; defaultValue?: string; hint?: boolean }) {
  const [mode, setMode] = useState<MarginMode>(defaultMode);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{mode === "amount" ? "Target margin (amount)" : "Target margin (%)"}</Label>
        <fieldset className="flex gap-3 text-xs" aria-label="Enter the target margin as">
          {(["amount", "percent"] as const).map((option) => (
            <label key={option} className="flex items-center gap-1">
              <input type="radio" name="marginMode" value={option} checked={mode === option} onChange={() => setMode(option)} className="size-3.5 accent-primary" />
              {option === "amount" ? "Amount" : "Percent"}
            </label>
          ))}
        </fieldset>
      </div>
      {/* A fresh box per mode: an amount is grouped with dots as it is typed, a percentage is not, and one does not carry over to the other. */}
      <MoneyInput key={mode} id={id} name="marginInput" grouped={mode === "amount"} defaultValue={mode === defaultMode ? defaultValue : ""} />
      {hint ? (
        <span className="text-xs text-muted-foreground">
          {mode === "amount" ? "The margin in money, for example 150000000. Used as it is." : "Percentage of the sale, for example 12.5. Worked out from the value."}
        </span>
      ) : null}
    </div>
  );
}
