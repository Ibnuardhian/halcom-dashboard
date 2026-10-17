"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { createBackupAction } from "./actions";

export function BackupForm() {
  const [state, formAction, pending] = useActionState<FormState>(createBackupAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Backing up…" : "Create backup now"}
        </Button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}
