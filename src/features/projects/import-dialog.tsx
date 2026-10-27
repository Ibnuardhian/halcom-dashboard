"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "./import-wizard";

/**
 * Importing projects from Excel, in a modal that opens from the Projects page: download the template, drop the file, match the columns,
 * check and import. Closing it starts the next import from scratch, and the list is refreshed so imported projects show at once.
 */
export function ImportDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  // A new key drops everything the wizard held (file, mapping, result) when the modal closes.
  const [session, setSession] = useState(0);

  return (
    <>
      <Button type="button" variant="outline" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Upload aria-hidden data-icon="inline-start" />
        Export/Import (xlsx)
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[92svh] w-[min(64rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClose={() => {
          setSession((value) => value + 1);
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
                Import projects
              </h2>
              <p className="text-sm text-muted-foreground">Add many projects from an Excel sheet. Every row is checked before anything is written; projects that already exist are skipped, never changed.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => dialog.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          <ImportWizard key={session} onClose={() => dialog.current?.close()} />
        </div>
      </dialog>
    </>
  );
}
