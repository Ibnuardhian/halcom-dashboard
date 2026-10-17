"use client";

import { useActionState, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteProjectAction } from "./actions";

/** Superadmin only (the page decides). A modal asks for the project number before anything is deleted. */
export function DeleteProject({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(deleteProjectAction, null);

  return (
    <>
      <Button type="button" variant="destructive" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Trash2 aria-hidden data-icon="inline-start" />
        Delete project
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="delete-title"
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <h2 id="delete-title" className="text-base font-semibold">
              Delete {projectCode}?
            </h2>
            <p className="text-sm text-muted-foreground">
              The project disappears from every list, chart, target figure and export, and so do its requests. Its history and the audit log are kept.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-confirm">Type {projectCode} to confirm</Label>
            <Input id="delete-confirm" name="confirmCode" autoComplete="off" required />
          </div>
          <FormStatus state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Delete project"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
