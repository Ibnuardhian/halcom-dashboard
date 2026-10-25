"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_BODY_MAX_LENGTH, ACTION_KIND_HINTS, ACTION_KIND_LABELS, ACTION_KINDS } from "@/domain/projects/actions";
import { postProjectUpdateAction } from "./actions";

/** Adds an entry to the project feed, like writing a comment. The text box clears after a successful post. */
export function ActionComposer({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(postProjectUpdateAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Add an update</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          {ACTION_KINDS.map((kind) => (
            <label key={kind} className="flex items-start gap-2 text-sm">
              <input type="radio" name="kind" value={kind} defaultChecked={kind === "CURRENT"} className="mt-1 size-4 accent-primary" />
              <span>
                <span className="block font-medium">{ACTION_KIND_LABELS[kind]}</span>
                <span className="block text-xs text-muted-foreground">{ACTION_KIND_HINTS[kind]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${projectCode}-update`}>Update</Label>
        <Textarea id={`${projectCode}-update`} name="body" required maxLength={ACTION_BODY_MAX_LENGTH} rows={3} placeholder="Tulis update-nya" />
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post update"}
        </Button>
      </div>
    </form>
  );
}
