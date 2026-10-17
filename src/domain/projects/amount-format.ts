/**
 * Money as it is typed: digits only, a dot between every group of three ("2500000000" -> "2.500.000.000"). The server
 * reads that form back (parseAmount). Anything that is not a digit is dropped.
 */
export function groupThousands(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** A stored amount shown in the same form; an amount with cents (never entered by the form) is left as it is. */
export function formatStoredAmount(stored: string): string {
  return /^\d+$/.test(stored) ? groupThousands(stored) : stored;
}

/** Where the caret goes after regrouping: after the same number of digits it was after before. */
export function caretAfterGrouping(formatted: string, digitsBeforeCaret: number): number {
  if (digitsBeforeCaret <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i]!)) seen += 1;
    if (seen === digitsBeforeCaret) return i + 1;
  }
  return formatted.length;
}
