"use client";

import { useId, useRef } from "react";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The template filled with sample data, in a modal, so the settings page stays short. */
export function EmailPreview({ label, subject, body }: { label: string; subject: string; body: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button type="button" variant="outline" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Eye aria-hidden data-icon="inline-start" />
        Pratinjau {label}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[92svh] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                Pratinjau email {label}
              </h2>
              <p className="text-sm text-muted-foreground">Memakai data contoh. Request asli mengisi nilainya sendiri.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Tutup" onClick={() => dialog.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          <p className="font-mono text-xs break-words">
            <span className="text-muted-foreground">Subjek: </span>
            {subject}
          </p>
          <pre className="rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">{body}</pre>
        </div>
      </dialog>
    </>
  );
}
