"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { filterMasterOptions, hasExactMatch, MASTER_KIND_LABELS, type MasterKind, type MasterOption } from "@/domain/projects/master-data";
import { cn } from "@/lib/utils";
import { createMasterRecordAction } from "./actions";

/**
 * A searchable dropdown for a master-data list (Principal or Solution). Type to filter, pick with the mouse or the arrow keys and
 * Enter. A name that is not in the list is created only through the explicit "Create" button, never by typing alone; if the name
 * already exists the existing record is selected instead. The chosen id is sent in a hidden field named `name`.
 */
export function MasterDataSelect({
  kind,
  name,
  initialOptions,
  initialId,
  canCreate,
}: {
  kind: MasterKind;
  name: string;
  initialOptions: readonly MasterOption[];
  initialId: string;
  canCreate: boolean;
}) {
  const label = MASTER_KIND_LABELS[kind];
  const inputId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<readonly MasterOption[]>(initialOptions);
  const [selectedId, setSelectedId] = useState(initialId);
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = editing ? typed : (selected?.name ?? "");
  const matches = useMemo(() => filterMasterOptions(options, typed), [options, typed]);
  const mayCreate = canCreate && editing && typed.trim() !== "" && !hasExactMatch(options, typed);

  function choose(option: MasterOption | null) {
    setSelectedId(option?.id ?? "");
    setEditing(false);
    setTyped("");
    setOpen(false);
    setMessage(null);
  }

  function create() {
    const wanted = typed;
    startTransition(async () => {
      const result = await createMasterRecordAction(kind, wanted);
      if (result.ok) {
        setOptions((current) => [...current, { id: result.id, name: result.name }].sort((a, b) => a.name.localeCompare(b.name)));
        choose({ id: result.id, name: result.name });
        setMessage(`${label} "${result.name}" created and selected.`);
      } else if (result.existing) {
        const existing = result.existing;
        setOptions((current) => (current.some((option) => option.id === existing.id) ? current : [...current, existing]));
        choose(existing);
        setMessage(`${label} "${existing.name}" sudah ada, jadi langsung dipilih.`);
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <input type="hidden" name={name} value={selectedId} />
      <div className="relative">
        <input
          ref={input}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={shown}
          placeholder={`Cari atau pilih ${label.toLowerCase()}`}
          maxLength={120}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          onFocus={() => {
            setEditing(true);
            setTyped("");
            setOpen(true);
          }}
          onBlur={() => {
            // A click on an option or on Create comes first (onMouseDown below keeps focus), so closing here is safe.
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
              // Enter picks the highlighted option; it never submits the form or creates a record.
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
            className="absolute inset-y-0 right-1.5 my-auto flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(null)}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className="absolute top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg"
        >
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
          {matches.length === 0 ? <li className="px-2 py-1.5 text-muted-foreground">No {label.toLowerCase()} matches.</li> : null}
          {mayCreate ? (
            <li role="presentation" className="mt-1 border-t pt-1">
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" disabled={pending} onMouseDown={(event) => event.preventDefault()} onClick={create}>
                <Plus aria-hidden data-icon="inline-start" />
                Create {label} “{typed.trim()}”
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
