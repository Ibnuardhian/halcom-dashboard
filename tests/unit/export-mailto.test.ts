import { describe, expect, it } from "vitest";
import { chooseColumns, EXPORT_COLUMNS, type ExportProject } from "@/domain/projects/export";
import { buildMailto, MAILTO_MAX_LENGTH } from "@/domain/requests/mailto";
import { isSoaPhase, SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { toCsv } from "@/server/export/csv";

describe("buildMailto", () => {
  const input = {
    to: ["soa-group@example.invalid"],
    cc: ["a@example.invalid", "b@example.invalid"],
    subject: "[HITBOQ] PT A & B - CCTV #1",
    body: "Dear SOA team,\nPlease prepare the BOQ.\nRequest ID: BOQ-IA-260001",
  };

  it("puts To in the path and Cc, subject and text in the query, encoded", () => {
    const { href, bodyIncluded } = buildMailto(input);

    expect(bodyIncluded).toBe(true);
    const url = new URL(href);
    expect(url.protocol).toBe("mailto:");
    expect(decodeURIComponent(url.pathname)).toBe("soa-group@example.invalid");
    expect(url.searchParams.get("cc")).toBe("a@example.invalid,b@example.invalid");
    expect(url.searchParams.get("subject")).toBe("[HITBOQ] PT A & B - CCTV #1"); // "&" and "#" cannot break the link
    expect(url.searchParams.get("body")).toBe("Dear SOA team,\r\nPlease prepare the BOQ.\r\nRequest ID: BOQ-IA-260001");
  });

  it("leaves out an empty Cc and an unconfigured To, and drops a text that is too long for a link", () => {
    const short = buildMailto({ ...input, to: [], cc: [] });
    expect(short.href.startsWith("mailto:?subject=")).toBe(true);

    const long = buildMailto({ ...input, body: "x".repeat(MAILTO_MAX_LENGTH) });
    expect(long.bodyIncluded).toBe(false);
    expect(long.href).not.toContain("body=");
    expect(long.href.length).toBeLessThanOrEqual(MAILTO_MAX_LENGTH);
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark, quotes what needs it and keeps numbers as numbers", () => {
    const csv = toCsv(["Name", "Value"], [['PT "A", B', 1200000000], ["line\nbreak", null]]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿Name,Value\r\n"PT ""A"", B",1200000000\r\n"line\nbreak",\r\n');
  });

  it("neutralises text that Excel would run as a formula, but not a negative number", () => {
    const csv = toCsv(["x"], [["=SUM(A1:A9)"], ["+1"], ["-2"], ["@cmd"], [-5]]);

    expect(csv).toBe("﻿x\r\n'=SUM(A1:A9)\r\n'+1\r\n'-2\r\n'@cmd\r\n-5\r\n");
  });
});

describe("export columns", () => {
  const project: ExportProject = {
    code: "PRJ-001",
    accountName: "PT A",
    projectTitle: "CCTV",
    progress: "PROPOSE",
    trackStatus: "ON_HOLD",
    lastUpdated: new Date("2026-10-18T10:30:45.000Z"),
    quoteReleasedAt: new Date("2026-10-01T00:00:00.000Z"),
    estimatedValue: 1000,
    probability: 30,
    weightedValue: 300,
    targetMargin: 12.5,
    estimatedGrossProfit: 125,
    finalValue: null,
    targetDate: null,
    wonDate: null,
    salesPic: "Gusti",
    sourceType: "INTERNAL_SALES",
    externalSourceName: null,
    externalContact: null,
    externalReference: null,
    sourceNotes: null,
    technicalPic: null,
    principal: "HPE",
    solution: null,
    industry: null,
    location: null,
    currentAction: null,
    nextAction: null,
    openRequests: 1,
    totalRequests: 2,
  };

  it("keeps only known columns, in file order, whatever order they were ticked in", () => {
    const columns = chooseColumns(["estimatedValue", "nope", "code", "code", "progress"]);

    expect(columns.map((column) => column.key)).toEqual(["code", "progress", "estimatedValue"]);
    expect(chooseColumns([])).toEqual([]);
  });

  it("renders the sheet's wording and plain values", () => {
    const row = Object.fromEntries(EXPORT_COLUMNS.map((column) => [column.key, column.value(project)]));

    expect(row).toMatchObject({
      progress: "30% - Propose",
      status: "On Hold",
      lastUpdated: "2026-10-18 10:30",
      quoteReleased: "2026-10-01",
      estimatedValue: 1000,
      estimatedGrossProfit: 125,
      finalValue: null,
      technicalPic: null,
    });
  });

  it("exports the project source and the external source details", () => {
    const external: ExportProject = { ...project, salesPic: null, sourceType: "OTHER", externalSourceName: "PT Mitra", externalContact: "Budi", externalReference: "MIT-7", sourceNotes: "via tender" };
    const row = Object.fromEntries(EXPORT_COLUMNS.map((column) => [column.key, column.value(external)]));

    expect(row).toMatchObject({ source: "Other", externalSource: "PT Mitra", externalContact: "Budi", externalReference: "MIT-7", sourceNotes: "via tender", salesPic: null });
    expect(EXPORT_COLUMNS.find((column) => column.key === "source")!.value(project)).toBe("Internal Sales");
  });

  it("offers the sales sheet's columns first", () => {
    const preset = EXPORT_COLUMNS.filter((column) => column.preset).map((column) => column.label);

    expect(preset).toEqual([
      "Project ID",
      "Progress",
      "Status",
      "Last Updated",
      "Quote Released",
      "Account Name",
      "Project Title",
      "Project Source",
      "Estimated PO Value",
      "Estimated Gross Profit",
    ]);
  });
});

describe("SOA phase", () => {
  it("knows Assessment, Sizing and POC", () => {
    expect(Object.values(SOA_PHASE_LABELS)).toEqual(["Assessment", "Sizing", "POC"]);
    expect(isSoaPhase("SIZING")).toBe(true);
    expect(isSoaPhase("BOQ")).toBe(false);
  });
});
