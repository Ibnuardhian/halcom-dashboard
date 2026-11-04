"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { TaxBasis } from "@/domain/projects/tax-basis";
import { saveTaxBasisAction } from "./actions";
import { SaveText } from "@/components/ui/save-text";

/** Superadmin: does the Estimated PO value include PPN, does the margin, and what is the rate. */
export function TaxBasisForm({ basis }: { basis: TaxBasis }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveTaxBasisAction, null);
  return (
    <form key={JSON.stringify(basis)} action={formAction} className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tax-value">Estimated PO value dan Final value</Label>
        <NativeSelect id="tax-value" name="valueIncludesTax" defaultValue={basis.valueIncludesTax ? "1" : "0"}>
          <option value="1">Include PPN</option>
          <option value="0">Exclude PPN</option>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tax-margin">Gross Profit</Label>
        <NativeSelect id="tax-margin" name="marginIncludesTax" defaultValue={basis.marginIncludesTax ? "1" : "0"}>
          <option value="0">Exclude PPN</option>
          <option value="1">Include PPN</option>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tax-rate">Tarif PPN (%)</Label>
        <Input id="tax-rate" name="taxRatePercent" inputMode="decimal" defaultValue={String(basis.taxRatePercent)} maxLength={5} className="w-28" />
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          <SaveText what="PPN basis" pending={pending} />
        </Button>
      </div>
    </form>
  );
}
