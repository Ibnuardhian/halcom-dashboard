/**
 * The words of a Save button: "Save" on screen, and what it saves for screen readers ("Save commercial details"). The rest is text
 * in the button, not an aria-label, so it never matches the label of a field next to it ("Details", "Industry", "PIC").
 */
export function SaveText({ what, pending = false }: { what: string; pending?: boolean }) {
  if (pending) return <>Saving…</>;
  return (
    <>
      Save<span className="sr-only"> {what}</span>
    </>
  );
}
