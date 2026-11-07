import { jakartaDay } from "@/domain/requests/metrics";
import { overdueWorkingDays, type Sla } from "@/domain/requests/sla";
import type { RequestType } from "@/domain/requests/types";
import { SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND } from "./kinds";
import type { NotificationSeverity } from "./severity";

/**
 * When a team is told about a request's SLA. The level follows the SLA state that the badge on the request shows, so a
 * notification and a badge never disagree: Due now (past the expected date, or under a day to the deadline) is a Warning,
 * Overdue is Danger. Paused, met, late, none: nothing, and nothing for a request that is finished.
 */
export type SlaAlertLevel = Extract<NotificationSeverity, "WARNING" | "DANGER">;

/**
 * A deadline that passed longer ago than this is old news and is not alerted: the first scan on a database with a backlog, or one after
 * a long outage of the cron job, would otherwise tell Admin, Management and the team about every request that was ever late. Calendar days.
 */
export const SLA_ALERT_MAX_AGE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function slaAlertLevel(sla: Pick<Sla, "state" | "dueAt">, now: Date): SlaAlertLevel | null {
  if (sla.state === "due_soon") return "WARNING";
  if (sla.state === "overdue") return now.getTime() - sla.dueAt.getTime() <= SLA_ALERT_MAX_AGE_DAYS * DAY_MS ? "DANGER" : null;
  return null;
}

/** The start of the SLA round the alert belongs to: the request's creation, or the moment it was sent back for a revision. */
export function slaRoundStart(createdAt: Date, sla: Pick<Sla, "revision">, status: string): Date {
  return status === "REVISION" && sla.revision ? sla.revision.startedAt : createdAt;
}

/** One alert per recipient, request, round and level (the unique index on notifications). */
export function slaAlertKey(requestId: string, roundStart: Date, level: SlaAlertLevel): string {
  return `sla:${requestId}:${roundStart.toISOString()}:${level}`;
}

export const SLA_ALERT_KIND: Record<SlaAlertLevel, string> = { WARNING: SLA_DUE_SOON_KIND, DANGER: SLA_OVERDUE_KIND };

export type SlaAlertTextInput = {
  code: string;
  type: RequestType;
  level: SlaAlertLevel;
  dueAt: Date;
  now: Date;
  /** True while the request is in a revision round. */
  revision: boolean;
  /** The PIC working on it, if one is assigned. */
  picName: string | null;
  title: string;
};

/** The title and body of an alert, in Indonesian like the rest of the page. No commercial values. */
export function slaAlertText(input: SlaAlertTextInput): { title: string; body: string } {
  const round = input.revision ? "Revisi " : "";
  const due = jakartaDay(input.dueAt);
  const pic = input.picName ? `PIC: ${input.picName}.` : "Belum ada PIC.";
  if (input.level === "WARNING") {
    return { title: `${round}${input.code} mendekati batas SLA`, body: `${input.title}. Batas SLA ${due}. ${pic}` };
  }
  const days = overdueWorkingDays(input.dueAt, input.now);
  return { title: `${round}${input.code} melewati batas SLA`, body: `${input.title}. Terlambat ${days} hari kerja (batas ${due}). ${pic}` };
}
