import { describe, expect, it } from "vitest";
import { areaPath, labelStep, monotonePath, niceTicks, runs } from "@/components/charts/line-math";
import {
  buildPeriods,
  categoryOf,
  compareCounts,
  describeComparison,
  GRANULARITY_PERIODS,
  GROWTH_CATEGORIES,
  GROWTH_COLORS,
  GROWTH_STAGES,
  isGranularity,
  percentOf,
  percentsOf,
  pipelineConversion,
  PROPOSE_OR_BEYOND,
  totalOf,
  type GrowthPoint,
} from "@/domain/projects/growth";
import { summariseGrowth, tooltipLine } from "@/domain/projects/growth-cards";
import { PROJECT_PROGRESSES } from "@/domain/projects/progress";

describe("the three groups", () => {
  it("puts every progress step in one group, or none for Closed Lost", () => {
    expect(Object.fromEntries(PROJECT_PROGRESSES.map((p) => [p, categoryOf(p)]))).toEqual({
      QUALIFY: "OPPORTUNITY",
      UNDERSTAND: "OPPORTUNITY",
      PROPOSE: "QUOTED",
      NEGOTIATE: "QUOTED",
      NEGOTIATE_FU: "QUOTED",
      AGREE: "QUOTED",
      CLOSED_WON: "CLOSED_WON",
      CLOSED_LOST: null,
    });
  });

  it("is exclusive and complete over the open and won steps", () => {
    const all = GROWTH_CATEGORIES.flatMap((category) => [...GROWTH_STAGES[category]]);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(PROJECT_PROGRESSES.filter((p) => p !== "CLOSED_LOST").sort());
  });

  it("does not guess a group for an unknown, empty or differently written stage", () => {
    for (const value of ["", "propose", "NEGOTIATE (FU)", "ARCHIVED", "null"]) expect(categoryOf(value)).toBeNull();
  });

  it("uses the three colours of the brief", () => {
    expect(GROWTH_COLORS).toEqual({ OPPORTUNITY: "#F5B800", QUOTED: "#2F80ED", CLOSED_WON: "#10B981" });
  });
});

describe("Pipeline Conversion", () => {
  it("is open projects at Propose or beyond over open projects", () => {
    expect(pipelineConversion(55, 18)).toEqual({ open: 55, atPropose: 18, percent: 32.7 });
    expect(pipelineConversion(4, 4).percent).toBe(100);
    expect(pipelineConversion(4, 0).percent).toBe(0);
  });

  it("has no value, not NaN, without open projects", () => {
    expect(pipelineConversion(0, 0).percent).toBeNull();
  });

  it("counts Propose, Negotiate, Negotiate (FU) and Agree as beyond", () => {
    expect([...PROPOSE_OR_BEYOND]).toEqual(["PROPOSE", "NEGOTIATE", "NEGOTIATE_FU", "AGREE"]);
  });
});

describe("percentages", () => {
  it("divide by the eligible total with one decimal, and are zero for an empty total", () => {
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(Number.NaN, 4)).toBe(0);
    expect(percentsOf({ OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 })).toEqual({ OPPORTUNITY: 0, QUOTED: 0, CLOSED_WON: 0 });
  });

  it("add up to 100 within rounding", () => {
    const counts = { OPPORTUNITY: 7, QUOTED: 3, CLOSED_WON: 1 };
    const p = percentsOf(counts);
    expect(Math.abs(p.OPPORTUNITY + p.QUOTED + p.CLOSED_WON - 100)).toBeLessThan(0.2);
    expect(totalOf(counts)).toBe(11);
  });
});

describe("periods", () => {
  // Wednesday 21 October 2026, 10:00 in Jakarta (UTC+7).
  const wednesday = new Date("2026-10-21T03:00:00Z");

  it("weekly: twelve ISO weeks starting on Monday at midnight Jakarta time, the last one still running", () => {
    const periods = buildPeriods("weekly", wednesday);
    expect(periods).toHaveLength(GRANULARITY_PERIODS.weekly);
    const last = periods.at(-1)!;
    expect(last.start.toISOString()).toBe("2026-10-18T17:00:00.000Z"); // Monday 19 Oct 00:00 +07
    expect(last.endExclusive.toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(last.running).toBe(true);
    expect(last.asOf).toEqual(wednesday);
    expect(last.label).toBe("W43 2026 · 19–25 Oct");
    // Consecutive, seven days each, no gap and no overlap.
    periods.forEach((period, i) => {
      expect(period.endExclusive.getTime() - period.start.getTime()).toBe(7 * 86_400_000);
      if (i > 0) expect(period.start).toEqual(periods[i - 1]!.endExclusive);
    });
    expect(periods.slice(0, -1).every((p) => !p.running && p.asOf.getTime() === p.endExclusive.getTime() - 1)).toBe(true);
  });

  it("weekly: a Sunday evening in Jakarta is still the old week, and the next minute is the new one", () => {
    const sunday = buildPeriods("weekly", new Date("2026-10-25T16:59:00Z")).at(-1)!;
    const monday = buildPeriods("weekly", new Date("2026-10-25T17:00:00Z")).at(-1)!;
    expect(sunday.label).toContain("W43");
    expect(monday.label).toContain("W44");
    expect(monday.start.toISOString()).toBe("2026-10-25T17:00:00.000Z");
  });

  it("weekly: a week across the year end is one ISO week of the earlier year, and the first days of January can belong to week 53", () => {
    const labels = buildPeriods("weekly", new Date("2027-01-03T05:00:00Z")).map((p) => p.label);
    expect(labels.at(-1)).toBe("W53 2026 · 28 Dec – 3 Jan");
    expect(labels.at(-2)).toBe("W52 2026 · 21–27 Dec");
    expect(buildPeriods("weekly", new Date("2027-01-04T05:00:00Z")).at(-1)!.label).toBe("W01 2027 · 4–10 Jan");
    // ISO week 1 of 2026 starts on Monday 29 December 2025.
    expect(buildPeriods("weekly", new Date("2026-01-01T05:00:00Z")).at(-1)!.label).toBe("W01 2026 · 29 Dec – 4 Jan");
  });

  it("monthly: twelve calendar months by default, labelled with month and year", () => {
    const periods = buildPeriods("monthly", new Date("2026-01-15T05:00:00Z"));
    expect(periods).toHaveLength(12);
    expect(periods[0]!.label).toBe("Feb 2025");
    expect(periods.at(-1)!.label).toBe("Jan 2026");
    expect(periods.at(-1)!.start.toISOString()).toBe("2025-12-31T17:00:00.000Z"); // 1 Jan 00:00 +07
    expect(periods.at(-2)!.label).toBe("Dec 2025");
  });

  it("monthly: the moment 17:00 UTC on the last day of the month is already the next month in Jakarta", () => {
    expect(buildPeriods("monthly", new Date("2025-12-31T16:59:59Z")).at(-1)!.label).toBe("Dec 2025");
    expect(buildPeriods("monthly", new Date("2025-12-31T17:00:00Z")).at(-1)!.label).toBe("Jan 2026");
  });

  it("quarterly: calendar quarters Q1 to Q4 with the year, eight by default", () => {
    const periods = buildPeriods("quarterly", new Date("2026-10-23T05:00:00Z"));
    expect(periods).toHaveLength(8);
    expect(periods.map((p) => p.label)).toEqual(["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
    expect(periods.at(-1)!.start.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(periods.at(-2)!.asOf.toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(buildPeriods("quarterly", new Date("2026-01-01T00:00:00Z")).at(-1)!.label).toBe("Q1 2026");
    expect(buildPeriods("quarterly", new Date("2026-03-31T16:59:00Z")).at(-1)!.label).toBe("Q1 2026");
    expect(buildPeriods("quarterly", new Date("2026-03-31T17:00:00Z")).at(-1)!.label).toBe("Q2 2026");
  });

  it("accepts only the three granularities", () => {
    expect(["weekly", "monthly", "quarterly"].every(isGranularity)).toBe(true);
    for (const value of ["daily", "", "Weekly", null, undefined, 3]) expect(isGranularity(value)).toBe(false);
  });
});

describe("comparisons", () => {
  it("says N/A when a period is unknown, New when it was zero, and no change when equal", () => {
    expect(compareCounts(3, null)).toEqual({ kind: "na" });
    expect(compareCounts(null, 3)).toEqual({ kind: "na" });
    expect(compareCounts(4, 0)).toEqual({ kind: "new", delta: 4 });
    expect(compareCounts(0, 0)).toMatchObject({ kind: "flat" });
    expect(compareCounts(5, 5)).toMatchObject({ kind: "flat" });
  });

  it("gives the change and its percentage against the period before, up or down", () => {
    expect(compareCounts(12, 10)).toEqual({ kind: "change", delta: 2, percent: 20 });
    expect(compareCounts(7, 10)).toEqual({ kind: "change", delta: -3, percent: -30 });
    expect(compareCounts(0, 4)).toEqual({ kind: "change", delta: -4, percent: -100 });
  });

  it("words them without calling a fall bad", () => {
    expect(describeComparison({ kind: "na" }, "week")).toBe("N/A");
    expect(describeComparison({ kind: "new", delta: 2 }, "week")).toBe("New (+2)");
    expect(describeComparison({ kind: "change", delta: -3, percent: -30 }, "month")).toBe("−3 (−30%) vs previous month");
    expect(describeComparison({ kind: "change", delta: 2, percent: 20 }, "quarter")).toBe("+2 (+20%) vs previous quarter");
  });
});

describe("the summary cards and the tooltip", () => {
  const point = (key: string, counts: GrowthPoint["counts"]): GrowthPoint => ({
    key,
    label: key,
    start: "2026-01-01T00:00:00Z",
    asOf: "2026-01-31T00:00:00Z",
    running: false,
    reliable: counts !== null,
    counts,
    total: counts ? totalOf(counts) : null,
    percents: counts ? percentsOf(counts) : null,
  });

  it("show the latest period against the one before, from the same points as the chart", () => {
    const cards = summariseGrowth([point("a", { OPPORTUNITY: 10, QUOTED: 2, CLOSED_WON: 0 }), point("b", { OPPORTUNITY: 8, QUOTED: 4, CLOSED_WON: 1 })]);
    expect(cards.map((c) => [c.category, c.count, c.percent])).toEqual([["OPPORTUNITY", 8, 61.5], ["QUOTED", 4, 30.8], ["CLOSED_WON", 1, 7.7]]);
    expect(cards[0]!.comparison).toEqual({ kind: "change", delta: -2, percent: -20 });
    expect(cards[1]!.comparison).toEqual({ kind: "change", delta: 2, percent: 100 });
    expect(cards[2]!.comparison).toEqual({ kind: "new", delta: 1 });
    expect(cards.map((c) => c.color)).toEqual(["#F5B800", "#2F80ED", "#10B981"]);
  });

  it("give N/A for the comparison when the earlier period has no history, and nothing when there are no points", () => {
    const cards = summariseGrowth([point("a", null), point("b", { OPPORTUNITY: 1, QUOTED: 0, CLOSED_WON: 0 })]);
    expect(cards[0]!.comparison).toEqual({ kind: "na" });
    expect(summariseGrowth([point("a", null)]).map((c) => c.count)).toEqual([null, null, null]);
    expect(summariseGrowth([]).map((c) => c.count)).toEqual([null, null, null]);
  });

  it("formats a tooltip line with the count and the percentage", () => {
    expect(tooltipLine("QUOTED", 18, 32.14)).toBe("Quoted: 18 projects (32.1%)");
    expect(tooltipLine("CLOSED_WON", 1, 100)).toBe("Closed Won: 1 project (100.0%)");
  });
});

describe("line geometry", () => {
  it("draws a smooth curve that stays between its points", () => {
    const d = monotonePath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }]);
    expect(d.startsWith("M0,10C")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
    // No control point leaves the range of the two points it belongs to.
    const pts = [{ y: 10 }, { y: 0 }, { y: 0 }, { y: 10 }];
    const segments = [...d.matchAll(/C([\d.-]+),([\d.-]+),([\d.-]+),([\d.-]+),([\d.-]+),([\d.-]+)/g)];
    expect(segments).toHaveLength(3);
    segments.forEach((m, i) => {
      const [low, high] = [Math.min(pts[i]!.y, pts[i + 1]!.y), Math.max(pts[i]!.y, pts[i + 1]!.y)];
      for (const y of [Number(m[2]), Number(m[4])]) {
        expect(y).toBeGreaterThanOrEqual(low);
        expect(y).toBeLessThanOrEqual(high);
      }
    });
  });

  it("handles one point, two points and none", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 5, y: 5 }])).toBe("M5,5");
    expect(monotonePath([{ x: 0, y: 0 }, { x: 4, y: 2 }])).toBe("M0,0L4,2");
    expect(areaPath([{ x: 5, y: 5 }], 20)).toBe("");
    expect(areaPath([{ x: 0, y: 5 }, { x: 4, y: 3 }], 20)).toBe("M0,5L4,3L4,20L0,20Z");
  });

  it("breaks the line where a period has no value", () => {
    expect(runs([1, 2, null, null, 3, null, 4, 5])).toEqual([{ start: 0, items: [1, 2] }, { start: 4, items: [3] }, { start: 6, items: [4, 5] }]);
    expect(runs([null, null])).toEqual([]);
  });

  it("makes whole-number ticks from zero, also for empty data", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7).at(-1)).toBeGreaterThanOrEqual(7);
    expect(niceTicks(61).every((t) => Number.isInteger(t))).toBe(true);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });

  it("drops labels so that they do not touch", () => {
    expect(labelStep(12, 60, 900)).toBe(1);
    expect(labelStep(12, 60, 300)).toBe(3);
    expect(labelStep(1, 60, 100)).toBe(1);
    expect(labelStep(12, 60, 0)).toBe(1);
  });
});
