"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COMMERCIAL_FIELDS, type CommercialField } from "@/domain/projects/commercial";
import { PROGRESS_LABELS, PROJECT_PROGRESSES, TRACK_STATUSES, TRACK_STATUS_LABELS } from "@/domain/projects/progress";
import { updateCommercialDetailsAction } from "./actions";
import { MarginInput } from "./margin-input";
import { MoneyInput } from "./money-input";

type Values = Record<CommercialField, string>;

const HINTS: Partial<Record<CommercialField, string>> = {
  progress: "Each step stands for a win probability, which the weighted pipeline uses.",
  estimatedValue: "Dots are added as you type, for example 1.200.000.000",
  quoteReleasedAt: "Date the quotation was sent to the customer",
  targetDate: "Date the deal should close",
  finalValue: "The agreed PO value once known; counts toward your revenue target",
  wonDate: "Set when the project is closed as won; decides which quarter it counts in",
};

/** Sales' part of the project record. Every change is written to the change log. `values` are the stored values as text. */
export function CommercialForm({ projectId, projectCode, values, formKey }: { projectId: string; projectCode: string; values: Values; formKey: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateCommercialDetailsAction, null);
  return (
    <form key={formKey} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      {(Object.keys(COMMERCIAL_FIELDS) as CommercialField[]).map((field) => {
        const id = `${projectCode}-${field}`;
        const { kind } = COMMERCIAL_FIELDS[field];
        // The two margin fields share one box: an amount (the default) or a percentage.
        if (field === "targetMarginValue") return null;
        if (field === "targetMargin") {
          const percentOnly = values.targetMargin !== "" && values.targetMarginValue === "";
          return <MarginInput key={field} id={id} defaultMode={percentOnly ? "percent" : "amount"} defaultValue={percentOnly ? values.targetMargin : values.targetMarginValue} />;
        }
        return (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{COMMERCIAL_FIELDS[field].label}</Label>
            {kind === "progress" ? (
              <NativeSelect id={id} name={field} defaultValue={values[field]}>
                {PROJECT_PROGRESSES.map((option) => (
                  <option key={option} value={option}>
                    {PROGRESS_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            ) : kind === "track-status" ? (
              <NativeSelect id={id} name={field} defaultValue={values[field]}>
                {TRACK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {TRACK_STATUS_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            ) : kind === "amount" ? (
              <MoneyInput id={id} name={field} defaultValue={values[field]} />
            ) : (
              <Input id={id} name={field} type={kind === "date" ? "date" : "text"} inputMode={kind === "date" ? undefined : "decimal"} defaultValue={values[field]} maxLength={40} />
            )}
            {HINTS[field] ? <span className="text-xs text-muted-foreground">{HINTS[field]}</span> : null}
          </div>
        );
      })}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormStatus state={state} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save commercial details"}
          </Button>
        </div>
      </div>
    </form>
  );
}
