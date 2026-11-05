"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { unlockAction } from "./actions";

/** Opens one lock; the page lists the lock again without it. */
export function UnlockButton({ id, label }: { id: string; label: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(unlockAction, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Unlock ${label}`}>
        {pending ? "Opening…" : "Unlock"}
      </Button>
      <FormStatus state={state} />
    </form>
  );
}
