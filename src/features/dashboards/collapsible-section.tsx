/**
 * A dashboard block that opens and closes (a native details element, so it needs no script and works before the page is interactive).
 * `open` is the state on arrival; the viewer's choice is not remembered.
 */
export function CollapsibleSection({
  id,
  title,
  note,
  open = true,
  children,
}: {
  id: string;
  title: string;
  /** A short line after the title that stays visible when the section is closed (for example a count). */
  note?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} data-testid={`section-${id}`} className="group mb-6 rounded-xl ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-base font-semibold select-none marker:content-none">
        <span aria-hidden="true" className="inline-block text-muted-foreground transition-transform group-open:rotate-90">
          ▸
        </span>
        <h2>{title}</h2>
        {note ? <span className="text-sm font-normal text-muted-foreground">{note}</span> : null}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          <span className="group-open:hidden">Open</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
