import { describe, expect, it } from "vitest";
import { rankRows } from "../../src/components/charts/rank";
import { FILTER_NONE, projectsHref, readDrillFilters } from "../../src/domain/projects/drilldown";

const PIC_A = "0190c5f0-0000-7000-8000-000000000001";
const PIC_B = "0190c5f0-0000-7000-8000-000000000002";

describe("rankRows", () => {
  it("puts the largest first and keeps the neutral rows (Not set, Other) at the bottom", () => {
    const rows = [
      { key: "none", value: 9, neutral: true },
      { key: "a", value: 2 },
      { key: "b", value: 7 },
      { key: "c", value: 4 },
    ];
    expect(rankRows(rows).map((row) => row.key)).toEqual(["b", "c", "a", "none"]);
  });

  it("keeps the order of equal values", () => {
    const rows = [{ key: "x", value: 3 }, { key: "y", value: 3 }, { key: "z", value: 3 }];
    expect(rankRows(rows).map((row) => row.key)).toEqual(["x", "y", "z"]);
  });
});

describe("SOA PIC drill-down", () => {
  it("round-trips through the Projects list address", () => {
    const href = projectsHref("/projects", { soaPic: [PIC_A, PIC_B] });
    expect(href).toBe(`/projects?soapic=${PIC_A}&soapic=${PIC_B}`);
    const query = Object.fromEntries([[ "soapic", [PIC_A, PIC_B] ]]);
    expect(readDrillFilters(query).soaPic).toEqual([PIC_A, PIC_B]);
  });

  it("accepts none for projects without a PIC and drops anything else", () => {
    expect(readDrillFilters({ soapic: [FILTER_NONE, "not-an-id", PIC_A] }).soaPic).toEqual([FILTER_NONE, PIC_A]);
  });
});

describe("location drill-down", () => {
  it("round-trips lower-cased and trimmed through the Projects list address", () => {
    expect(projectsHref("/projects", { location: ["jakarta", FILTER_NONE] })).toBe("/projects?location=jakarta&location=none");
    expect(readDrillFilters({ location: ["  Jakarta ", "", "padang"] }).location).toEqual(["jakarta", "padang"]);
  });
});
