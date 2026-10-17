"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { caretAfterGrouping, formatStoredAmount, groupThousands } from "@/domain/projects/amount-format";

type Props = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "inputMode"> & { defaultValue?: string; grouped?: boolean };

/**
 * A text box for money that puts a dot between every three digits while it is typed ("2.500.000.000"), so long amounts are
 * easy to read and check. The form sends the grouped text; the server reads it. With `grouped={false}` it is a plain box
 * (used when the same box takes a percentage).
 */
export function MoneyInput({ defaultValue = "", grouped = true, maxLength = 40, ...props }: Props) {
  const [value, setValue] = useState(() => (grouped ? formatStoredAmount(defaultValue) : defaultValue));
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caret.current !== null && input.current && document.activeElement === input.current) input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  return (
    <Input
      {...props}
      ref={input}
      inputMode={grouped ? "numeric" : "decimal"}
      maxLength={maxLength}
      value={value}
      onChange={(event) => {
        const raw = event.target.value;
        if (!grouped) return setValue(raw);
        const digitsBeforeCaret = raw.slice(0, event.target.selectionStart ?? raw.length).replace(/\D/g, "").length;
        const next = groupThousands(raw);
        caret.current = caretAfterGrouping(next, digitsBeforeCaret);
        setValue(next);
      }}
    />
  );
}
