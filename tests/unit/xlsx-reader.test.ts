import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toXlsx } from "@/server/export/xlsx";
import { excelSerialToIso, readXlsx, XLSX_LIMITS } from "@/server/import/xlsx-reader";

/** A workbook the way Excel writes it: shared strings, a date style, a relationship from the workbook to the sheet. */
function excelLike(sheetXml: string, extra: Record<string, string> = {}): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pipeline &amp; Sales" sheetId="1" r:id="rId7"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/sheet3.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8(
      '<sst><si><t>End user</t></si><si><t>Project</t></si><si><t>Closing</t></si><si><r><t>PT </t></r><r><t>Maju &amp; Jaya</t></r></si><si><t>Tower &lt;A&gt;</t></si><si><t xml:space="preserve"> padded </t></si></sst>',
    ),
    "xl/styles.xml": strToU8(
      '<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet3.xml": strToU8(sheetXml),
    ...Object.fromEntries(Object.entries(extra).map(([name, content]) => [name, strToU8(content)])),
  });
}

const ROWS = `<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1"><v>0</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="s"><v>4</v></c><c r="C3" s="1"><v>46023</v></c><c r="D3" s="3"><v>1500000000.5</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>Inline</t></is></c><c r="C4" s="2"><v>46024</v></c><c r="E4" t="b"><v>1</v></c></row>
<row r="5"><c r="A5" t="s"><v>5</v></c><c r="D5"><v>0.30000000000000004</v></c><c r="E5" t="str"><f>A5&amp;"x"</f><v>padded x</v></c><c r="F5" t="e"><v>#DIV/0!</v></c></row>
<row r="6"/>
</sheetData>`;

describe("readXlsx", () => {
  it("reads shared strings, rich text, entities, inline strings, booleans and cached formula results", () => {
    const result = readXlsx(excelLike(`<worksheet>${ROWS}</worksheet>`));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.sheetName).toBe("Pipeline & Sales");
    expect(result.sheet.headers).toEqual(["End user", "Project", "Closing", "0", "", ""]);
    expect(result.sheet.rows[0]![0]).toBe("PT Maju & Jaya");
    expect(result.sheet.rows[0]![1]).toBe("Tower <A>");
    expect(result.sheet.rows[1]).toEqual(["Inline", "", "2026-01-02", "", "TRUE", ""]);
    expect(result.sheet.rows[2]).toEqual(["padded", "", "", "0.3", "padded x", ""]); // trimmed; noise removed; formula result, not the formula; an error cell is empty
  });

  it("turns date-formatted numbers into ISO dates and leaves other numbers alone", () => {
    const result = readXlsx(excelLike(`<worksheet>${ROWS}</worksheet>`));
    if (!result.ok) throw new Error(result.message);

    expect(result.sheet.rows[0]![2]).toBe("2026-01-01"); // built-in date format 14
    expect(result.sheet.rows[1]![2]).toBe("2026-01-02"); // custom dd/mm/yyyy
    expect(result.sheet.rows[0]![3]).toBe("1500000000.5"); // #,##0.00 is a number, not a date
  });

  it("numbers the sheet rows as Excel does, skipping empty ones", () => {
    const result = readXlsx(excelLike(`<worksheet>${ROWS}</worksheet>`));
    if (!result.ok) throw new Error(result.message);

    expect(result.sheet.rowNumbers).toEqual([3, 4, 5]);
  });

  it("reads the workbook this application exports", () => {
    const result = readXlsx(toXlsx("Projects", ["End user", "Value", "Note"], [["PT A & B", 1500.5, null], ["=1+1", 0, "ok"]]));

    expect(result).toMatchObject({ ok: true, sheet: { headers: ["End user", "Value", "Note"], rows: [["PT A & B", "1500.5", ""], ["=1+1", "0", "ok"]], rowNumbers: [2, 3] } });
  });

  it("refuses what is not a workbook, is empty or is too large", () => {
    expect(readXlsx(new Uint8Array())).toMatchObject({ ok: false });
    expect(readXlsx(strToU8("a,b\n1,2"))).toMatchObject({ ok: false, message: expect.stringContaining("not an .xlsx") });
    expect(readXlsx(zipSync({ "hello.txt": strToU8("hi") }))).toMatchObject({ ok: false, message: expect.stringContaining("no worksheet") });
    expect(readXlsx(new Uint8Array(XLSX_LIMITS.fileBytes + 1).fill(0x50))).toMatchObject({ ok: false, message: expect.stringContaining("larger") });
    expect(readXlsx(excelLike("<worksheet><sheetData></sheetData></worksheet>"))).toMatchObject({ ok: false, message: "The sheet has no data." });
  });

  it("refuses a sheet with too many rows, too many columns or an oversized cell, and one that unpacks to too much", () => {
    const manyRows = Array.from({ length: XLSX_LIMITS.rows + 2 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>x</t></is></c></row>`).join("");
    expect(readXlsx(excelLike(`<worksheet><sheetData>${manyRows}</sheetData></worksheet>`))).toMatchObject({ ok: false, message: expect.stringContaining("more than 5000 rows") });

    const wide = `<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="BZ1" t="inlineStr"><is><t>far</t></is></c></row>`;
    expect(readXlsx(excelLike(`<worksheet><sheetData>${wide}</sheetData></worksheet>`))).toMatchObject({ ok: false, message: expect.stringContaining("beyond column 60") });

    const big = `<row r="1"><c r="A1" t="inlineStr"><is><t>${"x".repeat(XLSX_LIMITS.cellChars + 1)}</t></is></c></row>`;
    expect(readXlsx(excelLike(`<worksheet><sheetData>${big}</sheetData></worksheet>`))).toMatchObject({ ok: false, message: expect.stringContaining("characters") });

    const bomb = excelLike("<worksheet><sheetData></sheetData></worksheet>", { "xl/worksheets/sheet9.xml": "a".repeat(XLSX_LIMITS.unpackedBytes + 10) });
    expect(readXlsx(bomb)).toMatchObject({ ok: false, message: expect.stringContaining("unpacks") });
  });

  it("ignores macros and external references: nothing outside the worksheet is read or run", () => {
    const bytes = excelLike(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>=cmd|' /C calc'!A0</t></is></c></row></sheetData></worksheet>`, {
      "xl/vbaProject.bin": "binary",
      "xl/externalLinks/externalLink1.xml": "<externalLink/>",
    });

    const result = readXlsx(bytes);

    expect(result).toMatchObject({ ok: true, sheet: { rows: [["=cmd|' /C calc'!A0"]] } }); // plain text; the importer stores it as text
  });
});

describe("excelSerialToIso", () => {
  it("follows Excel's 1900 calendar, including its missing 29 February", () => {
    expect(excelSerialToIso(1)).toBe("1900-01-01");
    expect(excelSerialToIso(59)).toBe("1900-02-28");
    expect(excelSerialToIso(61)).toBe("1900-03-01");
    expect(excelSerialToIso(45292)).toBe("2024-01-01");
    expect(excelSerialToIso(46023.75)).toBe("2026-01-01"); // the time of day is dropped
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(Number.NaN)).toBeNull();
  });
});
