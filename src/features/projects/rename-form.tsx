"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveText } from "@/components/ui/save-text";
import { renameProjectAction } from "./actions";
import { EditDialog } from "./edit-dialog";

/** Superadmin, Admin and SOA (the page decides): the name is shown, and the Edit button opens a modal to correct it. */
export function RenameProjectForm({ projectId, projectCode, name }: { projectId: string; projectCode: string; name: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(renameProjectAction, null);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Nama project</p>
        <p className="text-sm font-medium break-words">{name}</p>
      </div>
      <EditDialog title="Ubah nama project" buttonLabel="Edit nama project" state={state}>
        <form key={name} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="projectCode" value={projectCode} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`rename-${projectCode}`}>Nama project</Label>
            <Input id={`rename-${projectCode}`} name="name" defaultValue={name} maxLength={160} required autoComplete="off" />
          </div>
          <FormStatus state={state} />
          <div>
            <Button type="submit" disabled={pending}>
              <SaveText what="project name" pending={pending} />
            </Button>
          </div>
        </form>
      </EditDialog>
    </div>
  );
}
