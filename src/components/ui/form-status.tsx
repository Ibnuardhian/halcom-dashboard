export type FormState = { ok: boolean; message: string } | null;

/** Result line under a form: a polite status on success, an alert on failure. */
export function FormStatus({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
      {state.message}
    </p>
  );
}
