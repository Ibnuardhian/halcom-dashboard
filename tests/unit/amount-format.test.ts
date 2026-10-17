import { describe, expect, it } from "vitest";
import { parseAmount } from "@/domain/projects/commercial";
import { caretAfterGrouping, formatStoredAmount, groupThousands } from "@/domain/projects/amount-format";

describe("groupThousands", () => {
  it("puts a dot between every three digits and drops everything that is not a digit", () => {
    expect(groupThousands("2500000000")).toBe("2.500.000.000");
    expect(groupThousands("1234")).toBe("1.234");
    expect(groupThousands("999")).toBe("999");
    expect(groupThousands("Rp 1.200,5 abc")).toBe("12.005");
    expect(groupThousands("")).toBe("");
    expect(groupThousands("007")).toBe("7");
  });

  it("is read back by the server as the same number", () => {
    for (const typed of ["5", "1234", "2500000000", "150000"]) {
      expect(parseAmount("Amount", groupThousands(typed))).toEqual({ ok: true, value: Number(typed) });
    }
  });
});

describe("formatStoredAmount", () => {
  it("groups whole amounts and leaves an amount with cents alone", () => {
    expect(formatStoredAmount("1500000")).toBe("1.500.000");
    expect(formatStoredAmount("1500.5")).toBe("1500.5");
    expect(formatStoredAmount("")).toBe("");
  });
});

describe("caretAfterGrouping", () => {
  it("keeps the caret after the same digit when dots are added", () => {
    expect(caretAfterGrouping("1.234", 4)).toBe(5);
    expect(caretAfterGrouping("1.234", 1)).toBe(1);
    expect(caretAfterGrouping("1.234", 2)).toBe(3);
    expect(caretAfterGrouping("1.234", 0)).toBe(0);
    expect(caretAfterGrouping("1.234", 9)).toBe(5);
  });
});
