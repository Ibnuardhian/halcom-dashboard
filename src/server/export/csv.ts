/**
 * A text cell that starts with = + - @ (or a tab or carriage return) would run as a formula when the file is opened in
 * Excel, so a single quote is put in front and Excel shows it as plain text. Numbers are exempt: a negative
 * number is a number, not a formula.
 */
function cell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n;]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/**
 * CSV for Excel: UTF-8 with a byte-order mark (so accents and symbols survive), CRLF line ends, quotes doubled.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const lines = [headers.map((header) => cell(header)).join(","), ...rows.map((row) => row.map(cell).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
