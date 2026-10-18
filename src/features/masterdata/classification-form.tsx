"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import type { MasterOption } from "@/domain/projects/master-data";
import { setProjectMasterDataAction } from "./actions";
import { MasterDataMultiSelect } from "./master-data-multi-select";
import { MasterDataSelect } from "./master-data-select";

/** SOA classify a project with one or more Principals and a Solution, each chosen from its own searchable list (or created with the explicit button). */
export function ClassificationForm({
  projectId,
  projectCode,
  principals,
  solutions,
  principalIds,
  solutionId,
  canCreate,
}: {
  projectId: string;
  projectCode: string;
  principals: readonly MasterOption[];
  solutions: readonly MasterOption[];
  principalIds: readonly string[];
  solutionId: string;
  canCreate: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(setProjectMasterDataAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <div className="grid gap-4 sm:grid-cols-2">
        <MasterDataMultiSelect kind="principal" name="principalIds" initialOptions={principals} initialIds={principalIds} canCreate={canCreate} />
        <MasterDataSelect kind="solution" name="solutionId" initialOptions={solutions} initialId={solutionId} canCreate={canCreate} />
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save classification"}
        </Button>
      </div>
    </form>
  );
}
