"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import {
  changeRoleAction,
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  type ActionState,
} from "./actions";

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function Status({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
      {state.message}
    </p>
  );
}

function RoleOptions({ roles }: { roles: readonly Role[] }) {
  return roles.map((role) => (
    <option key={role} value={role}>
      {ROLE_LABELS[role]}
    </option>
  ));
}

export function CreateUserForm({ roles }: { roles: readonly Role[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createUserAction, null);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-name">Name</Label>
        <Input id="new-name" name="name" required maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-email">Email</Label>
        <Input id="new-email" name="email" type="email" required maxLength={254} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-role">Role</Label>
        <select id="new-role" name="role" required defaultValue="" className={SELECT_CLASS}>
          <option value="" disabled>
            Select a role
          </option>
          <RoleOptions roles={roles} />
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Initial password</Label>
        <Input id="new-password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </Button>
      <div className="sm:col-span-2 lg:col-span-5">
        <Status state={state} />
      </div>
    </form>
  );
}

export function RoleForm({ userId, currentRole, roles, label }: { userId: string; currentRole: Role; roles: readonly Role[]; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changeRoleAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <select name="role" defaultValue={currentRole} aria-label={`Role for ${label}`} className={SELECT_CLASS}>
          <RoleOptions roles={roles} />
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ActiveForm({ userId, isActive, label }: { userId: string; isActive: boolean; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(setActiveAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={String(!isActive)} />
      <Button type="submit" variant={isActive ? "destructive" : "outline"} size="sm" disabled={pending} aria-label={`${isActive ? "Deactivate" : "Reactivate"} ${label}`}>
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function ResetPasswordForm({ userId, label }: { userId: string; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(resetPasswordAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <Input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" aria-label={`New password for ${label}`} placeholder="New password" className="w-40" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Reset
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}
