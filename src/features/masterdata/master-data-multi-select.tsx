"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { filterMasterOptions, hasExactMatch, MASTER_KIND_LABELS, MAX_PROJECT_PRINCIPALS, type MasterKind, type MasterOption } from "@/domain/projects/master-data";
import { cn } from "@/lib/utils";
import { createMasterRecordAction } from "./actions";

/**
 * A searchable multi-select over a master-data list (the Principals of a project). The chosen records show as chips, each with a button
 * that removes it; the dropdown only offers records that are not chosen yet, so the same record cannot be added twice. A name that is
 * not in the list is created only through the explicit "Create" button (when allowed); a name that already exists selects the existing
 * record. The chosen ids are submitted, in order, as repeated hidden fields called `name`.
 */
export function MasterDataMultiSelect({
  kind,
  name,
  initialOptions,
  initialIds,
  canCreate,
}: {
  kind: MasterKind;
  name: string;
  initialOptions: readonly MasterOption[];
  initialIds: readonly string[];
  canCreate: boolean;
}) {
  const label = MASTER_KIND_LABELS[kind];
  const inputId = useId();
  const listId = useId();
  const [options, setOptions] = useState<readonly MasterOption[]>(initialOptions);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(initialIds);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = selectedIds.map((id) => options.find((option) => option.id === id)).filter((option): option is MasterOption => option !== undefined);
  const available = useMemo(() => options.filter((option) => !selectedIds.includes(option.id)), [options, selectedIds]);
  const matches = useMemo(() => filterMasterOptions(available, typed), [available, typed]);
  const full = selectedIds.length >= MAX_PROJECT_PRINCIPALS;
  // "Create" is offered only for a name that is neither chosen nor already a record.
  const mayCreate = canCreate && !full && typed.trim() !== "" && !hasExactMatch(options, typed);

  function add(option: MasterOption) {
    setSelectedIds((current) => (current.includes(option.id) || current.length >= MAX_PROJECT_PRINCIPALS ? current : [...current, option.id]));
    setTyped("");
    setOpen(false);
    setActive(0);
    setMessage(null);
  }

  function remove(id: string) {
    setSelectedIds((current) => current.filter((existing) => existing !== id));
    setMessage(null);
  }

  function create() {
    const wanted = typed;
    startTransition(async () => {
      const result = await createMasterRecordAction(kind, wanted);
      if (result.ok) {
        setOptions((current) => [...current, { id: result.id, name: result.name }].sort((a, b) => a.name.localeCompare(b.name)));
        add({ id: result.id, name: result.name });
        setMessage(`${label} "${result.name}" created and added.`);
      } else if (result.existing) {
        const existing = result.existing;
        setOptions((current) => (current.some((option) => option.id === existing.id) ? current : [...current, existing].sort((a, b) => a.name.localeCompare(b.name))));
        add(existing);
        setMessage(`${label} "${existing.name}" sudah ada, jadi langsung ditambahkan.`);
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}s</Label>
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {selected.length > 0 ? (
        <ul aria-label={`Chosen ${label.toLowerCase()}s`} className="flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <li key={option.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/50 py-0.5 pr-0.5 pl-2 text-sm">
              {option.name}
              <button
                type="button"
                aria-label={`Remove ${option.name}`}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => remove(option.id)}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No {label.toLowerCase()} chosen yet.</p>
      )}
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={typed}
        disabled={full}
        placeholder={full ? `Maksimal ${MAX_PROJECT_PRINCIPALS} ${label.toLowerCase()}` : `Cari atau tambah ${label.toLowerCase()}`}
        maxLength={120}
        className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 md:text-sm dark:bg-input/30"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
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
            // Enter adds the highlighted option; it never submits the form or creates a record.
            event.preventDefault();
            const option = matches[active];
            if (open && option) add(option);
          } else if (event.key === "Backspace" && typed === "" && selectedIds.length > 0) {
            setSelectedIds((current) => current.slice(0, -1));
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && !full ? (
        <ul id={listId} role="listbox" aria-label={`${label} options`} className="absolute top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
          {matches.map((option, index) => (
            <li key={option.id} role="option" aria-selected={false}>
              <button
                type="button"
                className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-muted", index === active && "bg-muted")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(option)}
              >
                {option.name}
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="px-2 py-1.5 text-muted-foreground">{typed.trim() === "" ? `Every ${label.toLowerCase()} is already chosen.` : `No ${label.toLowerCase()} matches.`}</li> : null}
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
