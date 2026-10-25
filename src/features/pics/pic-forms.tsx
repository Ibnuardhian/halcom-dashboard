"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { PIC_NAME_MAX_LENGTH, PIC_TEAM_LABELS, type PicTeam } from "@/domain/pics/teams";
import { createPicAction, renamePicAction, setPicActiveAction } from "./actions";

/** Adds a PIC to one team. */
export function AddPicForm({ team }: { team: PicTeam }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createPicAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="team" value={team} />
      <div className="flex items-center gap-2">
        <Input name="name" maxLength={PIC_NAME_MAX_LENGTH} required placeholder="Nama PIC" aria-label={`New ${PIC_TEAM_LABELS[team]} PIC`} className="max-w-sm" />
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add PIC"}
        </Button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

/** One PIC: rename it, or turn it off (and on again). A PIC is never deleted, so the history keeps its name. */
export function PicRow({ id, name, isActive, openRequests, totalRequests }: { id: string; name: string; isActive: boolean; openRequests: number; totalRequests: number }) {
  const [renamed, rename, renaming] = useActionState<FormState, FormData>(renamePicAction, null);
  const [toggled, toggle, toggling] = useActionState<FormState, FormData>(setPicActiveAction, null);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={rename} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Input name="name" defaultValue={name} maxLength={PIC_NAME_MAX_LENGTH} required aria-label={`Name of ${name}`} className="max-w-sm" />
          <Button type="submit" variant="outline" size="sm" disabled={renaming}>
            Rename
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          {isActive ? "Active" : "Inactive"} · {openRequests} open of {totalRequests} request{totalRequests === 1 ? "" : "s"}
        </span>
        <form action={toggle}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={isActive ? "false" : "true"} />
          <Button type="submit" variant={isActive ? "outline" : "default"} size="sm" disabled={toggling} aria-label={`${isActive ? "Deactivate" : "Activate"} ${name}`}>
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </form>
      </div>
      <FormStatus state={renamed} />
      <FormStatus state={toggled} />
    </li>
  );
}
