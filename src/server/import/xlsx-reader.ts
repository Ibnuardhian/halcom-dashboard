import { strFromU8, unzipSync } from "fflate";

/**
 * Reads the first worksheet of an .xlsx workbook into rows of text. Only what an import needs: values (formulas are never run, their
 * stored result is read), shared and inline strings, numbers, booleans and dates. Anything else about the file (styles, formulas,
 * macros, other sheets) is ignored. The file is untrusted input, so size, row, column and text limits apply before anything large is
 * unpacked, and the XML is read with plain patterns (no entity expansion, no external resources).
 */

export const XLSX_LIMITS = {
  /** The compressed file. */
  fileBytes: 5 * 1024 * 1024,
  /** Everything unpacked from the file. */
  unpackedBytes: 40 * 1024 * 1024,
  rows: 5000,
  columns: 60,
  cellChars: 4000,
} as const;

export type SheetRows = {
  sheetName: string;
  /** Sheet row number (1-based) of each entry in `rows`, because empty rows are skipped but errors must name the real row. */
  rowNumbers: number[];
  /** The first non-empty row, as text. */
  headers: string[];
  /** Every later non-empty row, padded to the number of header columns. */
  rows: string[][];
};

export type ReadResult = { ok: true; sheet: SheetRows } | { ok: false; message: string };

const NEEDED = /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return codePoint(Number.parseInt(entity.slice(2), 16), whole);
    if (entity.startsWith("#")) return codePoint(Number.parseInt(entity.slice(1), 10), whole);
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

function codePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : fallback;
}

/** Column letters to a zero-based index: A -> 0, Z -> 25, AA -> 26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** The text of an `<si>` or `<is>` element: its `<t>` pieces joined (rich text is several runs; phonetic text is left out). */
function richText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1]!)).join("");
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => richText(match[1]!));
}

/** Built-in number formats that show a date or a time (ECMA-376 §18.8.30). */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** A custom format code is a date when it has a day, month or year part outside quotes and brackets. */
function isDateFormatCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(bare) && !/^(general|[0#?.,%e+\-() ]*)$/i.test(bare);
}

/** For each cell format index (`s="n"`), whether it shows a date. */
function readDateStyles(xml: string | undefined): Set<number> {
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g)) custom.set(Number(match[1]), decodeXml(match[2]!));
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  [...cellXfs.matchAll(/<xf\b[^>]*\bnumFmtId="(\d+)"/g)].forEach((match, index) => {
    const id = Number(match[1]);
    const code = custom.get(id);
    if (code === undefined ? BUILT_IN_DATE_FORMATS.has(id) : isDateFormatCode(code)) dateStyles.add(index);
  });
  return dateStyles;
}

/** An Excel date serial (1900 system, with its leap-year quirk) as `YYYY-MM-DD`; null when it is not a plausible date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  // Serial 60 is the non-existent 1900-02-29; later serials are one day ahead of the real calendar.
  const days = whole > 60 ? whole - 1 : whole;
  const date = new Date(Date.UTC(1899, 11, 31) + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function numberText(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  // 15 significant digits is what Excel itself shows, which removes binary noise such as 0.30000000000000004.
  return String(Number.parseFloat(value.toPrecision(15)));
}

function firstSheetPath(files: Record<string, Uint8Array>): { path: string; name: string } | null {
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const sheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  if (sheet) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(sheet)?.[1] ?? "Sheet1");
    const id = /\br:id="([^"]*)"/.exec(sheet)?.[1];
    for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (id && new RegExp(`\\bId="${id}"`).test(rel[0])) {
        const target = /\bTarget="([^"]*)"/.exec(rel[0])?.[1];
        if (target) {
          const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
          if (files[path]) return { path, name };
        }
      }
    }
  }
  // No usable relationship: the first worksheet file, which is where every generator puts the first sheet.
  const fallback = Object.keys(files).filter((path) => /^xl\/worksheets\/[^/]+\.xml$/.test(path)).sort()[0];
  return fallback ? { path: fallback, name: "Sheet1" } : null;
}

export function readXlsx(bytes: Uint8Array): ReadResult {
  if (bytes.byteLength === 0) return { ok: false, message: "The file is empty." };
  if (bytes.byteLength > XLSX_LIMITS.fileBytes) return { ok: false, message: `The file is larger than ${XLSX_LIMITS.fileBytes / 1024 / 1024} MB.` };
  // An .xlsx is a zip file: it starts with "PK".
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, message: "This is not an .xlsx workbook. Save the sheet as Excel Workbook (.xlsx) and try again." };

  let files: Record<string, Uint8Array>;
  try {
    let unpacked = 0;
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!NEEDED.test(file.name)) return false;
        unpacked += file.originalSize;
        if (unpacked > XLSX_LIMITS.unpackedBytes) throw new Error("too large");
        return true;
      },
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message === "too large" ? "The workbook unpacks to more than the allowed size." : "The file could not be opened as an .xlsx workbook." };
  }

  const sheet = firstSheetPath(files);
  if (!sheet) return { ok: false, message: "The workbook has no worksheet." };
  const xml = strFromU8(files[sheet.path]!);
  const shared = readSharedStrings(files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : undefined);
  const dateStyles = readDateStyles(files["xl/styles.xml"] ? strFromU8(files["xl/styles.xml"]) : undefined);

  const grid = new Map<number, string[]>();
  let widest = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1]!)?.[1]);
    const body = rowMatch[2];
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || !body) continue;
    if (rowNumber > XLSX_LIMITS.rows + 1) return { ok: false, message: `The sheet has more than ${XLSX_LIMITS.rows} rows. Split it into smaller files.` };
    const cells: string[] = [];
    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1]!;
      const ref = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      if (!ref) continue;
      const column = columnIndex(ref);
      if (column >= XLSX_LIMITS.columns) {
        if ((cellMatch[2] ?? "").includes("<v") || (cellMatch[2] ?? "").includes("<is")) return { ok: false, message: `The sheet has data beyond column ${XLSX_LIMITS.columns}.` };
        continue;
      }
      const type = /\bt="([^"]*)"/.exec(attributes)?.[1] ?? "n";
      const style = Number(/\bs="(\d+)"/.exec(attributes)?.[1] ?? 0);
      const inner = cellMatch[2] ?? "";
      const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      if (type === "inlineStr") text = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (rawValue === undefined) text = "";
      else if (type === "s") text = shared[Number(rawValue)] ?? "";
      else if (type === "str") text = decodeXml(rawValue);
      else if (type === "b") text = rawValue === "1" ? "TRUE" : "FALSE";
      else if (type === "e") text = "";
      else text = dateStyles.has(style) ? (excelSerialToIso(Number(rawValue)) ?? numberText(rawValue)) : numberText(rawValue);
      if (text.length > XLSX_LIMITS.cellChars) return { ok: false, message: `A cell in row ${rowNumber} holds more than ${XLSX_LIMITS.cellChars} characters.` };
      cells[column] = text;
      widest = Math.max(widest, column + 1);
    }
    if (cells.some((cell) => cell !== undefined && cell.trim() !== "")) grid.set(rowNumber, cells);
  }

  const numbers = [...grid.keys()].sort((a, b) => a - b);
  if (numbers.length === 0) return { ok: false, message: "The sheet has no data." };
  const pad = (cells: string[]) => Array.from({ length: widest }, (_, column) => (cells[column] ?? "").trim());
  const [headerRow, ...dataRows] = numbers;
  const headers = pad(grid.get(headerRow!)!);
  return { ok: true, sheet: { sheetName: sheet.name, headers, rowNumbers: dataRows, rows: dataRows.map((row) => pad(grid.get(row)!)) } };
}
