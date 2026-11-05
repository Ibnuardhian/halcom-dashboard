"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { SaveText } from "@/components/ui/save-text";
import { Textarea } from "@/components/ui/textarea";
import { setDescriptionAction } from "./actions";
import { EditDialog } from "./edit-dialog";

/** Superadmin, and Sales on the projects they act on (the page decides): the description is shown, and the Edit button opens a modal to change it. An empty text clears it. */
export function DescriptionForm({ projectId, projectCode, description }: { projectId: string; projectCode: string; description: string | null }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(setDescriptionAction, null);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label>Description</Label>
        <EditDialog title="Ubah description" buttonLabel="Edit description" state={state}>
          <form key={description ?? ""} action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="projectCode" value={projectCode} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`description-${projectCode}`}>Description</Label>
              <Textarea id={`description-${projectCode}`} name="description" defaultValue={description ?? ""} maxLength={2000} rows={6} />
            </div>
            <FormStatus state={state} />
            <div>
              <Button type="submit" disabled={pending}>
                <SaveText what="description" pending={pending} />
              </Button>
            </div>
          </form>
        </EditDialog>
      </div>
      {description ? <p className="text-sm whitespace-pre-wrap">{description}</p> : <p className="text-sm text-muted-foreground">Belum dicatat.</p>}
    </div>
  );
}
