import { describe, expect, it } from "vitest";
import { buildFunnel } from "@/domain/projects/funnel";

describe("buildFunnel", () => {
  it("counts a project in every step it has passed, merges the two Negotiate steps and leaves Closed Lost out", () => {
    const funnel = buildFunnel([
      { key: "QUALIFY", count: 5, value: 50 },
      { key: "PROPOSE", count: 3, value: 30 },
      { key: "NEGOTIATE", count: 1, value: 10 },
      { key: "NEGOTIATE_FU", count: 1, value: 5 },
      { key: "CLOSED_WON", count: 2, value: 20 },
      { key: "CLOSED_LOST", count: 9, value: 90 },
    ]);

    expect(funnel.map((step) => step.label)).toEqual(["Qualify", "Understand", "Propose", "Negotiate", "Agree", "Closed Won"]);
    expect(funnel.map((step) => step.count)).toEqual([12, 7, 7, 4, 2, 2]);
    expect(funnel[3]!.value).toBe(35);
  });

  it("is all zeros without projects", () => {
    expect(buildFunnel([]).every((step) => step.count === 0 && step.value === 0)).toBe(true);
  });
});
