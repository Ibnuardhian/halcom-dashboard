"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shown when a page under the signed-in shell fails to load (a database hiccup, a bug). The person keeps the menu and can retry;
 * nothing about the failure beyond a reference is printed, so internals are not leaked.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server logs the details; the browser console only gets the reference.
    console.error("Page failed to load", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-destructive/30 p-8 text-center">
      <h1 className="font-heading text-xl font-semibold">Halaman tidak bisa dimuat</h1>
      <p className="text-sm text-muted-foreground">Terjadi kesalahan saat memuat halaman ini. Muat ulang halaman. Jika masih gagal, kirim referensi{error.digest ? ` ${error.digest}` : ""} ke administrator.</p>
      <Button type="button" onClick={reset}>
        Muat ulang
      </Button>
    </div>
  );
}
