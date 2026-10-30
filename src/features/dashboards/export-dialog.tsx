"use client";

import { useRef } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPORT_COLUMNS } from "@/domain/projects/export";

const GROUPS = [...new Set(EXPORT_COLUMNS.map((column) => column.group))];

/**
 * A button that opens the column picker in a modal; the picker is not on the page until it is asked for. Pick the
 * columns, then download. The form is a plain GET to the export route, so the download works without any script;
 * the other buttons only tick or clear the boxes and close the modal (Escape closes it too).
 */
export function ExportDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const setAll = (checked: boolean) => form.current?.querySelectorAll<HTMLInputElement>('input[name="c"]').forEach((box) => (box.checked = checked));

  return (
    <>
      <Button type="button" variant="outline" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Download aria-hidden data-icon="inline-start" />
        Export data
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="export-title"
        className="m-auto max-h-[90svh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself) closes the modal.
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <form ref={form} action="/export/projects" method="get" onSubmit={() => setTimeout(() => dialog.current?.close(), 0)} className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="export-title" className="text-base font-semibold">
                Export projects
              </h2>
              <p className="text-sm text-muted-foreground">Pilih kolom, lalu unduh sebagai Excel (.xlsx) atau CSV. Semua project ikut diekspor.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => dialog.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          {GROUPS.map((group) => (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-semibold text-muted-foreground">{group}</legend>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {EXPORT_COLUMNS.filter((column) => column.group === group).map((column) => (
                  <label key={column.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="c" value={column.key} defaultChecked={column.preset} className="size-4 accent-primary" />
                    {column.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button type="submit" name="format" value="xlsx">
              <Download aria-hidden data-icon="inline-start" />
              Export Excel (.xlsx)
            </Button>
            <Button type="submit" name="format" value="import" variant="outline">
              Export in import format (.xlsx)
            </Button>
            <Button type="submit" name="format" value="csv" variant="outline">
              CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => setAll(true)}>
              Select all
            </Button>
            <Button type="button" variant="outline" onClick={() => setAll(false)}>
              Clear
            </Button>
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
