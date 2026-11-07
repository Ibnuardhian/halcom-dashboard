import { describe, expect, it } from "vitest";
import { REVISION_REQUESTED_KIND, REVISION_STARTED_KIND, SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND } from "@/domain/notifications/kinds";
import { SLA_ALERT_KIND, slaAlertKey, slaAlertLevel, slaAlertText, slaRoundStart } from "@/domain/notifications/sla-alerts";
import { bellSeverity, defaultSeverityFor, highestSeverity, isNotificationSeverity, unreadSummary } from "@/domain/notifications/severity";
import { slaOf, type SlaRange } from "@/domain/requests/sla";

describe("notification levels", () => {
  it("makes a revision Danger and everything else Info when the writer names no level", () => {
    expect(defaultSeverityFor(REVISION_REQUESTED_KIND)).toBe("DANGER");
    expect(defaultSeverityFor(REVISION_STARTED_KIND)).toBe("DANGER");
    expect(defaultSeverityFor("request.created")).toBe("INFO");
    expect(defaultSeverityFor("project.updated")).toBe("INFO");
  });

  it("takes the loudest level for the bell, and none when nothing is unread", () => {
    expect(highestSeverity([])).toBeNull();
    expect(highestSeverity(["INFO", "DANGER", "WARNING"])).toBe("DANGER");
    expect(bellSeverity({ INFO: 3, WARNING: 0, DANGER: 0 })).toBe("INFO");
    expect(bellSeverity({ INFO: 3, WARNING: 1, DANGER: 0 })).toBe("WARNING");
    expect(bellSeverity({ INFO: 0, WARNING: 0, DANGER: 0 })).toBeNull();
  });

  it("writes the unread counts loudest first and leaves out empty levels", () => {
    expect(unreadSummary({ INFO: 4, WARNING: 1, DANGER: 2 })).toBe("2 danger, 1 warning, 4 info");
    expect(unreadSummary({ INFO: 4, WARNING: 0, DANGER: 0 })).toBe("4 info");
  });

  it("knows its own values", () => {
    expect(isNotificationSeverity("WARNING")).toBe(true);
    expect(isNotificationSeverity("warning")).toBe(false);
    expect(isNotificationSeverity(null)).toBe(false);
  });
});

describe("SLA alerts", () => {
  // Monday 2026-11-02 03:00 UTC (10:00 in Jakarta); an SLA of 2 to 3 working days: expected Wednesday, due Thursday.
  const createdAt = new Date("2026-11-02T03:00:00Z");
  const range: SlaRange = { minDays: 2, maxDays: 3 };
  const sla = (now: string, status: "SUBMITTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "REVISION" = "IN_PROGRESS", history: { toStatus: "REVISION" | "COMPLETED" | "SUBMITTED"; changedAt: Date }[] = []) =>
    slaOf({ createdAt, status, completedAt: status === "COMPLETED" ? new Date("2026-11-03T03:00:00Z") : null, history, range, now: new Date(now) });

  it("is silent while the request is on track, a Warning from the expected date, and Danger after the deadline", () => {
    expect(slaAlertLevel(sla("2026-11-03T03:00:00Z"), new Date("2026-11-03T03:00:00Z"))).toBeNull(); // Tuesday: on track
    expect(slaAlertLevel(sla("2026-11-04T03:00:00Z"), new Date("2026-11-04T03:00:00Z"))).toBe("WARNING"); // Wednesday: the expected date
    expect(slaAlertLevel(sla("2026-11-05T03:00:00Z"), new Date("2026-11-05T03:00:00Z"))).toBe("WARNING"); // Thursday, exactly at the deadline: not yet late
    expect(slaAlertLevel(sla("2026-11-05T03:01:00Z"), new Date("2026-11-05T03:01:00Z"))).toBe("DANGER");
  });

  it("stops alerting a deadline that passed more than a week ago, so the first scan does not flood", () => {
    // Due Thursday 2026-11-05 03:00 UTC.
    expect(slaAlertLevel(sla("2026-11-12T03:00:00Z"), new Date("2026-11-12T03:00:00Z"))).toBe("DANGER"); // exactly 7 days after
    expect(slaAlertLevel(sla("2026-11-12T03:01:00Z"), new Date("2026-11-12T03:01:00Z"))).toBeNull();
    expect(slaAlertLevel(sla("2026-12-01T03:00:00Z"), new Date("2026-12-01T03:00:00Z"))).toBeNull();
  });

  it("counts the weekend out", () => {
    // Created Friday: expected Tuesday, due Wednesday. The weekend does not count.
    const friday = slaOf({ createdAt: new Date("2026-11-06T03:00:00Z"), status: "IN_PROGRESS", completedAt: null, history: [], range, now: new Date("2026-11-09T03:00:00Z") });
    expect(slaAlertLevel(friday, new Date("2026-11-09T03:00:00Z"))).toBeNull(); // Monday: one working day in
  });

  it("says nothing for a finished request", () => {
    expect(slaAlertLevel(sla("2026-12-01T03:00:00Z", "COMPLETED"), new Date("2026-12-01T03:00:00Z"))).toBeNull();
    expect(slaAlertLevel(sla("2026-12-01T03:00:00Z", "CANCELLED"), new Date("2026-12-01T03:00:00Z"))).toBeNull();
  });

  it("starts a new round for a revision, with its own key", () => {
    const sentBack = new Date("2026-11-10T03:00:00Z");
    const history = [
      { toStatus: "COMPLETED" as const, changedAt: new Date("2026-11-03T03:00:00Z") },
      { toStatus: "REVISION" as const, changedAt: sentBack },
    ];
    const revising = sla("2026-11-16T03:00:00Z", "REVISION", history); // Monday: 4 working days after the revision began
    expect(slaAlertLevel(revising, new Date("2026-11-16T03:00:00Z"))).toBe("DANGER");
    expect(slaRoundStart(createdAt, revising, "REVISION")).toEqual(sentBack);
    expect(slaRoundStart(createdAt, sla("2026-11-04T03:00:00Z"), "IN_PROGRESS")).toEqual(createdAt);
    expect(slaAlertKey("r1", sentBack, "DANGER")).not.toBe(slaAlertKey("r1", createdAt, "DANGER"));
  });

  it("keeps one key per request, round and level", () => {
    expect(slaAlertKey("r1", createdAt, "WARNING")).toBe(slaAlertKey("r1", new Date(createdAt), "WARNING"));
    expect(slaAlertKey("r1", createdAt, "WARNING")).not.toBe(slaAlertKey("r1", createdAt, "DANGER"));
    expect(SLA_ALERT_KIND).toEqual({ WARNING: SLA_DUE_SOON_KIND, DANGER: SLA_OVERDUE_KIND });
  });

  it("writes the code, the deadline and the PIC, and how late for a Danger", () => {
    const dueAt = new Date("2026-11-05T03:00:00Z");
    const base = { code: "BOQ-A-260001", type: "BOQ" as const, dueAt, now: new Date("2026-11-09T03:00:00Z"), revision: false, picName: "Adityo", title: "CCTV Gudang" };
    const warning = slaAlertText({ ...base, level: "WARNING" });
    expect(warning.title).toBe("BOQ-A-260001 mendekati batas SLA");
    expect(warning.body).toContain("2026-11-05");
    expect(warning.body).toContain("PIC: Adityo");
    const danger = slaAlertText({ ...base, level: "DANGER", picName: null, revision: true });
    expect(danger.title).toBe("Revisi BOQ-A-260001 melewati batas SLA");
    expect(danger.body).toContain("Terlambat 2 hari kerja");
    expect(danger.body).toContain("Belum ada PIC");
  });
});
