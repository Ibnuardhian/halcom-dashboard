"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EXTERNAL_SOURCE_LABELS, SOURCE_FIELD_LIMITS, SOURCE_LABELS, type ExternalSource } from "@/domain/projects/source";
import { updateProjectSourceAction } from "./actions";

type Person = { id: string; name: string };

/**
 * Edits the external details of a project from another source (Other), or hands it to an internal Sales PIC. The server
 * applies the rules; an Internal Sales project is never edited here (the page does not render this form for it).
 */
export function SourceForm({ projectId, projectCode, values, salesPeople }: { projectId: string; projectCode: string; values: ExternalSource; salesPeople: Person[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateProjectSourceAction, null);
  const [adopt, setAdopt] = useState(false);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="sourceType" value={adopt ? "INTERNAL_SALES" : "OTHER"} />
      {adopt ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${projectCode}-adopt-owner`}>Sales PIC who takes over *</Label>
          <NativeSelect id={`${projectCode}-adopt-owner`} name="salesOwnerId" required defaultValue="">
            <option value="" disabled>
              Select a salesperson
            </option>
            {salesPeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">The project becomes Internal Sales and the external details below are cleared. The change log keeps what they said.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${projectCode}-source-name`}>{EXTERNAL_SOURCE_LABELS.externalSourceName} *</Label>
            <Input id={`${projectCode}-source-name`} name="externalSourceName" required defaultValue={values.externalSourceName ?? ""} maxLength={SOURCE_FIELD_LIMITS.externalSourceName} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${projectCode}-source-contact`}>{EXTERNAL_SOURCE_LABELS.externalContact}</Label>
            <Input id={`${projectCode}-source-contact`} name="externalContact" defaultValue={values.externalContact ?? ""} maxLength={SOURCE_FIELD_LIMITS.externalContact} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${projectCode}-source-ref`}>{EXTERNAL_SOURCE_LABELS.externalReference}</Label>
            <Input id={`${projectCode}-source-ref`} name="externalReference" defaultValue={values.externalReference ?? ""} maxLength={SOURCE_FIELD_LIMITS.externalReference} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`${projectCode}-source-notes`}>{EXTERNAL_SOURCE_LABELS.sourceNotes}</Label>
            <Textarea id={`${projectCode}-source-notes`} name="sourceNotes" defaultValue={values.sourceNotes ?? ""} maxLength={SOURCE_FIELD_LIMITS.sourceNotes} />
          </div>
        </>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormStatus state={state} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : adopt ? "Hand over to Sales" : "Save source"}
          </Button>
          {salesPeople.length > 0 ? (
            <Button type="button" variant="outline" onClick={() => setAdopt((value) => !value)}>
              {adopt ? "Keep as " + SOURCE_LABELS.OTHER : "Hand over to internal Sales"}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
