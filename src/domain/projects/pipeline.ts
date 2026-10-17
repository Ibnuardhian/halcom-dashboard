import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectStatus } from "@/domain/requests/types";

/** Keep in sync with `enum ProjectStage` in prisma/schema.prisma. */
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

/** Stages that count as still being worked toward a deal. */
export const OPEN_STAGES: readonly ProjectStage[] = PROJECT_STAGES.filter((stage) => stage !== "WON" && stage !== "LOST");

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
 * Weighted pipeline value: estimated value times the win probability. Both must be known; a project
 * with no estimate or no probability contributes nothing instead of a guessed number.
 */
export function weightedValue(estimatedValue: number | null, probability: number | null): number | null {
  if (estimatedValue === null || probability === null) return null;
  return Math.round(estimatedValue * probability) / 100;
}

/** Master-data key: trimmed, single-spaced, lower-cased, so "HPE" and " hpe " are one record. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
