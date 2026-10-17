/** Keep in sync with `enum ProjectActionKind` in prisma/schema.prisma. */
export const ACTION_KINDS = ["CURRENT", "NEXT"] as const;
export type ProjectActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_KIND_LABELS: Record<ProjectActionKind, string> = {
  CURRENT: "Current action",
  NEXT: "Next action",
};

export const ACTION_KIND_HINTS: Record<ProjectActionKind, string> = {
  CURRENT: "What has been done (this week).",
  NEXT: "What will be done after the current action.",
};

/** The project page highlights the last two current actions: what was done most recently. */
export const LATEST_CURRENT_COUNT = 2;

export const ACTION_BODY_MAX_LENGTH = 4000;

export function isActionKind(value: unknown): value is ProjectActionKind {
  return typeof value === "string" && (ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * From a feed (newest first): the latest current actions and the single latest next action. The next
 * action is what follows the current ones, so only the newest one is shown as "next".
 */
export function summariseActions<T extends { kind: ProjectActionKind }>(entries: readonly T[]): { current: T[]; next: T | null } {
  return {
    current: entries.filter((entry) => entry.kind === "CURRENT").slice(0, LATEST_CURRENT_COUNT),
    next: entries.find((entry) => entry.kind === "NEXT") ?? null,
  };
}
