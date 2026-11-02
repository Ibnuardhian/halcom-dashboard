import { describe, expect, it } from "vitest";
import { targetMarginAmount, targetMarginPercentOf } from "@/domain/projects/pipeline";
import { DEFAULT_TAX_BASIS, marginFactor, readTaxBasis } from "@/domain/projects/tax-basis";

describe("tax basis", () => {
  it("takes a margin percentage of the value without PPN when Sales enter the value with PPN", () => {
    const factor = marginFactor(DEFAULT_TAX_BASIS);
    expect(factor).toBeCloseTo(1 / 1.11, 10);
    // 111,000,000 with PPN is 100,000,000 without: 10% of it is 10,000,000, not 11,100,000.
    expect(targetMarginAmount(111_000_000, null, 10, null, factor)).toBe(10_000_000);
    // A gross profit amount (without PPN) over the value with PPN gives the true margin of the sale without PPN.
    expect(targetMarginPercentOf(111_000_000, null, null, 10_000_000, factor)).toBe(10);
    expect(targetMarginPercentOf(111_000_000, null, null, 10_000_000)).toBe(9.01);
  });

  it("is 1 when value and margin are on the same basis, and goes the other way when only the margin has PPN", () => {
    expect(marginFactor({ valueIncludesTax: true, marginIncludesTax: true, taxRatePercent: 11 })).toBe(1);
    expect(marginFactor({ valueIncludesTax: false, marginIncludesTax: false, taxRatePercent: 11 })).toBe(1);
    expect(marginFactor({ valueIncludesTax: false, marginIncludesTax: true, taxRatePercent: 10 })).toBeCloseTo(1.1, 10);
  });

  it("reads a stored basis back, falling back to the default for anything unusable", () => {
    expect(readTaxBasis(null)).toEqual(DEFAULT_TAX_BASIS);
    expect(readTaxBasis({ valueIncludesTax: false, marginIncludesTax: false, taxRatePercent: 12 })).toEqual({ valueIncludesTax: false, marginIncludesTax: false, taxRatePercent: 12 });
    expect(readTaxBasis({ valueIncludesTax: "yes", taxRatePercent: 99 })).toEqual(DEFAULT_TAX_BASIS);
  });
});
