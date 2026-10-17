"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, null);

  return (
    <form action={formAction} className="grid max-w-md gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <Input id="current-password" name="currentPassword" type="password" required autoComplete="current-password" maxLength={128} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">12 to 128 characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input id="confirm-password" name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
