"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INDUSTRY_MAX_LENGTH } from "@/domain/customers/industry";
import { saveCustomerIndustryAction } from "./actions";

/**
 * The customer's name as a button that opens a window with the customer's details to fill in (the industry). The industry box suggests
 * the ones already in use, so the same industry is spelled the same way. Closes itself once saved. Without `canEdit` the details are
 * shown but cannot be changed.
 */
export function CustomerDialog({
  customer,
  listId,
  canEdit,
  projectsHref,
}: {
  customer: { id: string; name: string; industry: string | null; projects: number };
  /** The id of a `<datalist>` on the page that holds the industries already in use. */
  listId: string;
  canEdit: boolean;
  projectsHref: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveCustomerIndustryAction, null);
  const id = useId();

  // Closes the window after a successful save (the page behind it refreshes with the new industry).
  useEffect(() => {
    if (state?.ok && state.message !== "Nothing changed.") dialog.current?.close();
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
            <Input
              id={`${id}-industry`}
              name="industry"
              list={listId}
              defaultValue={customer.industry ?? ""}
              maxLength={INDUSTRY_MAX_LENGTH}
              placeholder="for example Banking, Manufacturing, Education"
              readOnly={!canEdit}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {canEdit
                ? "Pick a suggestion to keep the spelling the same, or type a new one. Charts, filters and exports use it for every project of this customer. Leave it empty to clear."
                : "You can read the industry but not change it."}
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
      </dialog>
    </>
  );
}
