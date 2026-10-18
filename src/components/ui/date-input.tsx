"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "defaultValue" | "onChange" | "ref"> & {
  /** What the date is, for the clear button's accessible name ("Clear Quote released"). */
  label: string;
  /** The stored date as `YYYY-MM-DD`, or empty. */
  defaultValue?: string;
};

/**
 * A date field with a button that clears it. The button shows only while the field has a value. A cleared field is submitted as
 * an empty string, which the server stores as "no date".
 */
export function DateInput({ label, defaultValue = "", className, ...props }: Props) {
  const [value, setValue] = useState(defaultValue);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2">
      <Input {...props} ref={input} type="date" value={value} onChange={(event) => setValue(event.target.value)} className={cn("min-w-0 flex-1", className)} />
      {value !== "" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Clear ${label}`}
          onClick={() => {
            setValue("");
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
