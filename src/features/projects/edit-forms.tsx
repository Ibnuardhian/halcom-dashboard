"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_EDITABLE_FIELDS, type ProjectEditableField } from "@/domain/projects/fields";
import { updateProjectDetailsAction } from "./actions";

type Values = Partial<Record<ProjectEditableField, string | null>>;

/**
 * Edits a group of fields of one project. Every save is written to the change log (who, which field,
 * from what, to what). `values` are the stored values.
 */
export function ProjectFieldsForm({
  projectId,
  projectCode,
  fields,
  values,
  submitLabel,
  formKey,
  rows = 3,
}: {
  projectId: string;
  projectCode: string;
  fields: readonly ProjectEditableField[];
  values: Values;
  submitLabel: string;
  /** Changes after every save, so the fields are rebuilt from the stored values while this component (and its result message) stays mounted. */
  formKey: string;
  rows?: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateProjectDetailsAction, null);

  return (
    <form key={formKey} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      {fields.map((field) => {
        const id = `${projectCode}-${field}`;
        return (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{PROJECT_EDITABLE_FIELDS[field].label}</Label>
            <Textarea id={id} name={field} defaultValue={values[field] ?? ""} maxLength={4000} rows={rows} className="min-h-0" />
          </div>
        );
      })}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormStatus state={state} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
