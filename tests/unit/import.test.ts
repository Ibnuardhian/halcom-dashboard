import { describe, expect, it } from "vitest";
import {
  cleanName,
  nameKey,
  parseProjectStatus,
  parseStage,
  PROJECT_STAGES,
  weightedValue,
} from "@/domain/projects/pipeline";
import { parseCsv, recordsWithHeader } from "@/server/import/csv";
import { accountEmailFor, parseProjectsCsv, peopleFrom } from "@/server/import/projects-csv";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, commas and line breaks inside quotes", () => {
    const rows = parseCsv('a,"b,1","say ""hi""","line1\nline2"\r\nx,,"",y\n');

    expect(rows).toEqual([
      ["a", "b,1", 'say "hi"', "line1\nline2"],
      ["x", "", "", "y"],
    ]);
  });

  it("skips blank lines, strips a byte order mark and accepts a missing final newline", () => {
    expect(parseCsv("﻿a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a quoted empty field as a record", () => {
    expect(parseCsv('""\n')).toEqual([[""]]);
  });

  it("refuses a file that ends inside a quote", () => {
    expect(() => parseCsv('a,"unterminated')).toThrow(/quoted field/);
  });

  it("reports records whose field count differs from the header", () => {
    const { records, problems } = recordsWithHeader(parseCsv("a,b\n1,2\n3\n"));

    expect(records).toEqual([{ a: "1", b: "2" }]);
    expect(problems).toEqual(["Row 3 has 1 fields, expected 2."]);
  });
});

const HEADER =
  '"Project ID","Customer","Project Name","Industry","Location","Sales PIC","Technical PIC","Principal","Solution","Project Description","Estimated Value","Probability","Target Closing","Stage","Status","Competitor","Competition Status","Requirement","Assessment Status","Solution Proposed","Architecture Status","Sizing Status","BOM Status","Quotation Status","Proposal Status","POC Status","Technical Challenge","Technical Blocker","Technical Notes","Current Action","Next Action","Scope Estimate","Lost Reason","Lost Notes","Won Date","Final Value","PIC / Stakeholder (raw)","Weighted Value","Custom Fields (JSON)"';

/** Builds a record for HEADER with only the named columns filled in. */
function record(values: Record<string, string>): string {
  const columns = [...HEADER.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  return columns.map((column) => (values[column] === undefined ? "" : `"${values[column]!.replaceAll('"', '""')}"`)).join(",");
}

const BASE = {
  "Project ID": "PRJ-001",
  Customer: "Epson Batam",
  "Project Name": "Server AI",
  "Sales PIC": "Mas Dzaki",
  "Technical PIC": "Adityo",
  Principal: "HPE",
  Solution: "AI Server",
  Stage: "Negotiation",
  Status: "Active",
};

describe("parseProjectsCsv", () => {
  it("maps a row to typed fields and leaves empty cells null", () => {
    const csv = [
      HEADER,
      record({
        ...BASE,
        "Estimated Value": "13000000",
        Probability: "100",
        "Target Closing": "2026-12-10",
        "Won Date": "2026-10-05",
        "Final Value": "400000000",
        "Current Action": "Line one\nLine two",
        "Custom Fields (JSON)": '{"k":1}',
      }),
    ].join("\n");

    const { rows, problems } = parseProjectsCsv(csv);

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "PRJ-001",
      customer: "Epson Batam",
      stage: "NEGOTIATION",
      status: "ACTIVE",
      estimatedValue: 13_000_000,
      probability: 100,
      finalValue: 400_000_000,
      currentAction: "Line one\nLine two",
      industry: null,
      competitor: null,
      customFields: { k: 1 },
    });
    expect(rows[0]!.targetClosing?.toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(rows[0]!.wonDate?.toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it("maps the stages and statuses of the sales export", () => {
    for (const [stage, status] of [
      ["New Opportunity", "Active"],
      ["Sizing / BOM", "On Hold"],
      ["POC", "Active"],
      ["Won", "Completed"],
      ["Lost", "Lost"],
    ] as const) {
      const { rows, problems } = parseProjectsCsv([HEADER, record({ ...BASE, Stage: stage, Status: status })].join("\n"));
      expect(problems).toEqual([]);
      expect(rows[0]).toBeDefined();
    }
  });

  it("collects every problem in the file instead of stopping at the first", () => {
    const csv = [
      HEADER,
      record({ ...BASE, "Project ID": "P-1" }),
      record({ ...BASE, "Project ID": "PRJ-002", Customer: "", Stage: "Nowhere" }),
      record({ ...BASE, "Project ID": "PRJ-003", "Estimated Value": "12,5", Probability: "101", "Target Closing": "2026-02-30" }),
      record({ ...BASE, "Project ID": "PRJ-003" }),
      record({ ...BASE, "Project ID": "PRJ-004", "Custom Fields (JSON)": "{oops" }),
    ].join("\n");

    const { problems } = parseProjectsCsv(csv);

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("P-1: Project ID must look like PRJ-001"),
        expect.stringContaining("PRJ-002: Customer is required"),
        expect.stringContaining('PRJ-002: unknown Stage "Nowhere"'),
        expect.stringContaining("PRJ-003: Estimated Value"),
        expect.stringContaining("PRJ-003: Probability"),
        expect.stringContaining("PRJ-003: Target Closing"),
        expect.stringContaining("PRJ-003: duplicate Project ID"),
        expect.stringContaining("PRJ-004: Custom Fields is not valid JSON"),
      ]),
    );
  });

  it("rejects a file with missing columns or rows of the wrong width", () => {
    expect(parseProjectsCsv('"Project ID","Customer"\n"PRJ-001","x"').problems[0]).toContain("Missing column(s)");
    expect(parseProjectsCsv([HEADER, '"PRJ-001","x"'].join("\n")).problems[0]).toContain("has 2 fields");
    expect(parseProjectsCsv('"a\n').problems[0]).toContain("quoted field");
  });
});

describe("people in the export", () => {
  it("builds predictable sign-in names", () => {
    expect(accountEmailFor("Mas Dzaki")).toBe("mas.dzaki@example.invalid");
    expect(accountEmailFor("  Mira   Batam ")).toBe("mira.batam@example.invalid");
    expect(accountEmailFor("Adityo")).toBe("adityo@example.invalid");
    expect(accountEmailFor("!!!")).toBe("user@example.invalid");
  });

  it("makes technical PICs SOA (even when also Sales PIC once) and everyone else Sales", () => {
    const csv = [
      HEADER,
      record({ ...BASE, "Sales PIC": "Mas Dzaki", "Technical PIC": "Adityo" }),
      record({ ...BASE, "Project ID": "PRJ-002", "Sales PIC": "Adityo", "Technical PIC": "Adityo" }),
      record({ ...BASE, "Project ID": "PRJ-003", "Sales PIC": "mas  dzaki", "Technical PIC": "" }),
      record({ ...BASE, "Project ID": "PRJ-004", "Sales PIC": "", "Technical PIC": "" }),
    ].join("\n");

    const { rows } = parseProjectsCsv(csv);

    expect(peopleFrom(rows)).toEqual([
      { name: "Mas Dzaki", role: "SALES", email: "mas.dzaki@example.invalid" },
      { name: "Adityo", role: "SOA", email: "adityo@example.invalid" },
    ]);
  });
});

describe("pipeline helpers", () => {
  it("knows every stage label and rejects unknown ones", () => {
    expect(parseStage(" sizing / bom ")).toBe("SIZING_BOQ");
    expect(parseStage("New Opportunity")).toBe("NEW_OPPORTUNITY");
    expect(parseStage("Closing")).toBeNull();
    expect(PROJECT_STAGES.every((stage) => parseStage(stage.replace("_", " ").replace("SIZING BOM", "Sizing / BOM")) !== undefined)).toBe(true);
  });

  it("parses statuses case-insensitively", () => {
    expect(parseProjectStatus("on hold")).toBe("ON_HOLD");
    expect(parseProjectStatus("Completed")).toBe("COMPLETED");
    expect(parseProjectStatus("Dormant")).toBeNull();
  });

  it("weights a value by the probability of its Progress step, and only when the value is known", () => {
    expect(weightedValue(400_000_000, "CLOSED_WON")).toBe(400_000_000);
    expect(weightedValue(13_000_000, "UNDERSTAND")).toBe(1_950_000);
    expect(weightedValue(1000, "PROPOSE")).toBe(300);
    expect(weightedValue(1000, "CLOSED_LOST")).toBe(0);
    expect(weightedValue(null, "AGREE")).toBeNull();
    expect(weightedValue(0, "AGREE")).toBe(0);
  });

  it("normalises master-data names", () => {
    expect(nameKey("  HPE   Aruba ")).toBe("hpe aruba");
    expect(cleanName("  Palo   Alto ")).toBe("Palo Alto");
  });
});
