import { describe, expect, it } from "vitest";
import { formatAmount, formatPercent } from "@/features/projects/format";

describe("project value formatting", () => {
  it("groups thousands and shows an en dash for unknown values", () => {
    expect(formatAmount(1_200_000_000)).toBe("1.200.000.000");
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(null)).toBe("–");
  });

  it("shows a percentage or an en dash", () => {
    expect(formatPercent(40)).toBe("40%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(null)).toBe("–");
  });
});
