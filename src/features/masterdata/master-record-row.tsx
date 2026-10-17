"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import type { MasterKind } from "@/domain/projects/master-data";
import { deleteMasterRecordAction, renameMasterRecordAction } from "./actions";

/** One Principal or Solution on the master data page: rename it, or delete it when no project uses it. */
export function MasterRecordRow({ kind, id, name, projectCount }: { kind: MasterKind; id: string; name: string; projectCount: number }) {
  const [renamed, rename, renaming] = useActionState<FormState, FormData>(renameMasterRecordAction, null);
  const [deleted, remove, deleting] = useActionState<FormState, FormData>(deleteMasterRecordAction, null);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <form action={rename} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <Input name="name" defaultValue={name} maxLength={120} required aria-label={`Name of ${name}`} className="max-w-sm" />
          <Button type="submit" variant="outline" size="sm" disabled={renaming}>
            Rename
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          {projectCount} project{projectCount === 1 ? "" : "s"}
        </span>
        <form action={remove}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="destructive" size="sm" disabled={deleting || projectCount > 0} title={projectCount > 0 ? "In use: it cannot be deleted" : undefined} aria-label={`Delete ${name}`}>
            Delete
          </Button>
        </form>
      </div>
      <FormStatus state={renamed} />
      <FormStatus state={deleted} />
    </li>
  );
}
