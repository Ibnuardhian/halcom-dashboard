import type { ProjectStage } from "./pipeline";
import type { ProjectStatus } from "@/domain/requests/types";

/**
 * Sales' progress scale: the Progress column of their tracking sheet. Each step carries the win probability it stands
 * for. Keep in sync with `enum ProjectProgress` in prisma/schema.prisma.
 */
export const PROJECT_PROGRESSES = ["QUALIFY", "UNDERSTAND", "PROPOSE", "NEGOTIATE", "NEGOTIATE_FU", "AGREE", "CLOSED_WON", "CLOSED_LOST"] as const;
export type ProjectProgress = (typeof PROJECT_PROGRESSES)[number];

export const PROGRESS_PERCENT: Record<ProjectProgress, number> = {
  QUALIFY: 5,
  UNDERSTAND: 15,
  PROPOSE: 30,
  NEGOTIATE: 60,
  NEGOTIATE_FU: 60,
  AGREE: 95,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

const PROGRESS_NAME: Record<ProjectProgress, string> = {
  QUALIFY: "Qualify",
  UNDERSTAND: "Understand",
  PROPOSE: "Propose",
  NEGOTIATE: "Negotiate",
  NEGOTIATE_FU: "Negotiate (FU)",
  AGREE: "Agree",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
};

/** "30% - Propose": the wording of the sheet's drop-down. */
export const PROGRESS_LABELS = Object.fromEntries(PROJECT_PROGRESSES.map((p) => [p, `${PROGRESS_PERCENT[p]}% - ${PROGRESS_NAME[p]}`])) as Record<ProjectProgress, string>;

export const CLOSED_PROGRESSES: readonly ProjectProgress[] = ["CLOSED_WON", "CLOSED_LOST"];

export function isProgress(value: unknown): value is ProjectProgress {
  return typeof value === "string" && (PROJECT_PROGRESSES as readonly string[]).includes(value);
}

/** The Status column of the sheet. Keep in sync with `enum TrackStatus` in prisma/schema.prisma. */
export const TRACK_STATUSES = ["ON_TRACK", "ON_HOLD", "DONE", "BLOCK"] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export const TRACK_STATUS_LABELS: Record<TrackStatus, string> = {
  ON_TRACK: "On Track",
  ON_HOLD: "On Hold",
  DONE: "Done",
  BLOCK: "Block",
};

export function isTrackStatus(value: unknown): value is TrackStatus {
  return typeof value === "string" && (TRACK_STATUSES as readonly string[]).includes(value);
}

/**
 * Starting values for projects that existed before Progress and Status were added (the migration applies the same
 * mapping in SQL) and for rows read from the older sales export. An assumption, not data: Sales correct them.
 */
export function progressFromStage(stage: ProjectStage): ProjectProgress {
  switch (stage) {
    case "NEW_OPPORTUNITY":
      return "QUALIFY";
    case "ASSESSMENT":
      return "UNDERSTAND";
    case "SIZING_BOQ":
    case "POC":
    case "QUOTATION":
      return "PROPOSE";
    case "NEGOTIATION":
      return "NEGOTIATE";
    case "WON":
      return "CLOSED_WON";
    case "LOST":
      return "CLOSED_LOST";
  }
}

export function trackStatusFromStatus(status: ProjectStatus): TrackStatus {
  switch (status) {
    case "ACTIVE":
    case "WON":
      return "ON_TRACK";
    case "ON_HOLD":
      return "ON_HOLD";
    case "COMPLETED":
    case "CLOSED":
    case "LOST":
      return "DONE";
  }
}
