import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toXlsx } from "@/server/export/xlsx";
import { parseProgressText, parseTrackStatusText, sheetDropdowns, templateHeaders } from "@/domain/projects/import";

const read = (bytes: Uint8Array, path: string) => strFromU8(unzipSync(bytes)[path]!);

describe("toXlsx", () => {
  it("is a zip package with a workbook, styles and one sheet", () => {
    const files = Object.keys(unzipSync(toXlsx("Projects", ["A"], [["x"]])));
    expect(files.sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
  });

  it("keeps numbers as numbers, text as escaped text and empty cells empty", () => {
    const sheet = read(toXlsx("Projects", ["Name", "Value", "Note"], [["A & <B>", 1500.5, null], ["=1+1", 0, "ok"]]), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("A &amp; &lt;B&gt;");
    expect(sheet).toContain('<c r="B2" s="2"><v>1500.5</v></c>');
    expect(sheet).not.toContain('r="C2"');
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>'); // text, never a formula
    expect(sheet).not.toContain("<f>");
  });

  it("names the last column of a wide sheet and strips characters XML cannot hold", () => {
    const headers = Array.from({ length: 28 }, (_, i) => `H${i}`);
    const sheet = read(toXlsx("A/B:C", headers, [["bad\u0001text"]]), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<autoFilter ref="A1:AB2"/>');
    expect(sheet).toContain("badtext");
    expect(read(toXlsx("A/B:C", headers, []), "xl/workbook.xml")).toContain('name="A B C"');
  });
});

describe("pick lists in the sheet", () => {
  const headers = templateHeaders();
  const sheetOf = (keys?: Parameters<typeof templateHeaders>[0]) => read(toXlsx("Projects", templateHeaders(keys), [], sheetDropdowns(keys)), "xl/worksheets/sheet1.xml");

  it("offers Progress from 5% to Closed Lost and Status on their columns, down to the import's last row", () => {
    const sheet = sheetOf();
    const progress = headers.indexOf("Progress");
    const status = headers.indexOf("Status");
    const col = (index: number) => String.fromCharCode(65 + index);
    expect(sheet).toContain(`sqref="${col(progress)}2:${col(progress)}5001"><formula1>"5% - Qualify,15% - Understand,30% - Propose,60% - Negotiate,60% - Negotiate (FU),95% - Agree,100% - Closed Won,0% - Closed Lost"</formula1>`);
    expect(sheet).toContain(`sqref="${col(status)}2:${col(status)}5001"><formula1>"On Track,On Hold,Done,Block"</formula1>`);
    expect(sheet).toContain('<dataValidations count="2">');
  });

  it("every choice is one the import reads back", () => {
    for (const { list } of sheetDropdowns()) for (const item of list) expect(parseProgressText(item) ?? parseTrackStatusText(item), item).not.toBeNull();
  });

  it("follows the columns the sheet has: none without Progress and Status", () => {
    expect(sheetDropdowns(["endUser", "name", "code"])).toEqual([]);
    expect(sheetOf(["endUser", "name", "code"])).not.toContain("dataValidation");
  });

  it("refuses a pick list that Excel would cut", () => {
    expect(() => toXlsx("X", ["A"], [], [{ column: 0, list: ["x".repeat(300)], title: "A" }])).toThrow();
    expect(() => toXlsx("X", ["A"], [], [{ column: 0, list: ["a,b"], title: "A" }])).toThrow();
  });
});
