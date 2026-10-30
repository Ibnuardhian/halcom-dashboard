"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INDUSTRY_MAX_LENGTH } from "@/domain/customers/industry";
import { createIndustryAction, deleteIndustryAction, renameIndustryAction } from "./actions";

/** Admin and Superadmin: add an industry to the list a customer can be given. */
export function NewIndustryForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createIndustryAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-industry">Nama industri</Label>
        <Input id="new-industry" name="name" required maxLength={INDUSTRY_MAX_LENGTH} placeholder="contoh: Perbankan" autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah industri"}
      </Button>
      <div className="basis-full">
        <FormStatus state={state} />
      </div>
    </form>
  );
}

/** One industry: rename it (the customers on it follow), or delete it while nobody uses it. */
export function IndustryRow({ industry }: { industry: { id: string; name: string; customers: number } }) {
  const [renamed, rename, renaming] = useActionState<FormState, FormData>(renameIndustryAction, null);
  const [removed, remove, removing] = useActionState<FormState, FormData>(deleteIndustryAction, null);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <form key={industry.name} action={rename} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="id" value={industry.id} />
          <Input name="name" defaultValue={industry.name} maxLength={INDUSTRY_MAX_LENGTH} required aria-label={`Nama industri ${industry.name}`} className="max-w-xs" autoComplete="off" />
          <Button type="submit" variant="outline" size="sm" disabled={renaming}>
            Simpan
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">{industry.customers} customer</span>
        <form action={remove}>
          <input type="hidden" name="id" value={industry.id} />
          <Button type="submit" variant="destructive" size="sm" disabled={removing} aria-label={`Hapus industri ${industry.name}`}>
            Hapus
          </Button>
        </form>
      </div>
      <FormStatus state={renamed} />
      <FormStatus state={removed} />
    </li>
  );
}
