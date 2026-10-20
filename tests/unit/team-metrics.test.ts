import { describe, expect, it } from "vitest";
import { computeTeamMetrics, deadlineState, formatDuration, formatPct, jakartaDay, summariseRequests, summariseStatuses, type MetricRequest } from "@/domain/requests/metrics";

// Wednesday 21 October 2026, 12:00 UTC (19:00 in Jakarta).
const now = new Date("2026-10-21T12:00:00Z");
const range = { minDays: 2, maxDays: 3 };
const at = (text: string) => new Date(`${text}Z`);
const entry = (toStatus: MetricRequest["status"], text: string) => ({ toStatus, changedAt: at(text) });

const request = (code: string, fields: Partial<MetricRequest> & Pick<MetricRequest, "status" | "createdAt">): MetricRequest => ({
  code,
  completedAt: null,
  requiredBy: null,
  assigneeId: null,
  assigneeName: null,
  history: [],
  ...fields,
});

const REQUESTS: MetricRequest[] = [
  // Submitted on Monday, nobody started: backlog, unassigned; between the expected date and the deadline; needed within a week.
  request("A", { status: "SUBMITTED", createdAt: at("2026-10-19T08:00:00"), requiredBy: at("2026-10-25T00:00:00") }),
  // In progress since Friday: its deadline (three working days) was this morning.
  request("B", { status: "IN_PROGRESS", createdAt: at("2026-10-16T03:00:00"), assigneeId: "rina", assigneeName: "Rina", history: [entry("IN_PROGRESS", "2026-10-16T05:00:00")] }),
  // Waiting for Sales since 13 October; the date it was needed by has passed.
  request("C", {
    status: "WAITING_FOR_SALES",
    createdAt: at("2026-10-12T02:00:00"),
    assigneeId: "rina",
    assigneeName: "Rina",
    requiredBy: at("2026-10-20T00:00:00"),
    history: [entry("IN_PROGRESS", "2026-10-12T10:00:00"), entry("WAITING_FOR_SALES", "2026-10-13T00:00:00")],
  }),
  // Completed on time: queued 4h, waited 24h, 76h in all, so 48h of processing.
  request("D", {
    status: "COMPLETED",
    createdAt: at("2026-10-05T02:00:00"),
    completedAt: at("2026-10-08T06:00:00"),
    history: [entry("IN_PROGRESS", "2026-10-05T06:00:00"), entry("WAITING_FOR_SALES", "2026-10-06T06:00:00"), entry("IN_PROGRESS", "2026-10-07T06:00:00"), entry("COMPLETED", "2026-10-08T06:00:00")],
  }),
  // Completed after its deadline: queued 1h, no waiting, 169h in all.
  request("E", {
    status: "COMPLETED",
    createdAt: at("2026-10-12T02:00:00"),
    completedAt: at("2026-10-19T03:00:00"),
    history: [entry("IN_PROGRESS", "2026-10-12T03:00:00"), entry("COMPLETED", "2026-10-19T03:00:00")],
  }),
  request("F", { status: "CANCELLED", createdAt: at("2026-10-01T02:00:00"), history: [entry("CANCELLED", "2026-10-02T02:00:00")] }),
  // Completed long before the window: counts nowhere.
  request("G", { status: "COMPLETED", createdAt: at("2026-05-01T02:00:00"), completedAt: at("2026-05-20T02:00:00"), history: [entry("COMPLETED", "2026-05-20T02:00:00")] }),
];

describe("computeTeamMetrics", () => {
  const metrics = computeTeamMetrics(REQUESTS, range, now);

  it("counts the open requests and where they stand", () => {
    expect(metrics).toMatchObject({ open: 3, backlog: 1, unassigned: 1, inProgress: 1, waitingForSales: 1 });
  });

  it("counts overdue and due-now by the SLA, and leaves requests waiting for Sales out of both", () => {
    expect(metrics.overdue).toBe(1); // B
    expect(metrics.dueNow).toBe(1); // A
  });

  it("counts past needed-by dates and deadlines in the coming week, for open requests only", () => {
    expect(metrics.pastNeededBy).toBe(1); // C
    expect(metrics.upcomingDeadlines).toBe(1); // A
  });

  it("measures SLA compliance on the requests completed in the last 90 days", () => {
    expect(metrics).toMatchObject({ completedInWindow: 2, slaMet: 1, slaLate: 1, slaCompliancePct: 50 });
  });

  it("splits the time of completed requests into queue, waiting and processing", () => {
    expect(metrics.avgQueueHours).toBeCloseTo(2.5);
    expect(metrics.avgWaitingHours).toBeCloseTo(12);
    expect(metrics.avgProcessingHours).toBeCloseTo(108);
    expect(metrics.avgTurnaroundHours).toBeCloseTo(122.5);
  });

  it("lists the workload by assignee, unassigned last", () => {
    expect(metrics.workload).toEqual([
      { assigneeId: "rina", name: "Rina", open: 2, overdue: 1 },
      { assigneeId: null, name: "Unassigned", open: 1, overdue: 0 },
    ]);
  });

  it("finds the bottlenecks: how long open requests have sat in their current status", () => {
    expect(metrics.bottlenecks.map((b) => [b.status, b.count, Math.round(b.avgHours), b.oldestCode])).toEqual([
      ["SUBMITTED", 1, 52, "A"], // since 19 Oct 08:00
      ["IN_PROGRESS", 1, 127, "B"], // since 16 Oct 05:00
      ["WAITING_FOR_SALES", 1, 204, "C"], // since 13 Oct 00:00
    ]);
  });

  it("reports nothing it cannot measure", () => {
    const empty = computeTeamMetrics([], range, now);

    expect(empty).toMatchObject({ open: 0, completedInWindow: 0, slaCompliancePct: null, avgQueueHours: null, avgProcessingHours: null, workload: [], bottlenecks: [] });
  });

  it("never reports a negative processing time, even for a request answered the moment it arrived", () => {
    const instant = request("Z", { status: "COMPLETED", createdAt: at("2026-10-20T02:00:00"), completedAt: at("2026-10-20T02:00:00"), history: [entry("COMPLETED", "2026-10-20T02:00:00")] });

    const result = computeTeamMetrics([instant], range, now);

    expect(result.avgProcessingHours).toBe(0);
    expect(result.avgQueueHours).toBe(0);
    expect(result.slaCompliancePct).toBe(100);
  });
});

describe("deadlines", () => {
  const needed = (day: string, status: MetricRequest["status"] = "IN_PROGRESS") => deadlineState({ status, requiredBy: at(`${day}T00:00:00`) }, now);

  it("treats dates before today (in Jakarta) as past, and today through the next seven days as upcoming", () => {
    expect(needed("2026-10-21")).toBe("soon"); // today
    expect(needed("2026-10-20")).toBe("past");
    expect(needed("2026-10-28")).toBe("soon");
    expect(needed("2026-10-29")).toBeNull();
  });

  it("uses the calendar day in Jakarta, which is ahead of UTC", () => {
    const lateEvening = new Date("2026-10-21T18:00:00Z"); // 01:00 on the 22nd in Jakarta
    expect(jakartaDay(lateEvening)).toBe("2026-10-22");
    expect(deadlineState({ status: "IN_PROGRESS", requiredBy: at("2026-10-21T00:00:00") }, lateEvening)).toBe("past");
  });

  it("ignores finished requests and requests with no date", () => {
    expect(needed("2026-10-01", "COMPLETED")).toBeNull();
    expect(needed("2026-10-01", "CANCELLED")).toBeNull();
    expect(deadlineState({ status: "IN_PROGRESS", requiredBy: null }, now)).toBeNull();
  });
});

describe("summariseRequests", () => {
  it("counts requests by status and applies each team's own SLA", () => {
    const typed = [
      { ...REQUESTS[1]!, type: "BOQ" as const }, // overdue with a 2-3 day SLA
      { ...REQUESTS[0]!, type: "RFQ" as const }, // due now with 2-3, still on time with 5-7
      { ...REQUESTS[3]!, type: "BOQ" as const },
    ];

    const strict = summariseRequests(typed, () => range, now);
    const relaxed = summariseRequests(typed, (type) => (type === "RFQ" ? { minDays: 5, maxDays: 7 } : range), now);

    expect(strict.byStatus).toMatchObject({ SUBMITTED: 1, IN_PROGRESS: 1, COMPLETED: 1, WAITING_FOR_SALES: 0, CANCELLED: 0 });
    expect(strict).toMatchObject({ open: 2, overdue: 1, upcomingDeadlines: 1, pastNeededBy: 0, waitingForSales: 0 });
    expect(relaxed.overdue).toBe(1);
  });
});

describe("formatting", () => {
  it("writes durations the way people read them", () => {
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(0.2)).toBe("< 1 hour");
    expect(formatDuration(1)).toBe("1 hour");
    expect(formatDuration(5.4)).toBe("5 hours");
    expect(formatDuration(36)).toBe("1.5 days");
    expect(formatDuration(24)).toBe("1 day");
    expect(formatPct(null)).toBe("–");
    expect(formatPct(66.6)).toBe("67%");
  });
});

describe("summariseStatuses", () => {
  const request = (code: string, status: MetricRequest["status"], assigneeId: string | null, assigneeName: string | null): MetricRequest => ({
    code,
    status,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    completedAt: status === "COMPLETED" ? new Date("2026-10-02T00:00:00Z") : null,
    requiredBy: null,
    assigneeId,
    assigneeName,
    history: [],
  });
  const pics = [
    { id: "gita", name: "Gita", isActive: true },
    { id: "soraya", name: "Soraya", isActive: true },
    { id: "old", name: "Old", isActive: false },
  ];

  it("counts total, done and on going, and the completion rate over the total", () => {
    const summary = summariseStatuses(
      [request("a", "COMPLETED", "gita", "Gita"), request("b", "COMPLETED", "gita", "Gita"), request("c", "IN_PROGRESS", "soraya", "Soraya"), request("d", "CANCELLED", null, null)],
      pics,
    );

    expect(summary).toMatchObject({ total: 4, done: 2, onGoing: 1 });
    expect(summary.completionPct).toBe(50);
    expect(summary.byStatus.find((row) => row.status === "CANCELLED")?.count).toBe(1);
    expect(summary.byStatus.reduce((sum, row) => sum + row.count, 0)).toBe(4);
  });

  it("lists every active PIC even with no request, puts unassigned last, and leaves an inactive PIC out unless it has requests", () => {
    const summary = summariseStatuses([request("a", "COMPLETED", "gita", "Gita"), request("b", "SUBMITTED", null, null)], pics);

    expect(summary.byPic.map((row) => [row.name, row.total, row.done, row.onGoing])).toEqual([["Gita", 1, 1, 0], ["Soraya", 0, 0, 0], ["Unassigned", 1, 0, 0]]);
    const withOld = summariseStatuses([request("a", "IN_PROGRESS", "old", "Old (inactive)")], pics);
    expect(withOld.byPic.find((row) => row.picId === "old")).toMatchObject({ name: "Old (inactive)", total: 1, onGoing: 1 });
  });

  it("has no completion rate without requests", () => {
    expect(summariseStatuses([], pics)).toMatchObject({ total: 0, completionPct: null });
  });
});
