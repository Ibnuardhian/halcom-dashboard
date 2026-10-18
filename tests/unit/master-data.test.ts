import { describe, expect, it } from "vitest";
import { filterMasterOptions, hasExactMatch } from "@/domain/projects/master-data";

const options = [
  { id: "1", name: "Hewlett Packard Enterprise" },
  { id: "2", name: "Dell Technologies" },
  { id: "3", name: "Hikvision" },
  { id: "4", name: "Aruba (HPE)" },
];

describe("filterMasterOptions", () => {
  it("lists everything for an empty search", () => {
    expect(filterMasterOptions(options, "")).toEqual(options);
    expect(filterMasterOptions(options, "   ")).toEqual(options);
  });

  it("matches a part of the name ignoring case, closest (starts with) first", () => {
    expect(filterMasterOptions(options, "hp").map((o) => o.id)).toEqual(["4"]);
    expect(filterMasterOptions(options, "HI").map((o) => o.id)).toEqual(["3"]);
    expect(filterMasterOptions(options, "ent").map((o) => o.id)).toEqual(["1"]);
    // "tech" is inside Dell Technologies only; "h" starts two names and sits inside others, the starting ones come first.
    expect(filterMasterOptions(options, "h").map((o) => o.id).slice(0, 2)).toEqual(["1", "3"]);
  });

  it("ignores extra spaces in what was typed and in the stored name", () => {
    expect(filterMasterOptions(options, "  dell    technologies ").map((o) => o.id)).toEqual(["2"]);
    expect(filterMasterOptions([{ id: "x", name: "Dell   Technologies" }], "dell technologies").map((o) => o.id)).toEqual(["x"]);
  });

  it("returns nothing when no name matches", () => {
    expect(filterMasterOptions(options, "cisco")).toEqual([]);
  });
});

describe("hasExactMatch", () => {
  it("is true for the same name ignoring case and spacing, so Create is not offered", () => {
    expect(hasExactMatch(options, "dell technologies")).toBe(true);
    expect(hasExactMatch(options, "  DELL    Technologies  ")).toBe(true);
  });

  it("is false for a part of a name, a different name or nothing", () => {
    expect(hasExactMatch(options, "dell")).toBe(false);
    expect(hasExactMatch(options, "Cisco")).toBe(false);
    expect(hasExactMatch(options, "")).toBe(false);
    expect(hasExactMatch(options, "   ")).toBe(false);
  });
});
