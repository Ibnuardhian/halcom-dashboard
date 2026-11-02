"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { saveCustomerIndustryAction } from "./actions";
import { CustomerAdmin } from "./customer-admin";

/**
 * The customer's name as a button that opens a window with the customer's details to fill in (the industry). The industry box suggests
 * the ones already in use, so the same industry is spelled the same way. Closes itself once saved. Without `canEdit` the details are
 * shown but cannot be changed.
 */
export function CustomerDialog({
  customer,
  industries,
  canEdit,
  projectsHref,
  others,
}: {
  customer: { id: string; name: string; industry: string | null; projects: number };
  /** The industries a customer can be given (the list a Superadmin edits). */
  industries: string[];
  canEdit: boolean;
  projectsHref: string;
  /** The other customers a Superadmin can merge this one into; absent for everyone else (who then see no rename or merge). */
  others?: { id: string; name: string }[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveCustomerIndustryAction, null);
  const id = useId();

  // Closes the window after a successful save (the page behind it refreshes with the new industry).
  useEffect(() => {
    if (state?.ok && state.message !== "Tidak ada perubahan.") dialog.current?.close();
  }, [state]);

  return (
    <>
      <button
        type="button"
        className="rounded-sm text-left text-primary underline-offset-4 outline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {customer.name}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        data-testid="customer-dialog"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/40"
        onClick={(event) => {
          // A click on the dimmed area outside the window closes it.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="customerId" value={customer.id} />
          <div>
            <h2 id={`${id}-title`} className="font-heading text-lg font-semibold">
              {customer.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {customer.projects} project{customer.projects === 1 ? "" : "s"}.{" "}
              <Link href={projectsHref} className="text-primary underline-offset-4 hover:underline">
                Open its projects
              </Link>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-industry`}>Industry</Label>
            <NativeSelect id={`${id}-industry`} name="industry" key={customer.industry ?? ""} defaultValue={customer.industry ?? ""} disabled={!canEdit}>
              <option value="">Belum diisi</option>
              {/* A name the customer already has stays selectable even if it is no longer in the list, so saving does not wipe it. */}
              {customer.industry && !industries.includes(customer.industry) ? <option value={customer.industry}>{customer.industry}</option> : null}
              {industries.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {canEdit
                ? "Pilih dari daftar industri. Grafik, filter, dan export memakainya untuk semua project customer ini. Daftarnya diubah Admin atau Superadmin di Master data."
                : "Anda bisa membaca industri tetapi tidak bisa mengubahnya."}
            </p>
          </div>
          <FormStatus state={state} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => dialog.current?.close()}>
              {canEdit ? "Cancel" : "Close"}
            </button>
            {canEdit ? (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save industry"}
              </Button>
            ) : null}
          </div>
        </form>
        {others ? <CustomerAdmin customer={{ id: customer.id, name: customer.name, projects: customer.projects }} others={others} /> : null}
      </dialog>
    </>
  );
}
