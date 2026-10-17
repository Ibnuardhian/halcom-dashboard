/**
 * Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, and line breaks inside quotes.
 * Returns every record as an array of strings (an empty unquoted field is ""). A blank line is skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    const lastWasQuoted = fieldWasQuoted;
    endField();
    // A line with nothing on it is skipped; a quoted "" is a real (empty) field.
    if (!(row.length === 1 && row[0] === "" && !lastWasQuoted)) rows.push(row);
    row = [];
  };

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop a UTF-8 byte order mark
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      endRow();
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new Error("The CSV ends inside a quoted field.");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Turns records into objects keyed by the header row. A record with a different field count is reported, not guessed at. */
export function recordsWithHeader(rows: string[][]): { records: Record<string, string>[]; problems: string[] } {
  const [header, ...body] = rows;
  if (!header) return { records: [], problems: ["The CSV is empty."] };
  const problems: string[] = [];
  const records: Record<string, string>[] = [];
  body.forEach((row, index) => {
    if (row.length !== header.length) {
      problems.push(`Row ${index + 2} has ${row.length} fields, expected ${header.length}.`);
      return;
    }
    records.push(Object.fromEntries(header.map((name, column) => [name, row[column]!])));
  });
  return { records, problems };
}
