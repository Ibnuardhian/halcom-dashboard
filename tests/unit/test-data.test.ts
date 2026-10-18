import { describe, expect, it } from "vitest";
import { classifyProject, PLACEHOLDER_CUSTOMER, SEED_KEY_PREFIX } from "@/domain/devdata/test-data";

const window = { start: new Date("2026-10-17T00:00:00.000Z"), end: new Date("2026-10-18T00:00:00.000Z") };
const test = { createdAt: new Date("2026-10-17T10:04:13.450Z"), importedFrom: null, submissionKey: "form-key-12345", customerName: "PT ABCD", deletedAt: null };

describe("classifyProject", () => {
  it("confirms a hand-typed placeholder project made through the form on the day, and says why", () => {
    const verdict = classifyProject(test, window);

    expect(verdict.test).toBe(true);
    if (verdict.test) expect(verdict.evidence.join(" ")).toMatch(/placeholder company name "PT ABCD"/);
  });

  it("uses a half-open day: midnight starts it, the next midnight does not belong to it", () => {
    expect(classifyProject({ ...test, createdAt: window.start }, window).test).toBe(true);
    expect(classifyProject({ ...test, createdAt: new Date(window.end.getTime() - 1) }, window).test).toBe(true);
    expect(classifyProject({ ...test, createdAt: window.end }, window).test).toBe(false);
    expect(classifyProject({ ...test, createdAt: new Date(window.start.getTime() - 1) }, window).test).toBe(false);
  });

  it.each([
    ["the sales export", { importedFrom: "projects_export_2026-10-17.csv" }, /real data/],
    ["no submission key", { submissionKey: null }, /project form/],
    ["a development seed sample", { submissionKey: `${SEED_KEY_PREFIX}p1` }, /sample record/],
    ["a real company name", { customerName: "Epson Batam" }, /not a placeholder/],
    ["no company", { customerName: null }, /not a placeholder/],
    ["a project already deleted", { deletedAt: new Date() }, /already deleted/],
  ])("leaves %s alone", (_label, change, reason) => {
    const verdict = classifyProject({ ...test, ...change }, window);

    expect(verdict.test).toBe(false);
    if (!verdict.test) expect(verdict.reason).toMatch(reason);
  });

  it("recognises only 'PT' and four capital letters as a placeholder", () => {
    for (const name of ["PT ABCD", "PT EFGH", "PT MNOP"]) expect(PLACEHOLDER_CUSTOMER.test(name), name).toBe(true);
    for (const name of ["PT Abcd", "PT ABC", "PT ABCDE", "PT Manoor Bulatn Lestari", "Radiant", "PT  ABCD", "pt ABCD"]) expect(PLACEHOLDER_CUSTOMER.test(name), name).toBe(false);
  });
});
