"use client";

import { useActionState, useId, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteRequestAction } from "./actions";

/** Superadmin and Admin (the panel decides). A modal asks for the request code before anything is deleted. */
export function DeleteRequest({ requestId, requestCode }: { requestId: string; requestCode: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirmId = useId();
  const [state, formAction, pending] = useActionState<FormState, FormData>(deleteRequestAction, null);

  return (
    <>
      <Button type="button" variant="destructive" size="sm" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Trash2 aria-hidden data-icon="inline-start" />
        Hapus request
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="requestId" value={requestId} />
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              Hapus {requestCode}?
            </h2>
            <p className="text-sm text-muted-foreground">
              Request hilang dari semua daftar, board, dashboard, dan email. Riwayatnya tetap tercatat di audit log. Request yang sudah dilanjutkan
              (BOQ ke RFQ, RFQ ke PO) baru bisa dihapus setelah lanjutannya dihapus.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={confirmId}>Ketik {requestCode} untuk konfirmasi</Label>
            <Input id={confirmId} name="confirmCode" autoComplete="off" required />
          </div>
          <FormStatus state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Menghapus…" : "Hapus request"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
