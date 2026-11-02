import { describe, expect, it } from "vitest";
import { overdueWorkingDays } from "@/domain/requests/sla";

describe("overdueWorkingDays", () => {
  const friday = new Date("2026-11-06T10:00:00Z");
  it("is 0 when the request was not late, and 1 for any lateness within the first working day", () => {
    expect(overdueWorkingDays(friday, new Date("2026-11-06T09:00:00Z"))).toBe(0);
    expect(overdueWorkingDays(friday, new Date("2026-11-06T10:00:00Z"))).toBe(0);
    expect(overdueWorkingDays(friday, new Date("2026-11-06T11:00:00Z"))).toBe(1);
  });
  it("skips the weekend", () => {
    expect(overdueWorkingDays(friday, new Date("2026-11-09T09:00:00Z"))).toBe(1); // Monday morning: next working day after Friday
    expect(overdueWorkingDays(friday, new Date("2026-11-09T11:00:00Z"))).toBe(2);
    expect(overdueWorkingDays(friday, new Date("2026-11-13T09:00:00Z"))).toBe(5);
  });
});
