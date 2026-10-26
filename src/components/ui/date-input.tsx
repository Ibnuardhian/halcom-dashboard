"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "defaultValue" | "onChange" | "ref" | "name"> & {
  /** The form field the date is submitted under, as `YYYY-MM-DD` (or empty). */
  name: string;
  /** What the date is, for the clear button's accessible name ("Clear Quote released"). */
  label: string;
  /** The stored date as `YYYY-MM-DD`, or empty. */
  defaultValue?: string;
};

/** `2026-10-17` to `17/10/2026`; anything else shows as empty. */
export function isoToDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** `17/10/2026` to `2026-10-17`, or null when it is not a real calendar day. */
export function displayToIso(display: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const real = date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
  return real ? `${year}-${month}-${day}` : null;
}

/** Keeps only digits and puts the slashes in while typing: `17102026` shows as `17/10/2026`. */
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * A date field written as DD/MM/YYYY whatever the browser's language, with a button that clears it. The visible box is text; the form
 * receives the date as `YYYY-MM-DD` under `name`, and an empty string when cleared, which the server stores as "no date".
 */
export function DateInput({ label, name, defaultValue = "", className, required, ...props }: Props) {
  const [text, setText] = useState(isoToDisplay(defaultValue));
  const input = useRef<HTMLInputElement>(null);
  const iso = displayToIso(text);

  // A half-typed or impossible date blocks the form with a message instead of being silently dropped.
  useEffect(() => {
    input.current?.setCustomValidity(text !== "" && iso === null ? "Tulis tanggal dengan format DD/MM/YYYY, misalnya 17/10/2026." : "");
  }, [text, iso]);

  return (
    <div className="flex items-center gap-2">
      <Input
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        required={required}
        value={text}
        onChange={(event) => setText(mask(event.target.value))}
        className={cn("min-w-0 flex-1", className)}
      />
      <input type="hidden" name={name} value={iso ?? ""} />
      {text !== "" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Clear ${label}`}
          onClick={() => {
            setText("");
            input.current?.focus();
          }}
        >
          <X aria-hidden data-icon="inline-start" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
