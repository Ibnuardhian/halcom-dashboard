import { SOURCE_LABELS, type ProjectSourceType } from "./source";
import { PROGRESS_LABELS, TRACK_STATUS_LABELS, type ProjectProgress, type TrackStatus } from "./progress";

/** One project as the export sees it: plain values, already resolved (names, not ids). */
export type ExportProject = {
  code: string;
  accountName: string;
  projectTitle: string;
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  lastUpdated: Date;
  quoteReleasedAt: Date | null;
  estimatedValue: number | null;
  probability: number | null;
  weightedValue: number | null;
  targetMargin: number | null;
  estimatedGrossProfit: number | null;
  finalValue: number | null;
  targetDate: Date | null;
  wonDate: Date | null;
  /** Null for a project from another source: it has no internal Sales PIC. */
  salesPic: string | null;
  sourceType: ProjectSourceType;
  externalSourceName: string | null;
  externalContact: string | null;
  externalReference: string | null;
  sourceNotes: string | null;
  technicalPic: string | null;
  principal: string | null;
  solution: string | null;
  industry: string | null;
  location: string | null;
  currentAction: string | null;
  nextAction: string | null;
  openRequests: number;
  totalRequests: number;
};

export type ExportCell = string | number | null;

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const minute = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ");

/**
 * The columns a person can pick for the export, in the order they appear in the file. Numbers stay numbers (no
 * thousands separators) so the file can be summed in a spreadsheet; dates are ISO (`2026-10-31`).
 */
export const EXPORT_COLUMNS = [
  { key: "code", label: "Project ID", value: (p: ExportProject): ExportCell => p.code, group: "Project", preset: true },
  { key: "progress", label: "Progress", value: (p) => PROGRESS_LABELS[p.progress], group: "Project", preset: true },
  { key: "status", label: "Status", value: (p) => TRACK_STATUS_LABELS[p.trackStatus], group: "Project", preset: true },
  { key: "lastUpdated", label: "Last Updated", value: (p) => minute(p.lastUpdated), group: "Project", preset: true },
  { key: "quoteReleased", label: "Quote Released", value: (p) => day(p.quoteReleasedAt), group: "Project", preset: true },
  { key: "accountName", label: "Account Name", value: (p) => p.accountName, group: "Project", preset: true },
  { key: "projectTitle", label: "Project Title", value: (p) => p.projectTitle, group: "Project", preset: true },
  { key: "source", label: "Project Source", value: (p) => SOURCE_LABELS[p.sourceType], group: "Source", preset: true },
  { key: "externalSource", label: "External Sales Company", value: (p) => p.externalSourceName, group: "Source", preset: false },
  { key: "externalContact", label: "External Sales Contact", value: (p) => p.externalContact, group: "Source", preset: false },
  { key: "externalReference", label: "External Reference", value: (p) => p.externalReference, group: "Source", preset: false },
  { key: "sourceNotes", label: "Source Notes", value: (p) => p.sourceNotes, group: "Source", preset: false },
  { key: "industry", label: "Industry", value: (p) => p.industry, group: "Project", preset: false },
  { key: "location", label: "Location", value: (p) => p.location, group: "Project", preset: false },
  { key: "principal", label: "Principal", value: (p) => p.principal, group: "Project", preset: false },
  { key: "solution", label: "Solution", value: (p) => p.solution, group: "Project", preset: false },
  { key: "estimatedValue", label: "Estimated PO Value", value: (p) => p.estimatedValue, group: "Money", preset: true },
  { key: "probability", label: "Probability (%)", value: (p) => p.probability, group: "Money", preset: false },
  { key: "weightedValue", label: "Weighted Value", value: (p) => p.weightedValue, group: "Money", preset: false },
  { key: "targetMargin", label: "Target Margin (%)", value: (p) => p.targetMargin, group: "Money", preset: false },
  { key: "estimatedGrossProfit", label: "Estimated Gross Profit", value: (p) => p.estimatedGrossProfit, group: "Money", preset: true },
  { key: "finalValue", label: "Final Value", value: (p) => p.finalValue, group: "Money", preset: false },
  { key: "targetDate", label: "Target Closing", value: (p) => day(p.targetDate), group: "Dates", preset: false },
  { key: "wonDate", label: "Won Date", value: (p) => day(p.wonDate), group: "Dates", preset: false },
  { key: "salesPic", label: "Sales PIC", value: (p) => p.salesPic, group: "People", preset: false },
  { key: "technicalPic", label: "Technical PIC", value: (p) => p.technicalPic, group: "People", preset: false },
  { key: "currentAction", label: "Current Action", value: (p) => p.currentAction, group: "Progress notes", preset: false },
  { key: "nextAction", label: "Next Action", value: (p) => p.nextAction, group: "Progress notes", preset: false },
  { key: "openRequests", label: "Open Requests", value: (p) => p.openRequests, group: "Requests", preset: false },
  { key: "totalRequests", label: "Total Requests", value: (p) => p.totalRequests, group: "Requests", preset: false },
] as const satisfies readonly {
  key: string;
  label: string;
  value: (project: ExportProject) => ExportCell;
  group: string;
  preset: boolean;
}[];

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];

export const EXPORT_COLUMN_KEYS: readonly string[] = EXPORT_COLUMNS.map((column) => column.key);

/** The submitted column keys that exist, in file order and without duplicates; unknown keys are dropped. */
export function chooseColumns(requested: readonly string[]): (typeof EXPORT_COLUMNS)[number][] {
  const wanted = new Set(requested);
  return EXPORT_COLUMNS.filter((column) => wanted.has(column.key));
}
