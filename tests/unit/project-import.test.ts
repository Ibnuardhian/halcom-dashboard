import { describe, expect, it } from "vitest";
import {
  IMPORT_FIELD_KEYS,
  checkImportRow,
  checkMapping,
  parseDateText,
  parseProgressText,
  parseTrackStatusText,
  projectIdentity,
  rowToRaw,
  splitPrincipals,
  suggestMapping,
  templateHeaders,
  IMPORT_FIELDS,
  type RawImportRow,
} from "@/domain/projects/import";

const empty = (): RawImportRow => Object.fromEntries(IMPORT_FIELD_KEYS.map((key) => [key, ""])) as RawImportRow;
const row = (values: Partial<RawImportRow>): RawImportRow => ({ ...empty(), endUser: "PT Maju", name: "CCTV", salesPic: "Dzaki", ...values });

describe("suggestMapping", () => {
  it("matches headers by name and by synonym, ignoring case and punctuation, each column once", () => {
    const mapping = suggestMapping(["No", "Account Name", "Project Title", "SALES PIC", "Estimated PO Value", "Quote Released", "Target Closing", "Principal", "Unknown"]);

    expect(mapping).toMatchObject({ code: 0, endUser: 1, name: 2, salesPic: 3, estimatedValue: 4, quoteReleasedAt: 5, targetDate: 6, principals: 7 });
    expect(mapping.description).toBeNull();
    expect(Object.values(mapping).filter((value) => value !== null)).toHaveLength(new Set(Object.values(mapping).filter((value) => value !== null)).size);
  });

  it("prefers an exact field name over a synonym of another field", () => {
    expect(suggestMapping(["Sales", "Sales PIC"])).toMatchObject({ salesPic: 1 });
  });
});

describe("the downloadable template", () => {
  it("has one column per field, marks the required ones, and is matched back to every field without a change", () => {
    const headers = templateHeaders();

    expect(headers).toHaveLength(IMPORT_FIELDS.length);
    expect(headers.filter((header) => header.endsWith(" *"))).toEqual(["End user *", "Project name *"]);
    const mapping = suggestMapping(headers);
    expect(IMPORT_FIELDS.every((field, index) => mapping[field.key] === index)).toBe(true);
    expect(checkMapping(mapping, headers.length).ok).toBe(true);
  });
});

describe("checkMapping", () => {
  const ok = { endUser: 0, name: 1 };

  it("accepts a mapping inside the sheet that covers the required fields", () => {
    expect(checkMapping({ ...ok, salesPic: 2, code: null }, 3)).toMatchObject({ ok: true, mapping: { endUser: 0, name: 1, salesPic: 2, code: null, description: null } });
  });

  it("refuses a missing required field, a column twice, a column outside the sheet, an unknown field and a non-object", () => {
    expect(checkMapping({ endUser: 0 }, 3)).toMatchObject({ ok: false, message: expect.stringContaining("Project name") });
    expect(checkMapping({ ...ok, salesPic: 1 }, 3)).toMatchObject({ ok: false, message: expect.stringContaining("dua field") });
    expect(checkMapping({ ...ok, salesPic: 9 }, 3)).toMatchObject({ ok: false, message: expect.stringContaining("tidak ada di sheet") });
    expect(checkMapping({ ...ok, salesPic: -1 }, 3)).toMatchObject({ ok: false });
    expect(checkMapping({ ...ok, salesPic: "2" }, 3)).toMatchObject({ ok: false });
    expect(checkMapping({ ...ok, passwordHash: 2 }, 3)).toMatchObject({ ok: false, message: expect.stringContaining("passwordHash") });
    expect(checkMapping(null, 3)).toMatchObject({ ok: false });
    expect(checkMapping([0, 1], 3)).toMatchObject({ ok: false });
  });
});

describe("rowToRaw", () => {
  it("picks the cell of each mapped column and leaves unmapped fields empty", () => {
    const mapping = suggestMapping(["End user", "Project"]);
    expect(rowToRaw([" PT A ", "Job"], mapping)).toMatchObject({ endUser: "PT A", name: "Job", salesPic: "" });
  });
});

describe("parsing cells", () => {
  it("reads progress as the code, the sheet's label, the name or the name with its meaning", () => {
    for (const text of ["PROPOSE", "30% - Propose", "Propose", "propose", "30%-Propose (Submit Quotation)", "Submit Quotation"]) expect(parseProgressText(text)).toBe("PROPOSE");
    expect(parseProgressText("60% - Negotiate (FU)")).toBe("NEGOTIATE_FU");
    expect(parseProgressText("Negotiate")).toBe("NEGOTIATE");
    expect(parseProgressText("100% - Closed Won")).toBe("CLOSED_WON");
    expect(parseProgressText("60%")).toBeNull(); // ambiguous between two steps
    expect(parseProgressText("maybe")).toBeNull();
    expect(parseProgressText("")).toBeNull();
  });

  it("reads status by code or label", () => {
    expect(parseTrackStatusText("On Hold")).toBe("ON_HOLD");
    expect(parseTrackStatusText("ON_TRACK")).toBe("ON_TRACK");
    expect(parseTrackStatusText("block")).toBe("BLOCK");
    expect(parseTrackStatusText("lost")).toBeNull();
  });

  it("reads ISO dates and day-first dates, and refuses impossible ones", () => {
    expect(parseDateText("2026-03-05")).toBe("2026-03-05");
    expect(parseDateText("5/3/2026")).toBe("2026-03-05"); // day first
    expect(parseDateText("31-12-2026")).toBe("2026-12-31");
    expect(parseDateText("2026-03-05T10:00:00")).toBe("2026-03-05");
    for (const bad of ["2026-02-30", "31/02/2026", "13/13/2026", "1850-01-01", "tomorrow", "2026/03/05", ""]) expect(parseDateText(bad)).toBeNull();
  });

  it("splits principals on ; and new lines, tidies them and keeps each once", () => {
    expect(splitPrincipals("HPE; Dell ;  hpe\nCisco  Systems;; ")).toEqual(["HPE", "Dell", "Cisco Systems"]);
    expect(splitPrincipals("")).toEqual([]);
    expect(splitPrincipals("Hewlett Packard, Enterprise")).toEqual(["Hewlett Packard, Enterprise"]); // a comma belongs to the name
  });
});

describe("checkImportRow", () => {
  it("accepts a complete row and fills the defaults", () => {
    const result = checkImportRow(row({ progress: "30% - Propose", estimatedValue: "1.500.000.000", targetMarginPercent: "12,5%", targetDate: "31/12/2026", principals: "HPE; Dell" }));

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        sourceType: "INTERNAL_SALES",
        salesPic: "Dzaki",
        progress: "PROPOSE",
        trackStatus: "ON_TRACK",
        estimatedValue: 1500000000,
        targetMarginPercent: 12.5,
        targetDate: "2026-12-31",
        principals: ["HPE", "Dell"],
        code: null,
      }),
    });
    expect(checkImportRow(row({})).ok && checkImportRow(row({})).ok).toBe(true);
    expect(checkImportRow(row({})).ok && (checkImportRow(row({})) as { value: { progress: string } }).value.progress).toBe("QUALIFY");
  });

  it("reports every problem of a row together", () => {
    const result = checkImportRow(row({ endUser: "", name: "", code: "P-1", progress: "maybe", status: "lost", estimatedValue: "-5", targetMarginPercent: "150", quoteReleasedAt: "soon", salesPic: "" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "End user wajib diisi.",
        "Project name wajib diisi.",
        expect.stringContaining('Project ID "P-1"'),
        expect.stringContaining('Progress "maybe"'),
        expect.stringContaining('Status "lost"'),
        expect.stringContaining("Estimated PO value"),
        expect.stringContaining("Target margin (%)"),
        expect.stringContaining('Quote released "soon"'),
        "Sales PIC wajib diisi untuk proyek Internal Sales.",
      ]),
    );
  });

  it("applies the source rules: Internal Sales needs a Sales PIC and no external name; Other the reverse", () => {
    expect(checkImportRow(row({ salesPic: "" }))).toMatchObject({ ok: false });
    expect(checkImportRow(row({ externalSourceName: "PT Partner" }))).toMatchObject({ ok: false, errors: [expect.stringContaining("tidak memiliki nama sales eksternal")] });
    expect(checkImportRow(row({ source: "Other", salesPic: "", externalSourceName: "PT Partner" }))).toMatchObject({ ok: true, value: { sourceType: "OTHER", salesPic: null, externalSourceName: "PT Partner" } });
    expect(checkImportRow(row({ source: "Other", salesPic: "", externalSourceName: "" }))).toMatchObject({ ok: false, errors: [expect.stringContaining("External sales name wajib diisi")] });
    expect(checkImportRow(row({ source: "Other", externalSourceName: "PT Partner" }))).toMatchObject({ ok: false, errors: [expect.stringContaining("tidak memiliki Sales PIC internal")] });
    expect(checkImportRow(row({ source: "Somewhere" }))).toMatchObject({ ok: false });
  });

  it("refuses both margin forms together, over-long text and control characters", () => {
    expect(checkImportRow(row({ targetMarginAmount: "100", targetMarginPercent: "10" }))).toMatchObject({ ok: false, errors: [expect.stringContaining("tidak keduanya")] });
    expect(checkImportRow(row({ name: "x".repeat(121) }))).toMatchObject({ ok: false, errors: [expect.stringContaining("120")] });
    expect(checkImportRow(row({ description: "bad\u0007text" }))).toMatchObject({ ok: false, errors: [expect.stringContaining("tidak diizinkan")] });
    expect(checkImportRow(row({ principals: Array.from({ length: 21 }, (_, i) => `P${i}`).join(";") }))).toMatchObject({ ok: false, errors: [expect.stringContaining("maksimal memiliki 20")] });
  });

  it("keeps text that starts with = as plain text", () => {
    expect(checkImportRow(row({ description: "=SUM(A1)" }))).toMatchObject({ ok: true, value: { description: "=SUM(A1)" } });
  });
});

describe("projectIdentity", () => {
  it("is the end user and project name, ignoring case and spacing", () => {
    expect(projectIdentity(" PT  Maju ", "CCTV  Upgrade")).toBe(projectIdentity("pt maju", "cctv upgrade"));
    expect(projectIdentity("PT Maju", "CCTV")).not.toBe(projectIdentity("PT Maju", "CCTV 2"));
  });
});
