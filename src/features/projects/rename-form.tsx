"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameProjectAction } from "./actions";

/** Superadmin, Admin and SOA (the page decides): correct the name of a project. */
export function RenameProjectForm({ projectId, projectCode, name }: { projectId: string; projectCode: string; name: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(renameProjectAction, null);
  return (
    <form key={name} action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <Label htmlFor={`rename-${projectCode}`}>Nama project</Label>
      <div className="flex gap-2">
        <Input id={`rename-${projectCode}`} name="name" defaultValue={name} maxLength={160} required autoComplete="off" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Menyimpan…" : "Ubah nama"}
        </Button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}
