import { describe, expect, it } from "vitest";
import { cumulate, paceAt, percentOf, quartersElapsed, summariseTargets, type TargetProject } from "@/domain/targets/quarters";

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

describe("quarterly gross profit", () => {
  it("puts won gross profit in the quarter of the won date, with the year edges", () => {
    const summary = summariseTargets(2026, [won("2026-01-01"), won("2026-03-31"), won("2026-12-31"), won("2025-12-31"), won("2027-01-01")], []);

    expect(summary.quarters.map((q) => q.grossProfit.won)).toEqual([200, 0, 0, 100]);
    expect(summary.wonCount).toBe(3);
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

    expect(summary.quarters[0]!.grossProfit.won).toBe(250);
    expect(summary.quarters[1]!.grossProfit.won).toBe(0);
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

  it("tells a missing quarter target from a target of zero", () => {
    const summary = summariseTargets(2026, [], [
      { quarter: 1, revenueTarget: null, grossProfitTarget: 0 },
      { quarter: 3, revenueTarget: null, grossProfitTarget: 300 },
    ]);

    expect(summary.quarters.map((q) => q.grossProfit.target)).toEqual([0, null, 300, null]);
    expect(summary.total.grossProfit.target).toBe(300);
    expect(cumulate(summary.quarters).map((p) => p.target)).toEqual([0, 0, 300, 300]);
  });
});

describe("cumulate and paceAt", () => {
  const summary = summariseTargets(2026, [won("2026-05-01", { targetMargin: 5 })], [
    { quarter: 1, revenueTarget: null, grossProfitTarget: 100 },
    { quarter: 2, revenueTarget: null, grossProfitTarget: 100 },
  ]);

  it("runs from Q1, and draws no target line when no quarter has a target", () => {
    expect(cumulate(summary.quarters)).toEqual([
      { quarter: 1, target: 100, won: 0 },
      { quarter: 2, target: 200, won: 50 },
      { quarter: 3, target: 200, won: 50 },
      { quarter: 4, target: 200, won: 50 },
    ]);
    expect(cumulate(summariseTargets(2026, [], []).quarters).every((p) => p.target === null)).toBe(true);
  });

  it("measures achieved against the target planned up to the quarter, and says nothing without a target", () => {
    expect(paceAt(cumulate(summary.quarters), 2)).toEqual({ target: 200, won: 50, gap: -150, percent: 25 });
    expect(paceAt(cumulate(summariseTargets(2026, [], []).quarters), 2)).toBeNull();
  });
});

describe("percentOf and quartersElapsed", () => {
  it("never divides by a missing or zero target, and passes 100 when over target", () => {
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(5, null)).toBeNull();
    expect(percentOf(150, 100)).toBe(150);
  });

  it("treats a past year as complete, a future year as not started and this year as running to the current quarter", () => {
    expect(quartersElapsed(2025, { year: 2026, month: 7 })).toBe(4);
    expect(quartersElapsed(2027, { year: 2026, month: 7 })).toBe(0);
    expect(quartersElapsed(2026, { year: 2026, month: 7 })).toBe(3);
    expect(quartersElapsed(2026, { year: 2026, month: 12 })).toBe(4);
  });
});
