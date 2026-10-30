"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePen, FilePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportWizard, type ImportFlow } from "./import-wizard";

const COPY: Record<ImportFlow, { button: string; title: string; summary: string; Icon: typeof FilePlus }> = {
  create: {
    button: "Import projects",
    title: "Import new projects",
    summary: "Tambahkan banyak project dari satu sheet Excel. Project ID yang sudah ada dilewati.",
    Icon: FilePlus,
  },
  update: {
    button: "Update projects",
    title: "Update existing projects",
    summary: "Ubah banyak project sekaligus dari sheet Excel. Perubahan tercatat di Change log tiap project.",
    Icon: FilePen,
  },
};

/**
 * One Excel job per dialog, opened from its own button on the Projects page: adding new projects, or updating existing ones.
 * The wizard is mounted only while the dialog is open, so closing it starts the next job from scratch, and the list is
 * refreshed so the written projects show at once.
 */
export function ImportDialog({ flow }: { flow: ImportFlow }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { button, title, summary, Icon } = COPY[flow];

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
        <Icon aria-hidden data-icon="inline-start" />
        {button}
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
                {title}
              </h2>
              <p className="text-sm text-muted-foreground">{summary}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Tutup" onClick={() => dialog.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          {open ? <ImportWizard flow={flow} onClose={() => dialog.current?.close()} /> : null}
        </div>
      </dialog>
    </>
  );
}
