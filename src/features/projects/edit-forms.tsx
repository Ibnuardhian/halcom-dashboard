"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_EDITABLE_FIELDS, type ProjectEditableField } from "@/domain/projects/fields";
import { removeTechnicalSectionAction, updateProjectDetailsAction } from "./actions";

type Values = Partial<Record<ProjectEditableField, string | null>>;

/**
 * Edits a group of fields of one project. Every save is written to the change log (who, which field,
 * from what, to what). `values` are the stored values. With `optional`, only the sections that already have text are shown and
 * the others are added with a button when there is something to write, so the page does not fill up with empty boxes.
 *
 * A section can be removed again. One that was never saved goes away at once (whatever was typed in it is dropped). One with saved
 * text asks first; confirming clears just that section, and the change log keeps what it said. Other sections, and what has been
 * typed in them but not yet saved, are left alone.
 */
export function ProjectFieldsForm({
  projectId,
  projectCode,
  fields,
  values,
  submitLabel,
  formKey,
  rows = 3,
  optional = false,
}: {
  projectId: string;
  projectCode: string;
  fields: readonly ProjectEditableField[];
  values: Values;
  submitLabel: string;
  /** Changes after every save, so the fields are rebuilt from the stored values while this component (and its result message) stays mounted. */
  formKey: string;
  rows?: number;
  optional?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateProjectDetailsAction, null);
  const [added, setAdded] = useState<readonly ProjectEditableField[]>([]);
  // Sections whose saved text was cleared by a confirmed removal in this visit (the page props still carry the old text).
  const [cleared, setCleared] = useState<readonly ProjectEditableField[]>([]);
  const [confirming, setConfirming] = useState<ProjectEditableField | null>(null);
  const [removal, setRemoval] = useState<FormState>(null);
  const [removing, startRemoval] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  const saved = (field: ProjectEditableField) => Boolean(values[field]) && !cleared.includes(field);
  const visible = optional ? fields.filter((field) => saved(field) || added.includes(field)) : fields;
  const hidden = fields.filter((field) => !visible.includes(field));

  function askToRemove(field: ProjectEditableField) {
    setRemoval(null);
    if (!saved(field)) {
      // Nothing saved: remove it right away.
      setAdded((current) => current.filter((name) => name !== field));
      return;
    }
    setConfirming(field);
    dialog.current?.showModal();
  }

  function confirmRemoval() {
    const field = confirming;
    if (!field) return;
    startRemoval(async () => {
      const result = await removeTechnicalSectionAction(projectId, projectCode, field);
      setRemoval(result);
      if (result?.ok) {
        setCleared((current) => [...current, field]);
        setAdded((current) => current.filter((name) => name !== field));
      }
      setConfirming(null);
      dialog.current?.close();
    });
  }

  return (
    <>
      <form key={formKey} action={formAction} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="projectCode" value={projectCode} />
        {visible.map((field) => {
          const id = `${projectCode}-${field}`;
          const label = PROJECT_EDITABLE_FIELDS[field].label;
          return (
            <div key={field} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={id}>{label}</Label>
                {optional ? (
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${label}`} onClick={() => askToRemove(field)}>
                    <X aria-hidden data-icon="inline-start" />
                    Remove
                  </Button>
                ) : null}
              </div>
              <Textarea id={id} name={field} defaultValue={cleared.includes(field) ? "" : (values[field] ?? "")} maxLength={4000} rows={rows} className="min-h-0" autoFocus={added.at(-1) === field} />
            </div>
          );
        })}
        {optional && visible.length === 0 ? <p className="text-sm text-muted-foreground sm:col-span-2">Belum ada detail teknis. Isi yang berlaku.</p> : null}
        {optional && hidden.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Add:</span>
            {hidden.map((field) => (
              <Button key={field} type="button" variant="outline" size="sm" aria-label={`Add ${PROJECT_EDITABLE_FIELDS[field].label}`} onClick={() => setAdded((current) => [...current, field])}>
                <Plus aria-hidden data-icon="inline-start" />
                {PROJECT_EDITABLE_FIELDS[field].label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <FormStatus state={removal} />
          <FormStatus state={state} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </div>
      </form>
      <dialog
        ref={dialog}
        aria-labelledby={`${projectCode}-remove-title`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClose={() => setConfirming(null)}
      >
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h2 id={`${projectCode}-remove-title`} className="text-base font-semibold">
              Remove {confirming ? PROJECT_EDITABLE_FIELDS[confirming].label : "this section"}?
            </h2>
            <p className="text-sm text-muted-foreground">
              Its saved text is cleared from the project. The change log keeps what it said and who removed it. Other sections are not touched.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={removing} onClick={confirmRemoval}>
              {removing ? "Removing…" : "Remove section"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
