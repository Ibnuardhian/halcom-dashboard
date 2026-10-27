import { parseAmount } from "./commercial";
import { cleanName, nameKey } from "./pipeline";
import { MAX_PROJECT_PRINCIPALS } from "./master-data";
import { PROGRESS_LABELS, PROGRESS_PERCENT, PROJECT_PROGRESSES, TRACK_STATUSES, TRACK_STATUS_LABELS, type ProjectProgress, type TrackStatus } from "./progress";
import type { ExportProject } from "./export";
import { SOURCE_FIELD_LIMITS, SOURCE_LABELS, type ProjectSourceType } from "./source";

/**
 * Importing projects from an Excel sheet. This module is the pure part: which fields can be imported, how a sheet's columns are
 * matched to them, and how one row is read and checked. Looking people and master data up, duplicate detection and writing are the
 * server's (src/server/import/xlsx-projects.ts), which also repeats every check, because nothing the browser sends is trusted.
 */

export const IMPORT_FIELD_KEYS = [
  "endUser",
  "name",
  "code",
  "description",
  "salesPic",
  "source",
  "externalSourceName",
  "progress",
  "status",
  "estimatedValue",
  "targetMarginAmount",
  "targetMarginPercent",
  "quoteReleasedAt",
  "targetDate",
  "principals",
  "solution",
  "industry",
  "location",
  "currentAction",
  "nextAction",
  "lastUpdated",
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELD_KEYS)[number];

export type ImportField = { key: ImportFieldKey; label: string; required: boolean; hint?: string; synonyms: readonly string[] };

export const IMPORT_FIELDS: readonly ImportField[] = [
  { key: "endUser", label: "End user", required: true, synonyms: ["end user", "end user company", "customer", "account", "account name", "company", "client"] },
  { key: "name", label: "Project name", required: true, synonyms: ["project", "project name", "project title", "title", "opportunity"] },
  { key: "code", label: "Project ID", required: false, hint: "HIT-PROJ-001 style. Empty: the next number is given. A number that exists is a duplicate.", synonyms: ["project id", "project code", "id", "code", "no"] },
  { key: "description", label: "Description", required: false, synonyms: ["description", "details", "scope", "notes"] },
  { key: "salesPic", label: "Sales PIC", required: false, hint: "The email or the exact name of an active salesperson. Required for Internal Sales.", synonyms: ["sales pic", "sales", "salesperson", "sales person", "pic sales", "owner", "sales name"] },
  { key: "source", label: "Project source", required: false, hint: "Internal Sales (default) or Other.", synonyms: ["project source", "source", "source type"] },
  { key: "externalSourceName", label: "External sales name", required: false, hint: "Required when the source is Other.", synonyms: ["external sales name", "external source", "external sales", "external company", "sales company"] },
  { key: "progress", label: "Progress", required: false, hint: "For example 30% - Propose, Propose or PROPOSE. Empty: Qualify.", synonyms: ["progress", "stage", "pipeline stage"] },
  { key: "status", label: "Status", required: false, hint: "On Track, On Hold, Done or Block. Empty: On Track.", synonyms: ["status", "track status", "project status"] },
  { key: "estimatedValue", label: "Estimated PO value", required: false, synonyms: ["estimated po value", "estimated value", "value", "amount", "po value", "estimated"] },
  { key: "targetMarginAmount", label: "Target margin (amount)", required: false, synonyms: ["target margin amount", "estimated gross profit", "gross profit", "margin amount", "gp"] },
  { key: "targetMarginPercent", label: "Target margin (%)", required: false, synonyms: ["target margin", "target margin %", "margin %", "margin percent", "margin"] },
  { key: "quoteReleasedAt", label: "Quote released", required: false, synonyms: ["quote released", "quotation date", "quote date", "quotation released"] },
  { key: "targetDate", label: "Target closing", required: false, synonyms: ["target closing", "target date", "closing date", "target close", "expected close"] },
  { key: "principals", label: "Principals", required: false, hint: "Several principals are separated by ; or a new line.", synonyms: ["principals", "principal", "brand", "brands", "vendor"] },
  { key: "solution", label: "Solution", required: false, synonyms: ["solution", "solution category", "category"] },
  { key: "industry", label: "Industry", required: false, synonyms: ["industry", "sector", "vertical"] },
  { key: "location", label: "Location", required: false, synonyms: ["location", "city", "site"] },
  { key: "currentAction", label: "Current action", required: false, synonyms: ["current action", "current", "last action", "update"] },
  { key: "nextAction", label: "Next action", required: false, synonyms: ["next action", "next step", "next"] },
  { key: "lastUpdated", label: "Last updated", required: false, hint: "Filled by the export. Used only when updating: a project changed since the export is refused.", synonyms: ["last updated", "updated", "updated at", "last update"] },
];

export const IMPORT_FIELD_BY_KEY = Object.fromEntries(IMPORT_FIELDS.map((field) => [field.key, field])) as Record<ImportFieldKey, ImportField>;

/** For each field, the zero-based column of the sheet that holds it, or null when the sheet has none. */
export type ColumnMapping = Record<ImportFieldKey, number | null>;

const squashHeader = (text: string) => text.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/**
 * Matches the sheet's headers to the fields by name. An exact name wins over a synonym; a column is given to one field only, and a
 * field takes its first match. It is a suggestion: the person sees it and changes it before anything is checked.
 */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const mapping = Object.fromEntries(IMPORT_FIELD_KEYS.map((key) => [key, null])) as ColumnMapping;
  const taken = new Set<number>();
  const squashed = headers.map(squashHeader);
  for (const pass of ["label", "synonym"] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field.key] !== null) continue;
      const names = pass === "label" ? [squashHeader(field.label)] : field.synonyms.map(squashHeader);
      const column = squashed.findIndex((header, index) => header !== "" && !taken.has(index) && names.includes(header));
      if (column >= 0) {
        mapping[field.key] = column;
        taken.add(column);
      }
    }
  }
  return mapping;
}

/** Checks a mapping that came from outside: columns inside the sheet, none used twice, every required field present. */
export function checkMapping(input: unknown, columnCount: number): { ok: true; mapping: ColumnMapping } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, message: "Pemetaan kolom belum ada." };
  const record = input as Record<string, unknown>;
  const mapping = Object.fromEntries(IMPORT_FIELD_KEYS.map((key) => [key, null])) as ColumnMapping;
  const used = new Set<number>();
  for (const key of Object.keys(record)) {
    if (!(IMPORT_FIELD_KEYS as readonly string[]).includes(key)) return { ok: false, message: `"${key}" bukan field yang dapat diimpor.` };
  }
  for (const key of IMPORT_FIELD_KEYS) {
    const value = record[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= columnCount) return { ok: false, message: `Kolom yang dipilih untuk ${IMPORT_FIELD_BY_KEY[key].label} tidak ada di sheet.` };
    if (used.has(value)) return { ok: false, message: "Satu kolom dipilih untuk dua field. Setiap kolom hanya boleh dipakai sekali." };
    used.add(value);
    mapping[key] = value;
  }
  const missing = IMPORT_FIELDS.filter((field) => field.required && mapping[field.key] === null).map((field) => field.label);
  if (missing.length > 0) return { ok: false, message: `Pilih kolom untuk ${missing.join(" dan ")}.` };
  return { ok: true, mapping };
}

/** One row of the sheet as text per field (empty text for a field with no column or no value). */
export type RawImportRow = Record<ImportFieldKey, string>;

export function rowToRaw(cells: readonly string[], mapping: ColumnMapping): RawImportRow {
  return Object.fromEntries(IMPORT_FIELD_KEYS.map((key) => [key, mapping[key] === null ? "" : (cells[mapping[key]!] ?? "").trim()])) as RawImportRow;
}

/** A row that passed the checks that need no database. */
export type ImportRow = {
  code: string | null;
  endUser: string;
  name: string;
  description: string | null;
  sourceType: ProjectSourceType;
  /** Email or exact name as written; the server resolves it to one active salesperson. */
  salesPic: string | null;
  externalSourceName: string | null;
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  estimatedValue: number | null;
  targetMarginAmount: number | null;
  targetMarginPercent: number | null;
  quoteReleasedAt: string | null;
  targetDate: string | null;
  principals: string[];
  solution: string | null;
  industry: string | null;
  location: string | null;
  currentAction: string | null;
  nextAction: string | null;
};

export type RowCheck = { ok: true; value: ImportRow } | { ok: false; errors: string[] };

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9%]+/g, "");

/** Reads a progress as written: the code, the sheet's label, the name, or the name with its meaning. Ambiguous or unknown: null. */
export function parseProgressText(text: string): ProjectProgress | null {
  const wanted = squash(text);
  if (wanted === "") return null;
  for (const progress of PROJECT_PROGRESSES) {
    const names = [progress, PROGRESS_LABELS[progress], PROGRESS_LABELS[progress].replace(/^\d+%\s*-\s*/, "")];
    if (progress === "PROPOSE") names.push("Propose (Submit Quotation)", "30% - Propose (Submit Quotation)", "Submit Quotation");
    if (names.some((name) => squash(name) === wanted)) return progress;
  }
  return null;
}

export function parseTrackStatusText(text: string): TrackStatus | null {
  const wanted = squash(text);
  return TRACK_STATUSES.find((status) => squash(status) === wanted || squash(TRACK_STATUS_LABELS[status]) === wanted) ?? null;
}

/** `YYYY-MM-DD` as written, or day first (`31/12/2026`, `31-12-2026`, `31.12.2026`); a real calendar date, or null. */
export function parseDateText(text: string): string | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(value);
  const day = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : day ? [Number(day[3]), Number(day[2]), Number(day[1])] : null;
  if (!parts) return null;
  const [year, month, date] = parts as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, date));
  if (year < 1990 || year > 2100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  return check.toISOString().slice(0, 10);
}

/** The principals in one cell: separated by ";" or a new line, tidied, once each (ignoring case). */
export function splitPrincipals(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of text.split(/[;\n\r]+/)) {
    const name = cleanName(part);
    if (name === "" || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    names.push(name);
  }
  return names;
}

const PROJECT_CODE = /^HIT-PROJ-\d{3,}$/;
const LIMITS = { endUser: 120, name: 120, description: 2000, name120: 120, industry: 120, location: 120, action: 2000 } as const;

/**
 * Reads and checks one row without the database: required fields, lengths, the lists (progress, status, source), numbers, dates
 * and the rules between fields. Every problem of the row is reported together, so one pass shows everything to fix.
 */
export function checkImportRow(raw: RawImportRow): RowCheck {
  const errors: string[] = [];
  const text = (value: string, label: string, max: number): string | null => {
    const clean = value.trim();
    if (clean.length > max) errors.push(`${label} lebih panjang dari ${max} karakter.`);
    return clean === "" ? null : clean;
  };

  const endUser = text(cleanName(raw.endUser), "End user", LIMITS.endUser);
  if (!endUser) errors.push("End user wajib diisi.");
  const name = text(cleanName(raw.name), "Project name", LIMITS.name);
  if (!name) errors.push("Project name wajib diisi.");
  const description = text(raw.description, "Description", LIMITS.description);

  let code: string | null = null;
  if (raw.code !== "") {
    code = raw.code.trim().toUpperCase();
    if (!PROJECT_CODE.test(code)) {
      errors.push(`Project ID "${raw.code}" harus berbentuk HIT-PROJ-001.`);
      code = null;
    }
  }

  let sourceType: ProjectSourceType = "INTERNAL_SALES";
  if (raw.source !== "") {
    const wanted = squash(raw.source);
    if (["internalsales", "internal", "sales"].includes(wanted)) sourceType = "INTERNAL_SALES";
    else if (["other", "external", "othersource"].includes(wanted)) sourceType = "OTHER";
    else errors.push(`Project source "${raw.source}" harus Internal Sales atau Other.`);
  }
  const salesPic = text(raw.salesPic, "Sales PIC", 200);
  const externalSourceName = text(cleanName(raw.externalSourceName), "External sales name", SOURCE_FIELD_LIMITS.externalSourceName);
  if (sourceType === "INTERNAL_SALES") {
    if (!salesPic) errors.push("Sales PIC wajib diisi untuk proyek Internal Sales.");
    if (externalSourceName) errors.push("Proyek Internal Sales tidak memiliki nama sales eksternal. Ubah source menjadi Other, atau kosongkan sel itu.");
  } else {
    if (!externalSourceName) errors.push("External sales name wajib diisi bila source-nya Other.");
    if (salesPic) errors.push("Proyek dari sumber lain tidak memiliki Sales PIC internal. Kosongkan sel Sales PIC, atau ubah source menjadi Internal Sales.");
  }

  let progress: ProjectProgress = "QUALIFY";
  if (raw.progress !== "") {
    const parsed = parseProgressText(raw.progress);
    if (parsed) progress = parsed;
    else errors.push(`Progress "${raw.progress}" bukan salah satu dari: ${PROJECT_PROGRESSES.map((p) => `${PROGRESS_PERCENT[p]}% ${PROGRESS_LABELS[p].replace(/^\d+%\s*-\s*/, "")}`).join(", ")}.`);
  }
  let trackStatus: TrackStatus = "ON_TRACK";
  if (raw.status !== "") {
    const parsed = parseTrackStatusText(raw.status);
    if (parsed) trackStatus = parsed;
    else errors.push(`Status "${raw.status}" harus On Track, On Hold, Done, atau Block.`);
  }

  const amount = (value: string, label: string): number | null => {
    const result = parseAmount(label, value);
    if (!result.ok) {
      errors.push(result.message);
      return null;
    }
    return result.value;
  };
  const estimatedValue = amount(raw.estimatedValue, "Estimated PO value");
  const targetMarginAmount = amount(raw.targetMarginAmount, "Target margin (amount)");
  let targetMarginPercent: number | null = null;
  if (raw.targetMarginPercent !== "") {
    const normal = raw.targetMarginPercent.replace("%", "").replace(",", ".").trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(normal) || Number(normal) > 100) errors.push("Target margin (%) harus 0 sampai 100 (maksimal dua desimal).");
    else targetMarginPercent = Number(normal);
  }
  if (targetMarginAmount !== null && targetMarginPercent !== null) errors.push("Isi target margin sebagai persentase atau sebagai nominal, tidak keduanya.");

  const date = (value: string, label: string): string | null => {
    if (value === "") return null;
    const parsed = parseDateText(value);
    if (!parsed) errors.push(`${label} "${value}" bukan tanggal yang valid. Gunakan YYYY-MM-DD atau DD/MM/YYYY.`);
    return parsed;
  };
  const quoteReleasedAt = date(raw.quoteReleasedAt, "Quote released");
  const targetDate = date(raw.targetDate, "Target closing");

  const principals = splitPrincipals(raw.principals);
  if (principals.length > MAX_PROJECT_PRINCIPALS) errors.push(`Satu proyek maksimal memiliki ${MAX_PROJECT_PRINCIPALS} principal.`);
  if (principals.some((principal) => principal.length > 120)) errors.push("Nama principal lebih panjang dari 120 karakter.");

  const solution = text(cleanName(raw.solution), "Solution", 120);
  const industry = text(cleanName(raw.industry), "Industry", LIMITS.industry);
  const location = text(cleanName(raw.location), "Location", LIMITS.location);
  const currentAction = text(raw.currentAction, "Current action", LIMITS.action);
  const nextAction = text(raw.nextAction, "Next action", LIMITS.action);

  // Control characters other than tab and new line have no place in these fields.
  for (const [label, value] of Object.entries({ endUser, name, description, salesPic, externalSourceName, solution, industry, location, currentAction, nextAction })) {
    if (value && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) errors.push(`${label} berisi karakter yang tidak diizinkan.`);
  }

  if (errors.length > 0 || !endUser || !name) return { ok: false, errors };
  return {
    ok: true,
    value: {
      code,
      endUser,
      name,
      description,
      sourceType,
      salesPic,
      externalSourceName,
      progress,
      trackStatus,
      estimatedValue,
      targetMarginAmount,
      targetMarginPercent,
      quoteReleasedAt,
      targetDate,
      principals,
      solution,
      industry,
      location,
      currentAction,
      nextAction,
    },
  };
}

/** What makes two rows the same project when no Project ID is given: the end user and the project name, ignoring case and spacing. */
export function projectIdentity(endUser: string, name: string): string {
  return `${nameKey(endUser)}\u0000${nameKey(name)}`;
}

/** The first row of the downloadable template: one column per field, a required one marked with * (the column matcher ignores the mark). */
export function templateHeaders(): string[] {
  return IMPORT_FIELDS.map((field) => (field.required ? `${field.label} *` : field.label));
}

const dayOf = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);

/**
 * One exported project as a row of the import template: the same columns in the same order as `templateHeaders()`, written the way the
 * import reads them, so the file can be imported again as it is (a Project ID that exists is then a duplicate and is skipped).
 */
export function importRowOf(project: ExportProject): (string | number | null)[] {
  const cells: Record<ImportFieldKey, string | number | null> = {
    endUser: project.accountName,
    name: project.projectTitle,
    code: project.code,
    description: project.description,
    salesPic: project.salesPic,
    source: SOURCE_LABELS[project.sourceType],
    externalSourceName: project.externalSourceName,
    progress: PROGRESS_LABELS[project.progress],
    status: TRACK_STATUS_LABELS[project.trackStatus],
    estimatedValue: project.estimatedValue,
    // The import takes a percentage or an amount, never both: the one that was entered wins.
    targetMarginAmount: project.marginPercentInput === null ? project.marginAmountInput : null,
    targetMarginPercent: project.marginPercentInput,
    quoteReleasedAt: dayOf(project.quoteReleasedAt),
    targetDate: dayOf(project.targetDate),
    principals: project.principal,
    solution: project.solution,
    industry: project.industry,
    location: project.location,
    currentAction: project.currentAction,
    nextAction: project.nextAction,
    lastUpdated: project.lastUpdated.toISOString(),
  };
  return IMPORT_FIELD_KEYS.map((key) => cells[key]);
}
