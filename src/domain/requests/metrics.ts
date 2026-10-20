import { isOpen, REQUEST_STATUSES, type RequestStatus } from "./status";
import type { RequestType } from "./types";
import { slaOf, waitingMs, type SlaRange, type SlaState, type StatusEntry } from "./sla";

/**
 * The dashboard numbers of a team that works requests (SOA on BOQ, Purchasing on RFQ and PO) or of the people who raised them
 * (Sales). Everything here is computed from the stored requests and their status history; nothing is estimated. Each
 * definition is written next to the number so a scorecard can be checked against the list behind it (docs/decisions D-026).
 *
 * Time is measured in calendar hours and shown as days. The SLA clock itself runs in working days (sla.ts).
 */
export const METRICS_WINDOW_DAYS = 90;
export const UPCOMING_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JAKARTA_OFFSET_MS = 7 * HOUR_MS;

export type MetricRequest = {
  code: string;
  status: RequestStatus;
  createdAt: Date;
  completedAt: Date | null;
  /** The date the requester needs it by, a plain calendar date (stored as UTC midnight). */
  requiredBy: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  history: readonly StatusEntry[];
};

/** Today's calendar date in Jakarta as `YYYY-MM-DD`. */
export function jakartaDay(now: Date): string {
  return new Date(now.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Needed-by dates before today count as past; today up to `UPCOMING_DAYS` days ahead count as upcoming. Done requests are neither. */
export function deadlineState(request: Pick<MetricRequest, "status" | "requiredBy">, now: Date): "past" | "soon" | null {
  if (!request.requiredBy || !isOpen(request.status)) return null;
  const needed = request.requiredBy.toISOString().slice(0, 10);
  const today = jakartaDay(now);
  if (needed < today) return "past";
  return needed <= addDays(today, UPCOMING_DAYS) ? "soon" : null;
}

/** The moment a request first left Submitted (somebody picked it up, asked a question or answered it). */
function firstResponseAt(history: readonly StatusEntry[]): Date | null {
  const first = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime()).find((entry) => entry.toStatus !== "SUBMITTED");
  return first?.changedAt ?? null;
}

/** When the request entered the status it is in now. */
function enteredCurrentStatusAt(request: MetricRequest): Date {
  const last = [...request.history].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0];
  return last?.changedAt ?? request.createdAt;
}

export type WorkloadRow = { assigneeId: string | null; name: string; open: number; overdue: number };

export type BottleneckRow = {
  status: RequestStatus;
  count: number;
  /** Average time the open requests have been in this status, in hours. */
  avgHours: number;
  oldestHours: number;
  oldestCode: string;
};

export type TeamMetrics = {
  /** Requests that are not Completed or Cancelled. */
  open: number;
  /** Open requests nobody has started: still Submitted. */
  backlog: number;
  /** Open requests that are Submitted or In progress with no assignee. */
  unassigned: number;
  inProgress: number;
  /** Open requests that still have the retired Waiting for Sales status (older requests; the SLA clock is paused). */
  waitingForSales: number;
  /** Completed BOQs SOA are revising. */
  revision: number;
  /** Open requests past the SLA deadline (not counting those waiting for Sales). */
  overdue: number;
  /** Open requests between the SLA's expected date and its deadline. */
  dueNow: number;
  /** Open requests whose needed-by date has passed. */
  pastNeededBy: number;
  /** Open requests needed within the next `UPCOMING_DAYS` days, today included. */
  upcomingDeadlines: number;
  /** Requests completed in the window (the sample of the numbers below). */
  completedInWindow: number;
  /** Of those, how many met the SLA deadline and how many were late; compliance is met over both, or null without a sample. */
  slaMet: number;
  slaLate: number;
  slaCompliancePct: number | null;
  /** Averages over the requests completed in the window, in hours; null when there is no sample. */
  avgQueueHours: number | null;
  avgWaitingHours: number | null;
  avgProcessingHours: number | null;
  avgTurnaroundHours: number | null;
  workload: WorkloadRow[];
  bottlenecks: BottleneckRow[];
};

const average = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

/**
 * `range` is the SLA of the team that owns these requests. Definitions:
 * - queue time = created to first response (the first status other than Submitted);
 * - waiting time = time spent in Waiting for Sales;
 * - processing time = turnaround minus queue time minus waiting time (never negative);
 * - turnaround = created to completed.
 * The time averages and SLA compliance use the requests completed in the last `METRICS_WINDOW_DAYS` days.
 */
export function computeTeamMetrics(requests: readonly MetricRequest[], range: SlaRange, now: Date): TeamMetrics {
  const since = now.getTime() - METRICS_WINDOW_DAYS * DAY_MS;
  const metrics: TeamMetrics = {
    open: 0,
    backlog: 0,
    unassigned: 0,
    inProgress: 0,
    waitingForSales: 0,
    revision: 0,
    overdue: 0,
    dueNow: 0,
    pastNeededBy: 0,
    upcomingDeadlines: 0,
    completedInWindow: 0,
    slaMet: 0,
    slaLate: 0,
    slaCompliancePct: null,
    avgQueueHours: null,
    avgWaitingHours: null,
    avgProcessingHours: null,
    avgTurnaroundHours: null,
    workload: [],
    bottlenecks: [],
  };
  const workload = new Map<string, WorkloadRow>();
  const stuck = new Map<RequestStatus, { hours: number[]; oldest: { hours: number; code: string } }>();
  const queue: number[] = [];
  const waiting: number[] = [];
  const processing: number[] = [];
  const turnaround: number[] = [];

  for (const request of requests) {
    const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.history, range, now });

    if (isOpen(request.status)) {
      metrics.open += 1;
      if (request.status === "SUBMITTED") metrics.backlog += 1;
      if (request.status === "IN_PROGRESS") metrics.inProgress += 1;
      if (request.status === "WAITING_FOR_SALES") metrics.waitingForSales += 1;
      if (request.status === "REVISION") metrics.revision += 1;
      if (request.assigneeId === null && request.status !== "WAITING_FOR_SALES") metrics.unassigned += 1;
      if (sla.state === "overdue") metrics.overdue += 1;
      if (sla.state === "due_soon") metrics.dueNow += 1;
      const deadline = deadlineState(request, now);
      if (deadline === "past") metrics.pastNeededBy += 1;
      if (deadline === "soon") metrics.upcomingDeadlines += 1;

      const key = request.assigneeId ?? "none";
      const row = workload.get(key) ?? { assigneeId: request.assigneeId, name: request.assigneeName ?? "Unassigned", open: 0, overdue: 0 };
      row.open += 1;
      if (sla.state === "overdue") row.overdue += 1;
      workload.set(key, row);

      const hours = Math.max(0, now.getTime() - enteredCurrentStatusAt(request).getTime()) / HOUR_MS;
      const entry = stuck.get(request.status) ?? { hours: [], oldest: { hours: -1, code: "" } };
      entry.hours.push(hours);
      if (hours > entry.oldest.hours) entry.oldest = { hours, code: request.code };
      stuck.set(request.status, entry);
      continue;
    }

    if (request.status === "COMPLETED" && request.completedAt && request.completedAt.getTime() >= since) {
      metrics.completedInWindow += 1;
      if (sla.state === "met") metrics.slaMet += 1;
      if (sla.state === "late") metrics.slaLate += 1;
      const total = Math.max(0, request.completedAt.getTime() - request.createdAt.getTime());
      const first = firstResponseAt(request.history);
      const queued = first ? Math.min(total, Math.max(0, first.getTime() - request.createdAt.getTime())) : total;
      const waited = Math.min(total - queued, waitingMs(request.history, request.completedAt));
      turnaround.push(total / HOUR_MS);
      queue.push(queued / HOUR_MS);
      waiting.push(waited / HOUR_MS);
      processing.push(Math.max(0, total - queued - waited) / HOUR_MS);
    }
  }

  const measured = metrics.slaMet + metrics.slaLate;
  metrics.slaCompliancePct = measured === 0 ? null : (metrics.slaMet / measured) * 100;
  metrics.avgQueueHours = average(queue);
  metrics.avgWaitingHours = average(waiting);
  metrics.avgProcessingHours = average(processing);
  metrics.avgTurnaroundHours = average(turnaround);
  // Biggest load first; "Unassigned" always last so it does not hide the people.
  metrics.workload = [...workload.values()].sort((a, b) => (a.assigneeId === null ? 1 : 0) - (b.assigneeId === null ? 1 : 0) || b.open - a.open || a.name.localeCompare(b.name));
  metrics.bottlenecks = (["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES"] as const)
    .filter((status) => stuck.has(status))
    .map((status) => {
      const entry = stuck.get(status)!;
      return { status, count: entry.hours.length, avgHours: average(entry.hours) ?? 0, oldestHours: entry.oldest.hours, oldestCode: entry.oldest.code };
    });
  return metrics;
}

export type MonthlyRow = {
  /** `2026-10`, the calendar month in Jakarta. */
  month: string;
  /** Requests created in the month. */
  received: number;
  /** Requests completed in the month. */
  completed: number;
  slaMet: number;
  slaLate: number;
  slaCompliancePct: number | null;
  /** Created to completed, averaged over the requests completed in the month. */
  avgTurnaroundHours: number | null;
};

const monthOf = (date: Date): string => new Date(date.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 7);

/** The last `months` calendar months (the current one first): how many requests arrived and were completed, and how well they kept the SLA. */
export function monthlyReport(requests: readonly MetricRequest[], range: SlaRange, now: Date, months = 6): MonthlyRow[] {
  const keys: string[] = [];
  const cursor = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  for (let i = 0; i < months; i += 1) {
    keys.push(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  const rows = new Map<string, MonthlyRow & { hours: number[] }>(
    keys.map((month) => [month, { month, received: 0, completed: 0, slaMet: 0, slaLate: 0, slaCompliancePct: null, avgTurnaroundHours: null, hours: [] }]),
  );
  for (const request of requests) {
    const created = rows.get(monthOf(request.createdAt));
    if (created) created.received += 1;
    if (request.status !== "COMPLETED" || !request.completedAt) continue;
    const done = rows.get(monthOf(request.completedAt));
    if (!done) continue;
    done.completed += 1;
    done.hours.push(Math.max(0, request.completedAt.getTime() - request.createdAt.getTime()) / HOUR_MS);
    const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.history, range, now });
    if (sla.state === "met") done.slaMet += 1;
    if (sla.state === "late") done.slaLate += 1;
  }
  return keys.map((key) => {
    const { hours, ...row } = rows.get(key)!;
    const measured = row.slaMet + row.slaLate;
    return { ...row, slaCompliancePct: measured === 0 ? null : (row.slaMet / measured) * 100, avgTurnaroundHours: average(hours) };
  });
}

export type RequesterSummary = {
  byStatus: Record<RequestStatus, number>;
  open: number;
  waitingForSales: number;
  /** Open requests past the SLA deadline of the team they were sent to. */
  overdue: number;
  pastNeededBy: number;
  upcomingDeadlines: number;
};

/**
 * What a salesperson (or anyone looking at the requests on some projects) needs: how many requests are in each status, and which
 * are late or due soon. Each request is measured against the SLA of the team that owns its type (`rangeOf`).
 */
export function summariseRequests(
  requests: readonly (MetricRequest & { type: RequestType })[],
  rangeOf: (type: RequestType) => SlaRange,
  now: Date,
): RequesterSummary {
  const summary: RequesterSummary = {
    byStatus: Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0])) as Record<RequestStatus, number>,
    open: 0,
    waitingForSales: 0,
    overdue: 0,
    pastNeededBy: 0,
    upcomingDeadlines: 0,
  };
  for (const request of requests) {
    summary.byStatus[request.status] += 1;
    if (!isOpen(request.status)) continue;
    summary.open += 1;
    if (request.status === "WAITING_FOR_SALES") summary.waitingForSales += 1;
    const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.history, range: rangeOf(request.type), now });
    if (sla.state === "overdue") summary.overdue += 1;
    const deadline = deadlineState(request, now);
    if (deadline === "past") summary.pastNeededBy += 1;
    if (deadline === "soon") summary.upcomingDeadlines += 1;
  }
  return summary;
}

export type PicLoad = { picId: string | null; name: string; total: number; done: number; onGoing: number };

export type StatusSummary = {
  total: number;
  /** Completed. */
  done: number;
  /** In progress (a Submitted request nobody has started is not on going yet). */
  onGoing: number;
  /** Done over total, as a percentage; null without requests. */
  completionPct: number | null;
  /** Every status with its count, in the order of the board; statuses nobody holds are included with 0. */
  byStatus: { status: RequestStatus; count: number }[];
  /** Requests per PIC. Every active PIC of the team is listed, with 0 if they have none; "Unassigned" appears only when there are such requests. */
  byPic: PicLoad[];
};

/**
 * The whole picture of a team's requests, open or closed: how many there are, how many are done and on going, the completion rate
 * (done / total, cancelled requests count in the total) and the split by status and by PIC. `pics` is the team's PIC list, so a PIC
 * with no request yet still has a row.
 */
export function summariseStatuses(requests: readonly MetricRequest[], pics: readonly { id: string; name: string; isActive: boolean }[]): StatusSummary {
  const byStatus = REQUEST_STATUSES.map((status) => ({ status, count: requests.filter((r) => r.status === status).length })).filter((row) => row.count > 0 || row.status !== "WAITING_FOR_SALES");
  const rows = new Map<string | null, PicLoad>();
  for (const pic of pics) if (pic.isActive) rows.set(pic.id, { picId: pic.id, name: pic.name, total: 0, done: 0, onGoing: 0 });
  for (const request of requests) {
    const key = request.assigneeId;
    const row = rows.get(key) ?? { picId: key, name: key === null ? "Unassigned" : (request.assigneeName ?? "PIC"), total: 0, done: 0, onGoing: 0 };
    row.total += 1;
    if (request.status === "COMPLETED") row.done += 1;
    if (request.status === "IN_PROGRESS") row.onGoing += 1;
    rows.set(key, row);
  }
  const done = requests.filter((r) => r.status === "COMPLETED").length;
  return {
    total: requests.length,
    done,
    onGoing: requests.filter((r) => r.status === "IN_PROGRESS").length,
    completionPct: requests.length === 0 ? null : (done / requests.length) * 100,
    byStatus,
    byPic: [...rows.values()].sort((a, b) => (a.picId === null ? 1 : 0) - (b.picId === null ? 1 : 0) || b.total - a.total || a.name.localeCompare(b.name)),
  };
}

/** `1.5 days`, `5 hours`, or an en dash without a value. Under a day it is hours so short times are not shown as 0. */
export function formatDuration(hours: number | null): string {
  if (hours === null) return "–";
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function formatPct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value)}%`;
}

export type { SlaState };
