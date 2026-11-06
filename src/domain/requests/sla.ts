import type { RequestStatus } from "./status";

/**
 * How quickly SOA (BOQ requests) and Purchasing (RFQ and PO requests) should answer a request, set by the superadmin per
 * team as a number of days or a range of days: "3", "2-3", "1-4" (at most 7). The first number is when an answer is
 * expected, the last is the deadline. Assumptions, not confirmed rules (OPEN_QUESTIONS T-16): days are working days
 * (Monday to Friday, Jakarta time, no holiday calendar); the clock starts when the request is created, keeps running while
 * the team works, stands still while the request waits for Sales, and stops when it is completed.
 */
export const SLA_MIN_DAYS = 1;
export const SLA_MAX_DAYS = 7;

export type SlaRange = { minDays: number; maxDays: number };

/** Until the superadmin sets it: an answer expected after 2 days, due after 3. */
export const DEFAULT_SLA: SlaRange = { minDays: 2, maxDays: 3 };

export function isValidSlaRange(range: { minDays: unknown; maxDays: unknown }): range is SlaRange {
  const { minDays, maxDays } = range;
  return (
    typeof minDays === "number" &&
    typeof maxDays === "number" &&
    Number.isInteger(minDays) &&
    Number.isInteger(maxDays) &&
    minDays >= SLA_MIN_DAYS &&
    maxDays <= SLA_MAX_DAYS &&
    minDays <= maxDays
  );
}

/**
 * Reads what the superadmin typed: "3" (the same day count for both ends), or a range "2-3" / "1 - 4" (a hyphen or a dash,
 * with or without spaces). Anything else, a range that runs backwards, or a day count outside 1 to 7, is null.
 */
export function parseSlaRange(text: string): SlaRange | null {
  const match = /^\s*(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s*(?:hari|days?)?\s*$/i.exec(text);
  if (!match) return null;
  const minDays = Number(match[1]);
  const maxDays = match[2] === undefined ? minDays : Number(match[2]);
  const range = { minDays, maxDays };
  return isValidSlaRange(range) ? range : null;
}

/** "3" for one number, "2-3" for a range: the way it is written back into the settings and into the email. */
export function formatSlaRange(range: SlaRange): string {
  return range.minDays === range.maxDays ? String(range.maxDays) : `${range.minDays}-${range.maxDays}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

const isWeekend = (instant: number): boolean => {
  const weekday = new Date(instant + JAKARTA_OFFSET_MS).getUTCDay();
  return weekday === 0 || weekday === 6;
};

/** The same time of day, `days` working days later: Saturdays and Sundays do not count. */
export function addWorkingDays(start: Date, days: number): Date {
  let instant = start.getTime();
  for (let left = days; left > 0; ) {
    instant += DAY_MS;
    if (!isWeekend(instant)) left -= 1;
  }
  return new Date(instant);
}

export type StatusEntry = { toStatus: RequestStatus; changedAt: Date };

/** The time a request spent in the retired Waiting for Sales status (older requests only): finished stretches, plus the running one if it is waiting now. */
export function waitingMs(history: readonly StatusEntry[], now: Date): number {
  const ordered = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  let total = 0;
  let since: number | null = null;
  for (const entry of ordered) {
    if (entry.toStatus === "WAITING_FOR_SALES") {
      since ??= entry.changedAt.getTime();
    } else if (since !== null) {
      total += entry.changedAt.getTime() - since;
      since = null;
    }
  }
  if (since !== null) total += Math.max(0, now.getTime() - since);
  return total;
}

export type SlaState = "on_track" | "due_soon" | "overdue" | "paused" | "met" | "late" | "none";

export const SLA_STATE_LABELS: Record<SlaState, string> = {
  on_track: "On track",
  due_soon: "Due now",
  overdue: "Overdue",
  paused: "Paused (waiting for Sales)",
  met: "Met",
  late: "Completed late",
  none: "–",
};

export type SlaInput = {
  createdAt: Date;
  status: RequestStatus;
  completedAt: Date | null;
  history: readonly StatusEntry[];
  range: SlaRange;
  now: Date;
};

/** One revision round: the clock starts when the request was sent back (same range as the team's SLA) and has a result of its own. */
export type RevisionSla = { startedAt: Date; endedAt: Date | null; targetAt: Date; dueAt: Date; state: SlaState };

/**
 * `targetAt` is when an answer is expected (the first number of the range); `dueAt` is the deadline (the last).
 * `revision` is the latest revision round, or null when the request was never sent back. While the request is in Revision,
 * `targetAt`, `dueAt` and `state` are those of that round; otherwise they stay those of the first completion.
 */
export type Sla = { targetAt: Date; dueAt: Date; state: SlaState; revision: RevisionSla | null };

const runningState = (now: Date, targetAt: Date, dueAt: Date): SlaState => {
  if (now.getTime() > dueAt.getTime()) return "overdue";
  return now.getTime() >= targetAt.getTime() || dueAt.getTime() - now.getTime() < DAY_MS ? "due_soon" : "on_track";
};

/** The latest revision round: it ends at the first completion after it started. Each new revision starts a fresh clock; earlier rounds are not scored again. */
function latestRevision(history: readonly StatusEntry[], range: SlaRange, now: Date): RevisionSla | null {
  const ordered = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const start = ordered.findLast((entry) => entry.toStatus === "REVISION");
  if (!start) return null;
  const startedAt = start.changedAt;
  const targetAt = addWorkingDays(startedAt, range.minDays);
  const dueAt = addWorkingDays(startedAt, range.maxDays);
  const cancelled = ordered.some((entry) => entry.toStatus === "CANCELLED" && entry.changedAt.getTime() >= startedAt.getTime());
  const done = ordered.find((entry) => entry.toStatus === "COMPLETED" && entry.changedAt.getTime() >= startedAt.getTime());
  const state: SlaState = cancelled ? "none" : done ? (done.changedAt.getTime() > dueAt.getTime() ? "late" : "met") : runningState(now, targetAt, dueAt);
  return { startedAt, endedAt: done?.changedAt ?? null, targetAt, dueAt, state };
}

/**
 * When the team should answer, the deadline, and where the request stands against them. On track until the expected date,
 * Due now between the expected date and the deadline, Overdue after it. Cancelled requests have no SLA state.
 */
export function slaOf({ createdAt, status, completedAt, history, range, now }: SlaInput): Sla {
  const waited = waitingMs(history, now);
  const targetAt = new Date(addWorkingDays(createdAt, range.minDays).getTime() + waited);
  const dueAt = new Date(addWorkingDays(createdAt, range.maxDays).getTime() + waited);
  const revision = latestRevision(history, range, now);
  if (status === "CANCELLED") return { targetAt, dueAt, state: "none", revision };
  // In Revision the clock of that round runs; the first completion's result is kept (it is not scored again).
  if (status === "REVISION" && revision) return { targetAt: revision.targetAt, dueAt: revision.dueAt, state: revision.state, revision };
  if (status === "COMPLETED" || status === "REVISION") return { targetAt, dueAt, state: completedAt && completedAt.getTime() > dueAt.getTime() ? "late" : "met", revision };
  if (status === "WAITING_FOR_SALES") return { targetAt, dueAt, state: "paused", revision };
  return { targetAt, dueAt, state: runningState(now, targetAt, dueAt), revision };
}

/**
 * How many working days a request ran past its deadline, up to `until` (when it was completed, or now while it is still open): the smallest
 * number of working days after `dueAt` that reaches `until`. 0 when it was not late; a request late by an hour is 1 day late.
 */
export function overdueWorkingDays(dueAt: Date, until: Date): number {
  let days = 0;
  while (addWorkingDays(dueAt, days).getTime() < until.getTime()) days += 1;
  return days;
}
