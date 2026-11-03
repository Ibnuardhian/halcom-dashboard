"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COMMERCIAL_FIELDS, type CommercialField } from "@/domain/projects/commercial";
import { PROGRESS_OPTION_LABELS, PROJECT_PROGRESSES, TRACK_STATUSES, TRACK_STATUS_LABELS } from "@/domain/projects/progress";
import { updateCommercialDetailsAction } from "./actions";
import { MarginInput } from "./margin-input";
import { MoneyInput } from "./money-input";

type Values = Record<CommercialField, string>;

const HINTS: Partial<Record<CommercialField, string>> = {
  createdAt: "Tanggal proyek ini menjadi opportunity. Pipeline Growth menghitung proyek sejak tanggal ini; tidak boleh di masa depan.",
  progress: "Setiap tahap mewakili win probability, dipakai oleh weighted pipeline. 30% - Propose berarti quotation sudah diajukan.",
  quoteReleasedAt:
    "Tanggal quotation diajukan ke customer (mencapai 30% - Propose). Terisi hari ini saat Progress dipindah ke Propose; atau isi tanggal ini secara manual dan Progress akan ikut berpindah ke Propose. Ubah atau kosongkan saat jadwal berubah.",
  targetDate: "Tanggal target deal ini akan ditutup",
  finalValue: "Nilai PO yang disepakati setelah diketahui; nilai penutupan proyek, dipakai untuk target gross profit Anda",
  wonDate:
    "Tanggal proyek ditutup sebagai won. Terisi hari ini saat Progress dipindah ke Closed Won; atau isi tanggal ini secara manual dan Progress akan ikut berpindah ke Closed Won. Menentukan kuartal mana yang dihitung.",
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
        // The two margin fields share one box: the amount.
        // Estimated PO value is no longer typed: the Gross Profit is enough. A value already stored stays as it is.
        if (field === "estimatedValue") return null;
        if (field === "targetMarginValue") return null;
        // A margin stored as a percentage arrives here already converted to its amount, so saving never loses it.
        if (field === "targetMargin") return <MarginInput key={field} id={id} defaultValue={values.targetMarginValue} />;
        return (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{COMMERCIAL_FIELDS[field].label}</Label>
            {kind === "progress" ? (
              <NativeSelect id={id} name={field} defaultValue={values[field]}>
                {PROJECT_PROGRESSES.map((option) => (
                  <option key={option} value={option}>
                    {PROGRESS_OPTION_LABELS[option]}
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
            ) : kind === "date" ? (
              <DateInput id={id} name={field} label={COMMERCIAL_FIELDS[field].label} defaultValue={values[field]} />
            ) : (
              <Input id={id} name={field} type="text" inputMode="decimal" defaultValue={values[field]} maxLength={40} />
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
