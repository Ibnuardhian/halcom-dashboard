import { describe, expect, it } from "vitest";
import { formatDay } from "@/features/dashboards/format";

describe("formatDay", () => {
  it("shows the day as DD Mon YYYY, without the time", () => {
    expect(formatDay(new Date("2026-11-05T04:03:00Z"))).toBe("05 Nov 2026");
    expect(formatDay(new Date("2026-10-17T04:03:00Z"))).toBe("17 Okt 2026");
  });

  it("reads the day in Asia/Jakarta (UTC+7)", () => {
    expect(formatDay(new Date("2026-12-31T16:59:00Z"))).toBe("31 Des 2026");
    expect(formatDay(new Date("2026-12-31T17:00:00Z"))).toBe("01 Jan 2027");
  });
});
