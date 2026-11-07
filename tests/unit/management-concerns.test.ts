import { describe, expect, it } from "vitest";
import { BACKLOG_STALE_HOURS, computeConcerns, countBySeverity, HANDOFF_STALE_DAYS, PIC_OPEN_LIMIT, SLA_COMPLIANCE_DANGER_PCT, SLA_COMPLIANCE_WARNING_PCT, STALE_PROJECTS_WARNING, type ManagementInput } from "@/domain/management/concerns";
import type { TeamMetrics } from "@/domain/requests/metrics";

const quiet: TeamMetrics = {
  open: 0, backlog: 0, unassigned: 0, inProgress: 0, waitingForSales: 0, revision: 0, overdue: 0, dueNow: 0, pastNeededBy: 0, upcomingDeadlines: 0,
  completedInWindow: 0, slaMet: 0, slaLate: 0, slaCompliancePct: null, avgQueueHours: null, avgWaitingHours: null, avgProcessingHours: null, avgTurnaroundHours: null,
  workload: [], bottlenecks: [],
};

const input = (soa: Partial<TeamMetrics> = {}, purchasing: Partial<TeamMetrics> = {}, rest: Partial<ManagementInput> = {}): ManagementInput => ({
  teams: [
    { area: "SOA", metrics: { ...quiet, ...soa }, base: "/requests/boq?" },
    { area: "Purchasing", metrics: { ...quiet, ...purchasing }, base: "/requests?types=RFQ,PO&" },
  ],
  awaitingHandoff: { count: 0, oldestDays: null, href: "/handoffs" },
  staleProjects: { count: 0, href: "/projects?show=open" },
  financeFlagged: null,
  ...rest,
});

const titles = (concerns: ReturnType<typeof computeConcerns>) => concerns.map((c) => `${c.severity}:${c.area}:${c.key.split(":")[1] ?? c.key}`);

describe("management concerns", () => {
  it("has none when every team is quiet", () => {
    expect(computeConcerns(input())).toEqual([]);
  });

  it("makes an overdue request Danger and a request close to its deadline Warning, each linking to the filtered list", () => {
    const concerns = computeConcerns(input({ overdue: 2, dueNow: 1 }));
    expect(titles(concerns)).toEqual(["DANGER:SOA:overdue", "WARNING:SOA:due-now"]);
    expect(concerns[0]).toMatchObject({ title: "2 request melewati batas SLA", href: "/requests/boq?sla=overdue" });
    expect(computeConcerns(input({}, { overdue: 1 }))[0]?.href).toBe("/requests?types=RFQ,PO&sla=overdue");
  });

  it("flags a backlog only when the oldest Submitted request has waited longer than the limit", () => {
    const bottleneck = (oldestHours: number) => [{ status: "SUBMITTED" as const, count: 3, avgHours: 10, oldestHours, oldestCode: "BOQ-A-260001" }];
    expect(computeConcerns(input({ bottlenecks: bottleneck(BACKLOG_STALE_HOURS) }))).toEqual([]);
    const concerns = computeConcerns(input({ bottlenecks: bottleneck(BACKLOG_STALE_HOURS + 1) }));
    expect(titles(concerns)).toEqual(["WARNING:SOA:backlog"]);
    expect(concerns[0]?.detail).toContain("BOQ-A-260001");
  });

  it("flags requests without a PIC, and a PIC at the limit but not a PIC under it or the Unassigned row", () => {
    const row = (assigneeId: string | null, open: number) => ({ assigneeId, name: assigneeId ?? "Unassigned", open, overdue: 1 });
    const concerns = computeConcerns(input({ unassigned: 4, workload: [row("gita", PIC_OPEN_LIMIT), row("soraya", PIC_OPEN_LIMIT - 1), row(null, 20)] }));
    expect(titles(concerns)).toEqual(["WARNING:SOA:unassigned", "WARNING:SOA:pic"]);
    expect(concerns[1]).toMatchObject({ title: `gita memegang ${PIC_OPEN_LIMIT} request terbuka`, href: "/requests/boq?assignee=gita&status=open" });
  });

  it("grades SLA compliance: fine at the target, Warning below it, Danger far below, nothing without a sample", () => {
    const pct = (value: number | null) => computeConcerns(input({ slaCompliancePct: value, slaMet: 1, slaLate: 1 })).map((c) => c.severity);
    expect(pct(null)).toEqual([]);
    expect(pct(SLA_COMPLIANCE_WARNING_PCT)).toEqual([]);
    expect(pct(SLA_COMPLIANCE_WARNING_PCT - 1)).toEqual(["WARNING"]);
    expect(pct(SLA_COMPLIANCE_DANGER_PCT)).toEqual(["WARNING"]);
    expect(pct(SLA_COMPLIANCE_DANGER_PCT - 1)).toEqual(["DANGER"]);
  });

  it("grades what is stuck between teams: a handoff only waiting is Info, a stale one Warning; few stale projects Info, many Warning", () => {
    expect(titles(computeConcerns(input({}, {}, { awaitingHandoff: { count: 2, oldestDays: HANDOFF_STALE_DAYS, href: "/handoffs" } })))).toEqual(["INFO:Lintas tim:handoff"]);
    expect(titles(computeConcerns(input({}, {}, { awaitingHandoff: { count: 2, oldestDays: HANDOFF_STALE_DAYS + 1, href: "/handoffs" } })))).toEqual(["WARNING:Lintas tim:handoff"]);
    expect(titles(computeConcerns(input({}, {}, { staleProjects: { count: STALE_PROJECTS_WARNING - 1, href: "/p" } })))).toEqual(["INFO:Sales:stale-projects"]);
    expect(titles(computeConcerns(input({}, {}, { staleProjects: { count: STALE_PROJECTS_WARNING, href: "/p" } })))).toEqual(["WARNING:Sales:stale-projects"]);
  });

  it("says nothing about Finance when the viewer cannot read the crosscheck or nothing is flagged", () => {
    expect(computeConcerns(input({}, {}, { financeFlagged: null }))).toEqual([]);
    expect(computeConcerns(input({}, {}, { financeFlagged: { count: 0, href: "/c" } }))).toEqual([]);
    expect(titles(computeConcerns(input({}, {}, { financeFlagged: { count: 3, href: "/c" } })))).toEqual(["WARNING:Finance:finance"]);
  });

  it("lists Danger before Warning before Info, and counts each level", () => {
    const concerns = computeConcerns(input({ dueNow: 1 }, { overdue: 1 }, { awaitingHandoff: { count: 1, oldestDays: 0, href: "/handoffs" } }));
    expect(concerns.map((c) => c.severity)).toEqual(["DANGER", "WARNING", "INFO"]);
    expect(countBySeverity(concerns)).toEqual({ INFO: 1, WARNING: 1, DANGER: 1 });
  });
});
