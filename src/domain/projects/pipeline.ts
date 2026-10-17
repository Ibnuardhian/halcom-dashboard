import { PROGRESS_PERCENT, type ProjectProgress } from "@/domain/projects/progress";
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectStatus } from "@/domain/requests/types";

/**
 * The stage and status columns of the older sales export. They are read only while importing a file, and become the
 * project's Progress and Status (progress.ts); the project table no longer uses them.
 */
export const PROJECT_STAGES = [
  "NEW_OPPORTUNITY",
  "ASSESSMENT",
  "SIZING_BOQ",
  "POC",
  "QUOTATION",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  NEW_OPPORTUNITY: "New Opportunity",
  ASSESSMENT: "Assessment",
  SIZING_BOQ: "Sizing / BOQ",
  POC: "POC",
  QUOTATION: "Quotation",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

/** Older exports wrote "Sizing / BOM"; the stage is now called "Sizing / BOQ", and both are accepted. */
export function parseStage(label: string): ProjectStage | null {
  const wanted = label.trim().toLowerCase().replace(/\bbom\b/g, "boq");
  return PROJECT_STAGES.find((stage) => PROJECT_STAGE_LABELS[stage].toLowerCase() === wanted) ?? null;
}

export type ProjectStatusValue = ProjectStatus;

/** Matches a status label ("On Hold", "on hold") to its value; null when unknown. */
export function parseProjectStatus(label: string): ProjectStatusValue | null {
  const wanted = label.trim().toLowerCase();
  return PROJECT_STATUSES.find((status) => PROJECT_STATUS_LABELS[status].toLowerCase() === wanted) ?? null;
}

/**
 * Weighted pipeline value: estimated value times the win probability the Progress step stands for (30% at Propose).
 * A project with no estimate contributes nothing instead of a guessed number.
 */
export function weightedValue(estimatedValue: number | null, progress: ProjectProgress): number | null {
  if (estimatedValue === null) return null;
  return Math.round(estimatedValue * PROGRESS_PERCENT[progress]) / 100;
}

/** Master-data key: trimmed, single-spaced, lower-cased, so "HPE" and " hpe " are one record. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * The margin Sales aims for, in money. A fixed amount entered by Sales is used as it is; otherwise it is the sale value times
 * the target margin percentage. The value is the final value once it is known, otherwise the estimate. Empty when neither
 * an amount nor a percentage with a value is there, never a guess.
 */
export function targetMarginAmount(
  estimatedValue: number | null,
  finalValue: number | null,
  targetMarginPercent: number | null,
  fixedAmount: number | null = null,
): number | null {
  if (fixedAmount !== null) return fixedAmount;
  const basis = finalValue ?? estimatedValue;
  if (basis === null || targetMarginPercent === null) return null;
  return Math.round(basis * targetMarginPercent) / 100;
}

/** The target margin as a percentage of the sale: the entered percentage, or the fixed amount over the sale value. */
export function targetMarginPercentOf(
  estimatedValue: number | null,
  finalValue: number | null,
  targetMarginPercent: number | null,
  fixedAmount: number | null = null,
): number | null {
  if (fixedAmount === null) return targetMarginPercent;
  const basis = finalValue ?? estimatedValue;
  return basis === null || basis === 0 ? null : Math.round((fixedAmount / basis) * 10_000) / 100;
}
