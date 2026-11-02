"use client";

import { useId, useRef } from "react";
import { Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailPanel } from "./email-panel";

type EmailPanelProps = React.ComponentProps<typeof EmailPanel>;

/**
 * The email text of a request, in a modal that opens from a button: the page stays short, and the text is there when a mail has
 * to be sent. The content is the same copy-and-paste panel as before (To, Cc, subject, text, and the Outlook draft button).
 */
export function EmailDialog({ tag, ...panel }: EmailPanelProps & { tag: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button type="button" variant="outline" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Mail aria-hidden data-icon="inline-start" />
        Send email {tag}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[92svh] w-[min(52rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                Email text {tag}
              </h2>
              <p className="text-sm text-muted-foreground">Subjek, penerima, dan isi email request ini. Buka draf di Outlook, atau salin tiap bagian.</p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => dialog.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          <EmailPanel {...panel} />
        </div>
      </dialog>
    </>
  );
}
