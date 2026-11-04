"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setDescriptionAction } from "./actions";
import { SaveText } from "@/components/ui/save-text";

/** Superadmin, and Sales on the projects they act on (the page decides): change the description of a project. An empty text clears it. */
export function DescriptionForm({ projectId, projectCode, description }: { projectId: string; projectCode: string; description: string | null }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(setDescriptionAction, null);
  return (
    <form key={description ?? ""} action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <Label htmlFor={`description-${projectCode}`}>Description</Label>
      <Textarea id={`description-${projectCode}`} name="description" defaultValue={description ?? ""} maxLength={2000} rows={4} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          <SaveText what="description" pending={pending} />
        </Button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
