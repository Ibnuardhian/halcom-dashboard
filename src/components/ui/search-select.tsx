"use client";

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { filterMasterOptions, type MasterOption } from "@/domain/projects/master-data";
import { cn } from "@/lib/utils";

/**
 * A searchable drop-down over a fixed list of `{ id, name }` options: type to filter, pick with the mouse or the arrow keys and Enter.
 * The chosen id is submitted in a hidden field called `name`; nothing can be created here (see MasterDataSelect for that). With
 * `required`, the form cannot be submitted until an option is chosen.
 */
export function SearchSelect({
  id,
  name,
  label,
  options,
  required = false,
  placeholder = "Search",
}: {
  id: string;
  name: string;
  /** What the options are ("salesperson"), for the accessible names of the list and the clear button. */
  label: string;
  options: readonly MasterOption[];
  required?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const [selectedId, setSelectedId] = useState("");
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const matches = useMemo(() => filterMasterOptions(options, typed), [options, typed]);
  const shown = editing ? typed : (selected?.name ?? "");

  function choose(option: MasterOption | null) {
    setSelectedId(option?.id ?? "");
    setEditing(false);
    setTyped("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        // The hidden field carries the value, so the visible box cannot satisfy `required` by itself: it is required while nothing is chosen.
        required={required && selectedId === ""}
        maxLength={120}
        className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        onFocus={() => {
          setEditing(true);
          setTyped("");
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setEditing(false);
        }}
        onChange={(event) => {
          setEditing(true);
          setTyped(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            // Enter picks the highlighted option; it never submits the form.
            event.preventDefault();
            const option = matches[active];
            if (open && option) choose(option);
          } else if (event.key === "Escape") {
            setOpen(false);
            setEditing(false);
          }
        }}
      />
      {selectedId !== "" ? (
        <button
          type="button"
          aria-label={`Clear ${label}`}
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(null)}
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
      {open ? (
        <ul id={listId} role="listbox" aria-label={`${label} options`} className="absolute top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
          {matches.map((option, index) => (
            <li key={option.id} role="option" aria-selected={option.id === selectedId}>
              <button
                type="button"
                className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-muted", index === active && "bg-muted", option.id === selectedId && "font-medium")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option.name}
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="px-2 py-1.5 text-muted-foreground">No {label} matches.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
