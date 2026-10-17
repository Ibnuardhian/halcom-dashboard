import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toXlsx } from "@/server/export/xlsx";

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
