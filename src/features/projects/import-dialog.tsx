"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "./import-wizard";

/**
 * One dialog for Excel work on projects, in three steps: export or download a template, fill it in, upload it. Adding and updating share
 * one upload (a row is new or an update by its Project ID). The wizard is mounted only while the dialog is open,
 * so closing it starts the next job from scratch, and the list is refreshed so the written projects show at once.
 */
export function ImportDialog({ canCreate = true, canUpdate = false }: { canCreate?: boolean; canUpdate?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <ArrowUpDown aria-hidden data-icon="inline-start" />
        Import / Export
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[92svh] w-[min(64rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClose={() => {
          setOpen(false);
          router.refresh();
        }}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                Import / Export projects
              </h2>
              <p className="text-sm text-muted-foreground">Unduh data project, atau unggah satu sheet Excel: baris dengan Project ID memperbarui project itu, baris tanpa Project ID menjadi project baru. Setiap baris diperiksa dulu sebelum disimpan.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Tutup" onClick={() => dialog.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          {open ? <ImportWizard canCreate={canCreate} canUpdate={canUpdate} onClose={() => dialog.current?.close()} /> : null}
        </div>
      </dialog>
    </>
  );
}
