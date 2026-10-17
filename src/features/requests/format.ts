import { formatDateText } from "@/domain/requests/email";

/** A `DATE` column (stored as UTC midnight) as `5 Nov 2026`, or an en dash when empty. */
export function formatDateOnly(date: Date | null): string {
  return date ? formatDateText(date.toISOString().slice(0, 10)) : "–";
}

/** `2026-11-05` for an `<input type="date">` default. */
export function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}
