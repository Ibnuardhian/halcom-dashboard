"use client";

import { useActionState, useId, useRef } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { PROJECT_COLUMNS, type ProjectColumnKey } from "@/domain/projects/table-columns";
import { saveProjectColumnsAction } from "@/features/settings/actions";

/** The Superadmin's button above the Projects table: opens a window to choose which columns the table shows, for everyone. */
export function ColumnSettings({ shown }: { shown: readonly ProjectColumnKey[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [state, save, saving] = useActionState<FormState, FormData>(saveProjectColumnsAction, null);

  return (
    <>
      <Button type="button" variant="outline" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Columns3 aria-hidden data-icon="inline-start" />
        Kolom tabel
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-left text-card-foreground shadow-xl backdrop:bg-black/40"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {/* Keyed by the saved columns so the boxes show what is saved after a save (a form is reset by React after an action). */}
        <form key={shown.join()} action={save} className="flex flex-col gap-4 p-5">
          <div>
            <h2 id={`${id}-title`} className="font-heading text-lg font-semibold">
              Kolom tabel Projects
            </h2>
            <p className="text-sm text-muted-foreground">Pilihan ini berlaku untuk semua pengguna. Project ID selalu tampil.</p>
          </div>
          <fieldset className="grid gap-2">
            <legend className="sr-only">Kolom yang tampil</legend>
            {PROJECT_COLUMNS.map((column) => (
              <label key={column.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="column" value={column.key} defaultChecked={shown.includes(column.key)} className="size-4" />
                {column.label}
              </label>
            ))}
          </fieldset>
          <FormStatus state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Tutup
            </Button>
            <Button aria-label="Save columns" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
