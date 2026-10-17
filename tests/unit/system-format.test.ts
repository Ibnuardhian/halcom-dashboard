import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatDuration, formatPercent } from "@/features/system/format";

describe("formatBytes", () => {
  it("scales through binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1024 ** 2 * 7.25)).toBe("7.3 MiB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TiB");
  });

  it("does not print nonsense for invalid input", () => {
    expect(formatBytes(-1)).toBe("–");
    expect(formatBytes(Number.NaN)).toBe("–");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("–");
  });
});

describe("formatDuration", () => {
  it("shows the two largest non-zero units", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59.9)).toBe("59s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(3_725)).toBe("1h 2m");
    expect(formatDuration(93_784)).toBe("1d 2h");
    expect(formatDuration(86_400 + 5)).toBe("1d 5s");
  });

  it("does not print nonsense for invalid input", () => {
    expect(formatDuration(-5)).toBe("–");
    expect(formatDuration(Number.NaN)).toBe("–");
  });
});

describe("formatPercent and formatCount", () => {
  it("formats ratios and treats missing data as a dash", () => {
    expect(formatPercent(0.9876)).toBe("98.8%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(null)).toBe("–");
  });

  it("groups thousands", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(Number.NaN)).toBe("–");
  });
});
