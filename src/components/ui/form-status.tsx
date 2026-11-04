"use client";

import { useEffect } from "react";
import { toast } from "./toast";

export type FormState = { ok: boolean; message: string } | null;

/**
 * The result of a form. Every result shows as a toast. A failure also stays under the form as an alert, so the person can read
 * it while fixing the input; a success needs no line of its own.
 */
export function FormStatus({ state }: { state: FormState }) {
  useEffect(() => {
    if (state) toast(state.message, state.ok, state);
  }, [state]);
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}
