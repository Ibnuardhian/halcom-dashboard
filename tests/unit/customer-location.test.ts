import { describe, expect, it } from "vitest";
import { customerLocation, locationKey } from "../../src/domain/customers/location";

const day = (d: number) => new Date(Date.UTC(2026, 0, d));

describe("locationKey", () => {
  it("trims and lower-cases, and returns null for nothing typed", () => {
    expect(locationKey("  Jakarta ")).toBe("jakarta");
    expect(locationKey("   ")).toBeNull();
    expect(locationKey(null)).toBeNull();
  });
});

describe("customerLocation", () => {
  it("takes the location most of the projects name, whatever the spelling", () => {
    const place = customerLocation([
      { location: "Padang", createdAt: day(1) },
      { location: " jakarta", createdAt: day(2) },
      { location: "Jakarta", createdAt: day(3) },
    ]);
    expect(place).toEqual({ key: "jakarta", label: "Jakarta" });
  });

  it("breaks a tie with the most recent project", () => {
    expect(customerLocation([{ location: "Padang", createdAt: day(1) }, { location: "Medan", createdAt: day(5) }])?.key).toBe("medan");
  });

  it("is null when no project has a location", () => {
    expect(customerLocation([{ location: null, createdAt: day(1) }, { location: " ", createdAt: day(2) }])).toBeNull();
    expect(customerLocation([])).toBeNull();
  });
});
