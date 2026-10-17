import { describe, expect, it } from "vitest";
import { percentOf, quarterOf, summariseTargets, type TargetProject } from "@/domain/targets/quarters";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const project = (overrides: Partial<TargetProject>): TargetProject => ({
  progress: "PROPOSE",
  trackStatus: "ON_TRACK",
  estimatedValue: null,
  finalValue: null,
  probability: null,
  targetMargin: null,
  wonDate: null,
  targetDate: null,
  ...overrides,
});

describe("quarterOf", () => {
  it("puts the calendar months in their quarters, on the date as written", () => {
    expect(quarterOf(day("2026-01-01"))).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf(day("2026-03-31"))).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf(day("2026-04-01"))).toEqual({ year: 2026, quarter: 2 });
    expect(quarterOf(day("2026-09-30"))).toEqual({ year: 2026, quarter: 3 });
    expect(quarterOf(day("2026-12-31"))).toEqual({ year: 2026, quarter: 4 });
  });
});

describe("percentOf", () => {
  it("is empty without a target, and can pass 100", () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(250, 200)).toBe(125);
    expect(percentOf(10, null)).toBeNull();
    expect(percentOf(10, 0)).toBeNull();
    expect(percentOf(1, 3)).toBe(33.3);
  });
});

describe("summariseTargets", () => {
  it("counts won projects by won date, with the final value (the estimate until known) and the target margin", () => {
    const summary = summariseTargets(
      2026,
      [
        project({ progress: "CLOSED_WON", estimatedValue: 1_000, finalValue: 800, targetMargin: 10, wonDate: day("2026-02-10") }),
        project({ progress: "CLOSED_WON", estimatedValue: 500, targetMargin: 20, wonDate: day("2026-05-02") }),
        project({ progress: "CLOSED_WON", estimatedValue: 700, targetMargin: 10, wonDate: day("2025-12-30") }), // another year
      ],
      [{ quarter: 1, revenueTarget: 2_000, grossProfitTarget: 200 }],
    );

    expect(summary.quarters[0]!.revenue).toEqual({ target: 2_000, won: 800, forecast: 0 });
    expect(summary.quarters[0]!.grossProfit).toEqual({ target: 200, won: 80, forecast: 0 });
    expect(summary.quarters[1]!.revenue).toMatchObject({ target: null, won: 500 });
    expect(summary.quarters[1]!.grossProfit.won).toBe(100);
    expect(summary.total.revenue).toEqual({ target: 2_000, won: 1_300, forecast: 0 });
  });

  it("forecasts open projects by target closing date with estimate × probability, and ignores closed or done ones", () => {
    const summary = summariseTargets(
      2026,
      [
        project({ estimatedValue: 1_000, probability: 30, targetMargin: 10, targetDate: day("2026-08-15") }),
        project({ estimatedValue: 2_000, probability: 60, targetMargin: 5, targetDate: day("2026-09-01"), progress: "NEGOTIATE" }),
        project({ estimatedValue: 9_999, probability: 95, targetDate: day("2026-08-01"), trackStatus: "DONE" }),
        project({ estimatedValue: 9_999, probability: 0, targetDate: day("2026-08-01"), progress: "CLOSED_LOST" }),
      ],
      [],
    );

    expect(summary.quarters[2]!.revenue.forecast).toBe(1_500); // 300 + 1200
    expect(summary.quarters[2]!.grossProfit.forecast).toBe(90); // 30 + 60
    expect(summary.total.revenue.target).toBeNull();
  });

  it("does not guess: what is missing is counted in the notes, not invented", () => {
    const summary = summariseTargets(
      2026,
      [
        project({ progress: "CLOSED_WON", estimatedValue: 100 }), // no won date
        project({ progress: "CLOSED_WON", estimatedValue: 100, wonDate: day("2026-01-05") }), // no margin
        project({ estimatedValue: 100, probability: 50 }), // no target date
        project({ estimatedValue: 100, targetDate: day("2026-06-01") }), // no probability: the Progress step (Propose, 30%) stands in
        project({ targetDate: day("2026-06-01"), probability: 50 }), // no value at all: nothing to report
      ],
      [],
    );

    expect(summary.notes).toEqual({ wonWithoutDate: 1, wonWithoutMargin: 1, openWithoutTargetDate: 1, openWithoutProbability: 0 });
    expect(summary.total.revenue).toEqual({ target: null, won: 100, forecast: 30 });
    expect(summary.total.grossProfit.won).toBe(0);
  });

  it("adds a year's targets up and leaves a blank gross-profit target blank", () => {
    const summary = summariseTargets(2026, [], [
      { quarter: 1, revenueTarget: 100, grossProfitTarget: null },
      { quarter: 3, revenueTarget: 50, grossProfitTarget: null },
    ]);

    expect(summary.total.revenue.target).toBe(150);
    expect(summary.total.grossProfit.target).toBeNull();
  });
});
