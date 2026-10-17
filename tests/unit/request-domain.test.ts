import { describe, expect, it } from "vitest";
import { codeScope, formatCode, initialsFromEmail, PROJECT_CODE_WIDTH, twoDigitYear } from "@/domain/requests/codes";
import {
  composeBody,
  composeSubject,
  formatDateText,
  parseRecipients,
  resolveRecipients,
  singleLine,
} from "@/domain/requests/email";
import {
  allowedTransitions,
  canHandOver,
  canTransition,
  isOpen,
  REQUEST_STATUSES,
  reasonRequired,
} from "@/domain/requests/status";
import { OWNING_ROLE, REQUEST_TYPES, SUBJECT_TAGS, typeFromSlug, typeSlug } from "@/domain/requests/types";

describe("request codes", () => {
  it("builds initials from the parts of the email address", () => {
    expect(initialsFromEmail("ibnu.ardhian@halcom.co.id")).toBe("IA");
    expect(initialsFromEmail("Budi.S.Pratama@x.id")).toBe("BSP");
    expect(initialsFromEmail("a.b.c.d@x.id")).toBe("ABC");
    expect(initialsFromEmail("first_last-name@x.id")).toBe("FLN");
  });

  it("uses the first two letters when the address has one part", () => {
    expect(initialsFromEmail("sales@example.invalid")).toBe("SA");
    expect(initialsFromEmail("x@example.invalid")).toBe("X");
  });

  it("falls back to XX instead of an empty code segment", () => {
    expect(initialsFromEmail("@example.invalid")).toBe("XX");
    expect(initialsFromEmail("...@example.invalid")).toBe("XX");
  });

  it("formats codes as TYPE-INITIALS-YY0001", () => {
    expect(formatCode(codeScope("RFQ", "IA", "26"), 1)).toBe("RFQ-IA-260001");
    expect(formatCode(codeScope("BOQ", "IA", "26"), 42)).toBe("BOQ-IA-260042");
    expect(formatCode(codeScope("PO", "SA", "27"), 12345)).toBe("PO-SA-2712345");
    expect(formatCode(codeScope("PRJ", "IA", "26"), 3, 3)).toBe("PRJ-003");
    expect(formatCode(codeScope("PRJ", "", ""), 35, PROJECT_CODE_WIDTH)).toBe("PRJ-035");
    expect(formatCode(codeScope("PRJ", "", ""), 1234, PROJECT_CODE_WIDTH)).toBe("PRJ-1234");
  });

  it("rejects a sequence that is not a positive integer", () => {
    expect(() => formatCode("RFQ-IA-26", 0)).toThrow(RangeError);
    expect(() => formatCode("RFQ-IA-26", 1.5)).toThrow(RangeError);
  });

  it("takes the year in the business time zone, not UTC", () => {
    // Jakarta is UTC+7: 2026-12-31 16:30 UTC is 23:30 on 31 Dec there, 17:30 UTC is already 1 Jan 2027.
    expect(twoDigitYear(new Date("2026-12-31T16:30:00Z"))).toBe("26");
    expect(twoDigitYear(new Date("2026-12-31T17:30:00Z"))).toBe("27");
  });
});

describe("request statuses", () => {
  it("allows the confirmed transitions only", () => {
    expect(canTransition("SUBMITTED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("SUBMITTED", "COMPLETED")).toBe(false);
    expect(canTransition("WAITING_FOR_SALES", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("treats cancelled as terminal and never allows a no-op transition", () => {
    expect(allowedTransitions("CANCELLED")).toEqual([]);
    for (const status of REQUEST_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it("requires a reason to wait, cancel or reopen", () => {
    expect(reasonRequired("IN_PROGRESS", "WAITING_FOR_SALES")).toBe(true);
    expect(reasonRequired("SUBMITTED", "CANCELLED")).toBe(true);
    expect(reasonRequired("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(reasonRequired("SUBMITTED", "IN_PROGRESS")).toBe(false);
    expect(reasonRequired("WAITING_FOR_SALES", "IN_PROGRESS")).toBe(false);
    expect(reasonRequired("IN_PROGRESS", "COMPLETED")).toBe(false);
  });

  it("knows which statuses are open", () => {
    expect(REQUEST_STATUSES.filter(isOpen)).toEqual(["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES"]);
  });

  it("allows handover only for a completed BOQ", () => {
    expect(canHandOver("BOQ", "COMPLETED")).toBe(true);
    expect(canHandOver("BOQ", "IN_PROGRESS")).toBe(false);
    expect(canHandOver("RFQ", "COMPLETED")).toBe(false);
    expect(canHandOver("PO", "COMPLETED")).toBe(false);
  });
});

describe("request types", () => {
  it("maps each type to its subject tag, owning team and URL slug", () => {
    expect(SUBJECT_TAGS).toEqual({ BOQ: "[HITBOQ]", RFQ: "[HITRFQ]", PO: "[HITPO]" });
    expect(OWNING_ROLE).toEqual({ BOQ: "SOA", RFQ: "PURCHASING", PO: "PURCHASING" });
    for (const type of REQUEST_TYPES) expect(typeFromSlug(typeSlug(type))).toBe(type);
    expect(typeFromSlug("BOQ")).toBeNull();
    expect(typeFromSlug("other")).toBeNull();
  });
});

describe("email subject", () => {
  it("follows [TAG] Company - Project for every type", () => {
    expect(composeSubject({ type: "BOQ", endUserCompany: "PT ABC", projectName: "CCTV AI" })).toBe("[HITBOQ] PT ABC - CCTV AI");
    expect(composeSubject({ type: "RFQ", endUserCompany: "PT ABC", projectName: "CCTV AI" })).toBe("[HITRFQ] PT ABC - CCTV AI");
    expect(composeSubject({ type: "PO", endUserCompany: "PT ABC", projectName: "CCTV AI" })).toBe("[HITPO] PT ABC - CCTV AI");
  });

  it("trims, collapses whitespace and removes line breaks", () => {
    expect(composeSubject({ type: "BOQ", endUserCompany: "  PT  ABC\r\nBcc: x@y.z ", projectName: " CCTV\tAI " })).toBe(
      "[HITBOQ] PT ABC Bcc: x@y.z - CCTV AI",
    );
    expect(singleLine("a\n\nb")).toBe("a b");
  });

  it("refuses to compose without a company or project name", () => {
    expect(() => composeSubject({ type: "BOQ", endUserCompany: " ", projectName: "x" })).toThrow();
    expect(() => composeSubject({ type: "BOQ", endUserCompany: "x", projectName: "" })).toThrow();
  });
});

describe("email body", () => {
  const base = {
    type: "RFQ" as const,
    code: "RFQ-IA-260001",
    projectCode: "PRJ-260004",
    endUserCompany: "PT ABC",
    projectName: "CCTV AI",
    title: "Pricing for 40 cameras",
    description: "Model list attached in the project folder.",
    requiredBy: "2026-11-05",
    requesterName: "Ibnu Ardhian",
    requesterTeam: "Sales",
    sourceCode: null,
    link: "http://localhost:3000/request/RFQ-IA-260001",
  };

  it("puts the request ID, project and link in the default text", () => {
    const body = composeBody(base);
    expect(body).toContain("Request ID   : RFQ-IA-260001");
    expect(body).toContain("Project ID   : PRJ-260004");
    expect(body).toContain("End user     : PT ABC");
    expect(body).toContain("Needed by    : 5 Nov 2026");
    expect(body).toContain("Dear Purchasing team,");
    expect(body).toContain("Request link: http://localhost:3000/request/RFQ-IA-260001");
    expect(body).not.toContain("Source BOQ");
  });

  it("addresses SOA for a BOQ and names the source BOQ on a handover", () => {
    expect(composeBody({ ...base, type: "BOQ", code: "BOQ-IA-260001" })).toContain("Dear SOA team,");
    expect(composeBody({ ...base, sourceCode: "BOQ-IA-260001" })).toContain("Source BOQ   : BOQ-IA-260001 (completed)");
  });

  it("states a missing date and empty details plainly", () => {
    const body = composeBody({ ...base, requiredBy: null, description: "  " });
    expect(body).toContain("Needed by    : Not specified");
    expect(body).toContain("Details\n-\n");
  });

  it("formats dates without locale surprises", () => {
    expect(formatDateText("2026-01-09")).toBe("9 Jan 2026");
    expect(formatDateText("2026-12-31")).toBe("31 Dec 2026");
    expect(formatDateText(null)).toBe("Not specified");
    expect(formatDateText("not a date")).toBe("Not specified");
  });
});

describe("email recipients", () => {
  it("splits on commas and semicolons, de-duplicates and keeps the first spelling", () => {
    expect(parseRecipients("a@x.id; B@x.id, a@X.id ,, ")).toEqual({ addresses: ["a@x.id", "B@x.id"], invalid: [] });
  });

  it("reports invalid addresses instead of dropping them", () => {
    expect(parseRecipients("a@x.id, nope, @x.id").invalid).toEqual(["nope", "@x.id"]);
  });

  it("resolves To and Cc for the request type and never reuses another type's list", () => {
    const env = {
      EMAIL_TO_HITBOQ: "soa@x.id",
      EMAIL_CC_HITBOQ: "boss@x.id, soa@x.id",
      EMAIL_TO_HITRFQ: "buy@x.id",
    };
    expect(resolveRecipients("BOQ", env)).toEqual({ ok: true, to: ["soa@x.id"], cc: ["boss@x.id"] });
    expect(resolveRecipients("RFQ", env)).toEqual({ ok: true, to: ["buy@x.id"], cc: [] });
    const missing = resolveRecipients("PO", env);
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain("EMAIL_TO_HITPO");
  });

  it("fails visibly on invalid configuration", () => {
    const result = resolveRecipients("BOQ", { EMAIL_TO_HITBOQ: "soa@x.id", EMAIL_CC_HITBOQ: "oops" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("oops");
  });
});
