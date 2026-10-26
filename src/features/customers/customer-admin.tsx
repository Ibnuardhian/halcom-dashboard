"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { mergeCustomersAction, renameCustomerAction } from "./actions";

/**
 * Superadmin, inside the customer window: correct the name of a customer, or merge it into another one that is the same company written
 * differently. Both change the end user shown on every project of the customer, so the merge asks once more before it goes ahead.
 */
export function CustomerAdmin({ customer, others }: { customer: { id: string; name: string; projects: number }; others: { id: string; name: string }[] }) {
  const [renamed, rename, renaming] = useActionState<FormState, FormData>(renameCustomerAction, null);
  const [merged, merge, merging] = useActionState<FormState, FormData>(mergeCustomersAction, null);
  const [targetId, setTargetId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const target = others.find((other) => other.id === targetId);

  return (
    <div className="flex flex-col gap-4 border-t p-5">
      <form action={rename} className="flex flex-col gap-1.5">
        <input type="hidden" name="customerId" value={customer.id} />
        <Label htmlFor={`rename-${customer.id}`}>Ubah nama customer</Label>
        <div className="flex gap-2">
          <Input id={`rename-${customer.id}`} name="name" defaultValue={customer.name} maxLength={120} required autoComplete="off" />
          <Button type="submit" variant="outline" disabled={renaming}>
            {renaming ? "Menyimpan…" : "Ubah nama"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Dipakai untuk typo. Nama baru tampil di {customer.projects} project customer ini.</p>
        <FormStatus state={renamed} />
      </form>

      <form action={merge} className="flex flex-col gap-1.5">
        <input type="hidden" name="sourceId" value={customer.id} />
        <input type="hidden" name="targetId" value={targetId} />
        <Label htmlFor={`merge-${customer.id}`}>Gabungkan ke customer lain</Label>
        <NativeSelect
          id={`merge-${customer.id}`}
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value);
            setConfirming(false);
          }}
        >
          <option value="">Pilih customer tujuan</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">Untuk nama yang sama dengan penulisan berbeda, misalnya PNP dan Politeknik Negeri Padang. Semua project pindah ke customer tujuan dan customer ini dihapus.</p>
        {confirming && target ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
            <p>
              Gabungkan <strong>{customer.name}</strong> ke <strong>{target.name}</strong>? {customer.projects} project akan memakai nama {target.name}. Ini tidak bisa dibatalkan.
            </p>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={merging}>
                {merging ? "Menggabungkan…" : "Ya, gabungkan"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
                Batal
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" variant="outline" disabled={targetId === ""} onClick={() => setConfirming(true)}>
              Gabungkan…
            </Button>
          </div>
        )}
        <FormStatus state={merged} />
      </form>
    </div>
  );
}
