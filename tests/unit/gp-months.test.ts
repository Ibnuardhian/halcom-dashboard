import { describe, expect, it } from "vitest";
import { cumulate, monthsElapsed, paceAt, percentOf, quarterOfMonth, summariseTargets, type TargetProject } from "@/domain/targets/quarters";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const project = (overrides: Partial<TargetProject>): TargetProject => ({
  progress: "PROPOSE",
  trackStatus: "ON_TRACK",
  estimatedValue: null,
  finalValue: null,
  targetMargin: null,
  targetMarginValue: null,
  wonDate: null,
  targetDate: null,
  ...overrides,
});

const won = (wonDate: string, extra: Partial<TargetProject> = {}) => project({ progress: "CLOSED_WON", estimatedValue: 1000, targetMargin: 10, wonDate: day(wonDate), ...extra });

describe("monthly gross profit", () => {
  it("puts won gross profit in the month of the won date, with January and December at the year edges", () => {
    const summary = summariseTargets(2026, [won("2026-01-01"), won("2026-12-31"), won("2025-12-31"), won("2027-01-01")], []);

    expect(summary.months[0]!.won).toBe(100);
    expect(summary.months[11]!.won).toBe(100);
    expect(summary.months.reduce((sum, m) => sum + m.won, 0)).toBe(200);
    expect(summary.wonCount).toBe(2);
  });

  it("counts a project once, uses the fixed margin amount when given, and leaves out lost, open and undated projects", () => {
    const summary = summariseTargets(
      2026,
      [
        won("2026-03-05", { targetMarginValue: 250 }),
        project({ progress: "CLOSED_LOST", estimatedValue: 5000, targetMargin: 50, wonDate: day("2026-03-05") }),
        project({ estimatedValue: 5000, targetMargin: 50, targetDate: day("2026-03-20") }),
        project({ progress: "CLOSED_WON", estimatedValue: 100, targetMargin: 10 }),
        won("2026-04-01", { targetMargin: null }),
      ],
      [],
    );

    expect(summary.months[2]!.won).toBe(250);
    expect(summary.months[3]!.won).toBe(0);
    expect(summary.wonCount).toBe(2);
    expect(summary.notes).toMatchObject({ wonWithoutDate: 1, wonWithoutMargin: 1 });
  });

  it("keeps open pipeline apart from achieved and applies no probability to it", () => {
    const summary = summariseTargets(
      2026,
      [project({ progress: "NEGOTIATE", estimatedValue: 2000, targetMargin: 10, targetDate: day("2026-08-01") }), project({ estimatedValue: 400, targetMarginValue: 30, targetDate: day("2027-01-01") })],
      [],
    );

    expect(summary.openPipelineGp).toBe(200);
    expect(summary.total.grossProfit.won).toBe(0);
  });

  it("tells a missing month target from a target of zero, and sums the months of a quarter into the cumulative line", () => {
    const summary = summariseTargets(2026, [], [], [
      { month: 1, grossProfitTarget: 0 },
      { month: 3, grossProfitTarget: 300 },
    ]);

    expect(summary.months.map((m) => m.target).slice(0, 4)).toEqual([0, null, 300, null]);
    expect(cumulate(summary.months).map((p) => p.target).slice(0, 4)).toEqual([0, 0, 300, 300]);
  });
});

describe("cumulate and paceAt", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, target: i < 3 ? 100 : null, won: i === 1 ? 50 : 0 }));

  it("runs from January, and draws no target line when no month has a target", () => {
    expect(cumulate(months).slice(0, 4)).toEqual([
      { month: 1, target: 100, won: 0 },
      { month: 2, target: 200, won: 50 },
      { month: 3, target: 300, won: 50 },
      { month: 4, target: 300, won: 50 },
    ]);
    expect(cumulate(months.map((m) => ({ ...m, target: null }))).every((p) => p.target === null)).toBe(true);
  });

  it("measures achieved against the target planned up to the month, and says nothing without a target", () => {
    expect(paceAt(cumulate(months), 2)).toEqual({ target: 200, won: 50, gap: -150, percent: 25 });
    expect(paceAt(cumulate(months.map((m) => ({ ...m, target: null }))), 2)).toBeNull();
  });
});

describe("percentOf, monthsElapsed and quarterOfMonth", () => {
  it("never divides by a missing or zero target, and passes 100 when over target", () => {
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(5, null)).toBeNull();
    expect(percentOf(150, 100)).toBe(150);
  });

  it("treats a past year as complete, a future year as not started and this year as running to the current month", () => {
    expect(monthsElapsed(2025, { year: 2026, month: 7 })).toBe(12);
    expect(monthsElapsed(2027, { year: 2026, month: 7 })).toBe(0);
    expect(monthsElapsed(2026, { year: 2026, month: 7 })).toBe(7);
  });

  it("groups months in calendar quarters", () => {
    expect([1, 3, 4, 9, 10, 12].map(quarterOfMonth)).toEqual([1, 1, 2, 3, 4, 4]);
  });
});
