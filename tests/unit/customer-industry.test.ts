import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { effectiveIndustry, INDUSTRY_MAX_LENGTH, normaliseIndustry } from "@/domain/customers/industry";

describe("normaliseIndustry", () => {
  it("trims, collapses inner space and treats empty as not set", () => {
    expect(normaliseIndustry("  Banking   and  Finance ")).toEqual({ ok: true, value: "Banking and Finance" });
    expect(normaliseIndustry("   ")).toEqual({ ok: true, value: null });
    expect(normaliseIndustry("")).toEqual({ ok: true, value: null });
    expect(normaliseIndustry(null)).toEqual({ ok: true, value: null });
    expect(normaliseIndustry(undefined)).toEqual({ ok: true, value: null });
  });

  it("refuses text that is too long or not text", () => {
    expect(normaliseIndustry("x".repeat(INDUSTRY_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(normaliseIndustry("x".repeat(INDUSTRY_MAX_LENGTH + 1))).toMatchObject({ ok: false });
    expect(normaliseIndustry(42)).toMatchObject({ ok: false });
  });
});

describe("effectiveIndustry", () => {
  it("prefers the customer's industry, then the project's own text, then none", () => {
    expect(effectiveIndustry("Banking", "Retail")).toBe("Banking");
    expect(effectiveIndustry(null, " Retail ")).toBe("Retail");
    expect(effectiveIndustry("  ", "Retail")).toBe("Retail");
    expect(effectiveIndustry(null, null)).toBeNull();
    expect(effectiveIndustry(undefined, undefined)).toBeNull();
  });
});

describe("who may fill in a customer's industry", () => {
  it("is Sales, Admin and Superadmin; nobody else", () => {
    for (const role of ROLES) expect(can(role, "customers.edit"), role).toBe(["SALES", "ADMIN", "SUPERADMIN"].includes(role));
  });

  it("is held only by roles that can open the Customers page", () => {
    for (const role of ROLES) if (can(role, "customers.edit")) expect(can(role, "customers.view"), role).toBe(true);
  });
});
