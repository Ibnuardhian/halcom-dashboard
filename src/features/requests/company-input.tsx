"use client";

import { useEffect, useState } from "react";
import { filterMasterOptions, type MasterOption } from "@/domain/projects/master-data";
import { Input } from "@/components/ui/input";

/** How long typing must stop before the existing customers that match are offered. */
export const COMPANY_SUGGEST_DELAY_MS = 1000;

/**
 * The End-user company box. It stays free text (a new company is created when the project is saved), and once typing has paused
 * for a second it offers the existing customers that match, so the same company is not written twice in different ways.
 */
export function CompanyInput({ id, name, customers }: { id: string; name: string; customers: readonly MasterOption[] }) {
  const [value, setValue] = useState("");
  const [settled, setSettled] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), COMPANY_SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);

  // Only what was typed and then left alone for the delay is searched; an exact match needs no suggestion.
  const matches = settled.trim() === "" || settled !== value ? [] : filterMasterOptions(customers, settled).filter((option) => option.name !== value).slice(0, 8);
  const listId = `${id}-suggestions`;

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        required
        maxLength={120}
        placeholder="PT ABC"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="Customer yang sudah ada" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
          <li className="px-2 py-1 text-xs text-muted-foreground">Customer yang sudah ada:</li>
          {matches.map((option) => (
            <li key={option.id} role="option" aria-selected={false}>
              {/* onMouseDown, because the box loses focus (and closes the list) before a click would arrive. */}
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setValue(option.name);
                  setSettled(option.name);
                  setOpen(false);
                }}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
