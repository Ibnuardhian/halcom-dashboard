"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INDUSTRY_MAX_LENGTH } from "@/domain/customers/industry";
import { createIndustryAction } from "./actions";

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

/** What the industry list is for, shown above it. */
export function IndustryNote() {
  return <>Pilihan industri di halaman Customers. Mengubah nama ikut mengubah customer yang memakainya; industri hanya bisa dihapus bila tidak ada customer atau project yang memakainya.</>;
}
