import { isRevisionNotification } from "./kinds";

/** Keep in sync with `enum NotificationSeverity` in prisma/schema.prisma. Lowest first. */
export const NOTIFICATION_SEVERITIES = ["INFO", "WARNING", "DANGER"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<NotificationSeverity, string> = { INFO: "Info", WARNING: "Warning", DANGER: "Danger" };

/** What each level means, shown on the notification page. */
export const SEVERITY_DESCRIPTIONS: Record<NotificationSeverity, string> = {
  INFO: "Request baru untuk tim Anda dan perubahan divisi lain.",
  WARNING: "Request yang mendekati batas SLA.",
  DANGER: "Request yang melewati batas SLA, dan permintaan revisi.",
};

export function isNotificationSeverity(value: unknown): value is NotificationSeverity {
  return typeof value === "string" && (NOTIFICATION_SEVERITIES as readonly string[]).includes(value);
}

/** The level a notification gets when its writer names none: a revision is Danger (it was red before levels existed), everything else is Info. */
export function defaultSeverityFor(kind: string): NotificationSeverity {
  return isRevisionNotification(kind) ? "DANGER" : "INFO";
}

export type UnreadBySeverity = Record<NotificationSeverity, number>;

/** The level the bell takes its colour from: the loudest level that has an unread notification, or null when there is none. */
export function bellSeverity(unread: UnreadBySeverity): NotificationSeverity | null {
  return highestSeverity(NOTIFICATION_SEVERITIES.filter((severity) => unread[severity] > 0));
}

/** The words for the bell, loudest first and only levels that have something: "2 danger, 1 warning, 4 info". */
export function unreadSummary(unread: UnreadBySeverity): string {
  return [...NOTIFICATION_SEVERITIES]
    .reverse()
    .filter((severity) => unread[severity] > 0)
    .map((severity) => `${unread[severity]} ${SEVERITY_LABELS[severity].toLowerCase()}`)
    .join(", ");
}

/** The loudest of the levels, or null for none: the bell takes its colour from it. */
export function highestSeverity(severities: Iterable<NotificationSeverity>): NotificationSeverity | null {
  let best: NotificationSeverity | null = null;
  for (const severity of severities) {
    if (best === null || NOTIFICATION_SEVERITIES.indexOf(severity) > NOTIFICATION_SEVERITIES.indexOf(best)) best = severity;
  }
  return best;
}
