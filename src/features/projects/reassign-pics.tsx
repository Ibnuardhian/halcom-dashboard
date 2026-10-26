"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { reassignProjectAction } from "./actions";

type Person = { id: string; name: string };
export type PicOptions = { sales: Person[]; soa: Person[]; purchasing: Person[] };
export type CurrentPics = { salesOwnerId: string | null; soaPicId: string | null; purchasingPicRefId: string | null };

/** Superadmin only (the page decides). Picks who the project belongs to; nothing else about the project changes. */
export function ReassignPics({ projectId, projectCode, current, options }: { projectId: string; projectCode: string; current: CurrentPics; options: PicOptions }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(reassignProjectAction, null);
  const fields = [
    // A project from another source has no internal Sales PIC to move; its source is edited in the Source section.
    ...(current.salesOwnerId === null ? [] : [{ name: "salesOwnerId", label: "Sales PIC", people: options.sales, value: current.salesOwnerId, optional: false }]),
    { name: "soaPicId", label: "SOA PIC (technical)", people: options.soa, value: current.soaPicId ?? "", optional: true },
    { name: "purchasingPicRefId", label: "Purchasing PIC", people: options.purchasing, value: current.purchasingPicRefId ?? "", optional: true },
  ];
  return (
    <form key={`${current.salesOwnerId}|${current.soaPicId}|${current.purchasingPicRefId}`} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1.5">
            <Label htmlFor={`${projectCode}-${field.name}`}>{field.label}</Label>
            <NativeSelect id={`${projectCode}-${field.name}`} name={field.name} defaultValue={field.value}>
              {field.optional ? <option value="">None</option> : null}
              {field.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Move project"}
        </Button>
      </div>
    </form>
  );
}
