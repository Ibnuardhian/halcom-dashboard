"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveText } from "@/components/ui/save-text";
import { Textarea } from "@/components/ui/textarea";
import { saveProjectTitleAction } from "./actions";
import { EditDialog } from "./edit-dialog";

/**
 * The name and the description of a project as one block, a title and its explanation. The Edit button (only for someone who may change
 * the name or the description, which the page decides) opens both in one modal with one Save. A field the person may not change is not shown there.
 */
export function ProjectTitleForm({
  projectId,
  projectCode,
  name,
  description,
  canRename,
  canDescribe,
}: {
  projectId: string;
  projectCode: string;
  name: string;
  description: string | null;
  canRename: boolean;
  canDescribe: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveProjectTitleAction, null);
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Nama project</p>
        <p className="text-sm font-medium break-words">{name}</p>
        <p className="mt-3 text-xs text-muted-foreground">Description</p>
        {description ? <p className="text-sm whitespace-pre-wrap">{description}</p> : <p className="text-sm text-muted-foreground">Belum dicatat.</p>}
      </div>
      <EditDialog title="Ubah nama dan description" buttonLabel="Edit nama dan description" state={state}>
        <form key={`${name}|${description ?? ""}`} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="projectCode" value={projectCode} />
          {canRename ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-${projectCode}`}>Nama project</Label>
              <Input id={`rename-${projectCode}`} name="name" defaultValue={name} maxLength={160} required autoComplete="off" />
            </div>
          ) : null}
          {canDescribe ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`description-${projectCode}`}>Description</Label>
              <Textarea id={`description-${projectCode}`} name="description" defaultValue={description ?? ""} maxLength={2000} rows={6} />
            </div>
          ) : null}
          <FormStatus state={state} />
          <div>
            <Button type="submit" disabled={pending}>
              <SaveText what="name and description" pending={pending} />
            </Button>
          </div>
        </form>
      </EditDialog>
    </div>
  );
}
