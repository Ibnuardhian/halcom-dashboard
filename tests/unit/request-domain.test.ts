import { describe, expect, it } from "vitest";
import { CODE_PREFIX_PATTERN, codeScope, formatCode, nameLetters, pickCodePrefix, PROJECT_CODE_WIDTH, twoDigitYear } from "@/domain/requests/codes";
import { canContinueFlow } from "@/domain/requests/access";
import { flowSteps } from "@/domain/requests/flow";
import { formatDateText, parseRecipients, resolveRecipients, singleLine, templateValues } from "@/domain/requests/email";
import { buildRequestEmail } from "@/server/requests/email";
import { addWorkingDays, formatSlaRange, isValidSlaRange, parseSlaRange, slaOf, waitingMs } from "@/domain/requests/sla";
import { DEFAULT_TEMPLATES, renderBody, renderSubject, validateTemplate, variablesIn } from "@/domain/requests/template";
import {
  ACTIVE_STATUSES,
  allowedTransitions,
  boardColumns,
  canHandOver,
  columnOf,
  nextRequestType,
  canTransition,
  isOpen,
  isRetired,
  REQUEST_STATUSES,
  reasonRequired,
} from "@/domain/requests/status";
import { OWNING_ROLE, REQUEST_TYPES, SUBJECT_TAGS, typeFromSlug, typeSlug } from "@/domain/requests/types";

describe("request codes", () => {
  it("takes one letter, the first letter of the e-mail address", () => {
    const none = new Set<string>();
    expect(pickCodePrefix("satrio.akbar@halcominovasi.co.id", none)).toBe("S");
    expect(pickCodePrefix("adityo.prabowo@halcominovasi.co.id", none)).toBe("A");
    expect(pickCodePrefix("Dzaki@halcominovasi.co.id", none)).toBe("D");
    expect(pickCodePrefix("mas.dzaki@example.invalid", none)).toBe("M");
  });

  it("gives a second person with the same letter their first two letters, a third person three", () => {
    expect(pickCodePrefix("soraya@x.id", new Set(["S"]))).toBe("SO");
    expect(pickCodePrefix("satrio@x.id", new Set(["S", "SO"]))).toBe("SA");
    expect(pickCodePrefix("sofia@x.id", new Set(["S", "SO"]))).toBe("SOF");
    // Three characters is all a code has room for: after that comes two letters and a digit.
    expect(pickCodePrefix("sofia@x.id", new Set(["S", "SO", "SOF"]))).toBe("SO2");
    expect(pickCodePrefix("sofia@x.id", new Set(["S", "SO", "SOF", "SO2"]))).toBe("SO3");
    // Only the prefixes that are taken matter, not the order people arrive in.
    expect(pickCodePrefix("soraya@x.id", new Set(["SA"]))).toBe("S");
  });

  it("ignores digits, dots and case in the address, and never returns an empty prefix", () => {
    expect(nameLetters("Budi.S_Pratama+7@x.id")).toBe("BUDISPRATAMA");
    expect(pickCodePrefix("1234@x.id", new Set())).toBe("X");
    expect(pickCodePrefix("@x.id", new Set(["X"]))).toBe("X2");
  });

  it("falls back to a number when every length of the name is taken", () => {
    expect(pickCodePrefix("ab@x.id", new Set(["A", "AB"]))).toBe("AB2");
    expect(pickCodePrefix("ab@x.id", new Set(["A", "AB", "AB2"]))).toBe("AB3");
  });

  it("only produces prefixes the database accepts", () => {
    for (const email of ["a@x", "satrio.akbar@x", "@x", "9@x", "ab@x"]) expect(CODE_PREFIX_PATTERN.test(pickCodePrefix(email, new Set(["A", "AB", "X"])))).toBe(true);
  });

  it("formats codes as TYPE-PREFIX-YY0001", () => {
    expect(formatCode(codeScope("RFQ", "S", "26"), 1)).toBe("RFQ-S-260001");
    expect(formatCode(codeScope("RFQ", "IA", "26"), 1)).toBe("RFQ-IA-260001");
    expect(formatCode(codeScope("BOQ", "IA", "26"), 42)).toBe("BOQ-IA-260042");
    expect(formatCode(codeScope("PO", "SA", "27"), 12345)).toBe("PO-SA-2712345");
    expect(formatCode(codeScope("PRJ", "IA", "26"), 3, 3)).toBe("HIT-PROJ-003");
    expect(formatCode(codeScope("PRJ", "", ""), 35, PROJECT_CODE_WIDTH)).toBe("HIT-PROJ-035");
    expect(formatCode(codeScope("PRJ", "", ""), 1234, PROJECT_CODE_WIDTH)).toBe("HIT-PROJ-1234");
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
    expect(canTransition("SUBMITTED", "IN_PROGRESS", "BOQ")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED", "RFQ")).toBe(true);
    expect(canTransition("SUBMITTED", "COMPLETED", "RFQ")).toBe(true); // no manual In progress step in between
    expect(canTransition("COMPLETED", "CANCELLED", "BOQ")).toBe(false);
    expect(canTransition("IN_PROGRESS", "SUBMITTED", "BOQ")).toBe(false);
  });

  it("no longer lets anyone move a request into Waiting for Sales, but moves an older one on", () => {
    for (const from of ACTIVE_STATUSES) for (const type of REQUEST_TYPES) expect(canTransition(from, "WAITING_FOR_SALES", type)).toBe(false);
    expect(allowedTransitions("WAITING_FOR_SALES", "RFQ")).toEqual(["IN_PROGRESS", "COMPLETED", "CANCELLED"]);
    expect(ACTIVE_STATUSES).not.toContain("WAITING_FOR_SALES");
    expect(REQUEST_STATUSES).toContain("WAITING_FOR_SALES"); // stored values of older requests stay valid
    expect(isRetired("WAITING_FOR_SALES")).toBe(true);
    expect(columnOf("WAITING_FOR_SALES")).toBe("IN_PROGRESS");
  });

  it("has Revision for a BOQ only, and only after it was completed", () => {
    expect(allowedTransitions("COMPLETED", "BOQ")).toEqual(["REVISION"]);
    expect(allowedTransitions("COMPLETED", "RFQ")).toEqual(["IN_PROGRESS"]); // an RFQ or PO is reopened, with a reason
    expect(allowedTransitions("COMPLETED", "PO")).toEqual(["IN_PROGRESS"]);
    expect(allowedTransitions("REVISION", "BOQ")).toEqual(["COMPLETED", "CANCELLED"]);
    for (const from of ["SUBMITTED", "IN_PROGRESS"] as const) expect(canTransition(from, "REVISION", "BOQ")).toBe(false);
    for (const type of ["RFQ", "PO"] as const) expect(canTransition("COMPLETED", "REVISION", type)).toBe(false);
  });

  it("treats cancelled as terminal and never allows a no-op transition", () => {
    expect(allowedTransitions("CANCELLED", "BOQ")).toEqual([]);
    for (const status of REQUEST_STATUSES) for (const type of REQUEST_TYPES) expect(canTransition(status, status, type)).toBe(false);
  });

  it("requires a reason to cancel or reopen, not to start, complete or revise", () => {
    expect(reasonRequired("SUBMITTED", "CANCELLED")).toBe(true);
    expect(reasonRequired("REVISION", "CANCELLED")).toBe(true);
    expect(reasonRequired("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(reasonRequired("SUBMITTED", "IN_PROGRESS")).toBe(false);
    expect(reasonRequired("IN_PROGRESS", "COMPLETED")).toBe(false);
    expect(reasonRequired("COMPLETED", "REVISION")).toBe(false);
    expect(reasonRequired("REVISION", "COMPLETED")).toBe(false);
  });

  it("knows which statuses are open: a revision is open work", () => {
    expect(REQUEST_STATUSES.filter(isOpen)).toEqual(["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES", "REVISION"]);
  });

  it("shows the board columns of a type: Revision on the BOQ board only", () => {
    expect(boardColumns("BOQ")).toEqual(["SUBMITTED", "IN_PROGRESS", "COMPLETED", "REVISION", "CANCELLED"]);
    expect(boardColumns("RFQ")).toEqual(["SUBMITTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
    expect(boardColumns("PO")).toEqual(["SUBMITTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
    expect(boardColumns(null)).toContain("REVISION");
  });

  it("continues the flow BOQ -> RFQ -> PO only from a completed BOQ or RFQ", () => {
    expect(canHandOver("BOQ", "COMPLETED")).toBe(true);
    expect(canHandOver("RFQ", "COMPLETED")).toBe(true);
    expect(canHandOver("BOQ", "IN_PROGRESS")).toBe(false);
    expect(canHandOver("RFQ", "WAITING_FOR_SALES")).toBe(false);
    expect(canHandOver("BOQ", "REVISION")).toBe(false); // continue once the revision is completed
    expect(canHandOver("PO", "COMPLETED")).toBe(false);
    expect([nextRequestType("BOQ"), nextRequestType("RFQ"), nextRequestType("PO")]).toEqual(["RFQ", "PO", null]);
  });

  it("lets the Sales owner, admins and (after a BOQ) SOA decide the next step, and nobody else", () => {
    expect(canContinueFlow("SALES", "BOQ", true)).toBe(true);
    expect(canContinueFlow("SALES", "RFQ", false)).toBe(false);
    expect(canContinueFlow("SOA", "BOQ", false)).toBe(true);
    expect(canContinueFlow("SOA", "RFQ", false)).toBe(false);
    expect(canContinueFlow("ADMIN", "RFQ", false)).toBe(true);
    for (const role of ["PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(canContinueFlow(role, "BOQ", true)).toBe(false);
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

describe("email text from the team template", () => {
  const base: Parameters<typeof templateValues>[0] = {
    type: "RFQ",
    code: "RFQ-IA-260001",
    projectCode: "HIT-PROJ-260004",
    endUserCompany: "PT ABC",
    projectName: "CCTV AI",
    title: "Pricing for 40 cameras",
    description: "Model list attached in the project folder.",
    requiredBy: "2026-11-05",
    requesterName: "Ibnu Ardhian",
    requesterTeam: "Sales",
    sourceCode: null,
    link: "http://localhost:3000/request/RFQ-IA-260001",
    sla: "2-3",
    dueDate: "2026-11-02",
  };
  const subject = (input = base, template = DEFAULT_TEMPLATES.PURCHASING.subject) => renderSubject(template, templateValues(input));
  const body = (input = base, template = DEFAULT_TEMPLATES.PURCHASING.body) => renderBody(template, templateValues(input));

  it("follows [TAG] Company - Project [Request ID] for every type, so a reply carries the Request ID", () => {
    expect(subject()).toBe("[HITRFQ] PT ABC - CCTV AI [RFQ-IA-260001]");
    expect(subject({ ...base, type: "BOQ", code: "BOQ-IA-260001" })).toBe("[HITBOQ] PT ABC - CCTV AI [BOQ-IA-260001]");
    expect(subject({ ...base, type: "PO", code: "PO-IA-260001" })).toBe("[HITPO] PT ABC - CCTV AI [PO-IA-260001]");
  });

  it("trims, collapses whitespace and removes line breaks in the subject", () => {
    expect(subject({ ...base, endUserCompany: "  PT  ABC\r\nBcc: x@y.z ", projectName: " CCTV\tAI " })).toBe("[HITRFQ] PT ABC Bcc: x@y.z - CCTV AI [RFQ-IA-260001]");
    expect(singleLine("a\n\nb")).toBe("a b");
  });

  it("puts the request ID, project, SLA and link in the default text, and asks for the ID in the reply", () => {
    const text = body();
    expect(text).toContain("Request ID   : RFQ-IA-260001");
    expect(text).toContain("Project ID   : HIT-PROJ-260004");
    expect(text).toContain("End user     : PT ABC");
    expect(text).toContain("Needed by    : 5 Nov 2026");
    expect(text).toContain("Reply by     : 2 Nov 2026 (SLA 2-3 working days)");
    expect(text).toContain("Dear Purchasing team,");
    expect(text).toContain("Request link: http://localhost:3000/request/RFQ-IA-260001");
    expect(text).toContain("keep the Request ID RFQ-IA-260001 in the subject");
    expect(text).not.toContain("Source BOQ");
  });

  it("addresses SOA for a BOQ and names the source BOQ on a handover", () => {
    expect(body({ ...base, type: "BOQ", code: "BOQ-IA-260001" })).toContain("Dear SOA team,");
    expect(body({ ...base, sourceCode: "BOQ-IA-260001" })).toContain("Source BOQ   : BOQ-IA-260001 (completed)");
  });

  it("states a missing date and empty details plainly", () => {
    const text = body({ ...base, requiredBy: null, description: "  " });
    expect(text).toContain("Needed by    : Not specified");
    expect(text).toContain("Details\n-\n");
  });

  it("formats dates without locale surprises", () => {
    expect(formatDateText("2026-01-09")).toBe("9 Jan 2026");
    expect(formatDateText("2026-12-31")).toBe("31 Dec 2026");
    expect(formatDateText(null)).toBe("Not specified");
    expect(formatDateText("not a date")).toBe("Not specified");
  });
});

describe("email templates", () => {
  it("both default templates are valid", () => {
    for (const team of ["SOA", "PURCHASING"] as const) {
      expect(validateTemplate(DEFAULT_TEMPLATES[team].subject, DEFAULT_TEMPLATES[team].body)).toEqual([]);
    }
  });

  it("refuses a subject without the Request ID, unknown variables, and empty or too long text", () => {
    expect(validateTemplate("Request for you", "Hello {{request_id}}")).toEqual(["Subjek wajib memuat {{request_id}}, supaya balasan membawa Request ID."]);
    expect(validateTemplate("[{{request_id}}]", "Hi {{customer}} and {{ nope }}")).toEqual(["Variabel tidak dikenal: {{customer}}, {{nope}}."]);
    expect(validateTemplate("", "").length).toBe(3);
    expect(validateTemplate("{{request_id}}", "x".repeat(4001))).toEqual(["Isi email paling banyak 4000 karakter."]);
  });

  it("fills variables with or without spaces, keeps unknown text, and leaves out a line whose variable is empty", () => {
    const values = templateValues({ type: "BOQ", code: "BOQ-1", projectCode: "HIT-PROJ-1", endUserCompany: "A", projectName: "B", title: "T", description: "", requiredBy: null, requesterName: "N", requesterTeam: "Sales", sourceCode: null, link: "L", sla: "2", dueDate: null });
    expect(renderBody("ID {{request_id}} / {{ request_id }}\nSource: {{source_request}}\nDays {{sla_days}}\n{{unknown}}", values)).toBe("ID BOQ-1 / BOQ-1\nDays 2\n{{unknown}}");
    expect(variablesIn("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});

describe("SLA", () => {
  const at = (iso: string) => new Date(iso);
  // 2026-10-19 is a Monday; Jakarta is UTC+7.
  it("counts working days from creation, skipping Saturday and Sunday", () => {
    expect(addWorkingDays(at("2026-10-19T03:00:00Z"), 1).toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(addWorkingDays(at("2026-10-22T03:00:00Z"), 3).toISOString()).toBe("2026-10-27T03:00:00.000Z"); // Thu + 3 = Tue
    expect(addWorkingDays(at("2026-10-24T03:00:00Z"), 1).toISOString()).toBe("2026-10-26T03:00:00.000Z"); // Sat + 1 = Mon
  });

  it("adds up the time spent waiting for Sales, including a stretch that is still running", () => {
    const history = [
      { toStatus: "IN_PROGRESS" as const, changedAt: at("2026-10-19T01:00:00Z") },
      { toStatus: "WAITING_FOR_SALES" as const, changedAt: at("2026-10-19T02:00:00Z") },
      { toStatus: "IN_PROGRESS" as const, changedAt: at("2026-10-19T05:00:00Z") },
      { toStatus: "WAITING_FOR_SALES" as const, changedAt: at("2026-10-19T08:00:00Z") },
    ];
    expect(waitingMs(history, at("2026-10-19T09:00:00Z"))).toBe(4 * 3_600_000);
    expect(waitingMs([], at("2026-10-19T09:00:00Z"))).toBe(0);
  });

  const created = at("2026-10-19T03:00:00Z"); // Monday
  const base = { createdAt: created, completedAt: null, history: [], range: { minDays: 1, maxDays: 1 } };

  it("is on track, due now from the expected date, and overdue after the deadline", () => {
    const range = { minDays: 2, maxDays: 3 }; // expected Wed 21st, due Thu 22nd
    const state = (now: string) => slaOf({ ...base, range, status: "IN_PROGRESS", now: at(now) }).state;
    expect(state("2026-10-19T04:00:00Z")).toBe("on_track");
    expect(state("2026-10-20T04:00:00Z")).toBe("on_track");
    expect(state("2026-10-21T04:00:00Z")).toBe("due_soon");
    expect(state("2026-10-22T02:00:00Z")).toBe("due_soon");
    expect(state("2026-10-22T04:00:00Z")).toBe("overdue");
    const sla = slaOf({ ...base, range, status: "SUBMITTED", now: created });
    expect([sla.targetAt.toISOString(), sla.dueAt.toISOString()]).toEqual(["2026-10-21T03:00:00.000Z", "2026-10-22T03:00:00.000Z"]);
  });

  it("stands still while waiting for Sales, and the dates move by the waiting time", () => {
    const history = [
      { toStatus: "WAITING_FOR_SALES" as const, changedAt: at("2026-10-19T04:00:00Z") },
      { toStatus: "IN_PROGRESS" as const, changedAt: at("2026-10-19T10:00:00Z") },
    ];
    const result = slaOf({ ...base, status: "IN_PROGRESS", history, now: at("2026-10-20T05:00:00Z") });
    expect(result.dueAt.toISOString()).toBe("2026-10-20T09:00:00.000Z");
    expect(result.state).toBe("due_soon");
    expect(slaOf({ ...base, status: "WAITING_FOR_SALES", now: at("2026-10-25T00:00:00Z") }).state).toBe("paused"); // older requests only
    // A BOQ in Revision keeps the result of its first completion: it is not counted late for the time the revision takes.
    const completedAt = at("2026-10-20T01:00:00Z");
    expect(slaOf({ ...base, status: "REVISION", completedAt, now: at("2026-11-30T00:00:00Z") }).state).toBe("met");
  });

  it("is met or late once completed, and has no state when cancelled", () => {
    expect(slaOf({ ...base, status: "COMPLETED", completedAt: at("2026-10-20T02:00:00Z"), now: at("2026-11-01T00:00:00Z") }).state).toBe("met");
    expect(slaOf({ ...base, status: "COMPLETED", completedAt: at("2026-10-21T02:00:00Z"), now: at("2026-11-01T00:00:00Z") }).state).toBe("late");
    expect(slaOf({ ...base, status: "CANCELLED", now: at("2026-11-01T00:00:00Z") }).state).toBe("none");
  });

  it("reads the SLA as one number or a range, up to 7 days, and writes it back the same way", () => {
    expect(parseSlaRange("3")).toEqual({ minDays: 3, maxDays: 3 });
    expect(parseSlaRange("2-3")).toEqual({ minDays: 2, maxDays: 3 });
    expect(parseSlaRange(" 1 – 4 ")).toEqual({ minDays: 1, maxDays: 4 });
    expect(parseSlaRange("2-3 hari")).toEqual({ minDays: 2, maxDays: 3 });
    expect(parseSlaRange("1-7")).toEqual({ minDays: 1, maxDays: 7 });
    for (const bad of ["", "0", "8", "1-8", "3-2", "0-3", "a", "2-", "-3", "1,5", "2-3-4", "2.5"]) expect(parseSlaRange(bad), bad).toBeNull();
    expect(formatSlaRange({ minDays: 2, maxDays: 3 })).toBe("2-3");
    expect(formatSlaRange({ minDays: 3, maxDays: 3 })).toBe("3");
    expect(isValidSlaRange({ minDays: 1, maxDays: 7 })).toBe(true);
    expect([{ minDays: 0, maxDays: 3 }, { minDays: 4, maxDays: 3 }, { minDays: 1, maxDays: 8 }, { minDays: 1.5, maxDays: 3 }].map(isValidSlaRange)).toEqual([false, false, false, false]);
  });
});

describe("flowSteps", () => {
  const req = (code: string, type: "BOQ" | "RFQ" | "PO", status: "SUBMITTED" | "IN_PROGRESS" | "WAITING_FOR_SALES" | "COMPLETED" | "REVISION" | "CANCELLED", flowStopped = false) => ({ code, type, status, flowStopped });
  const states = (requests: Parameters<typeof flowSteps>[0]) => flowSteps(requests).map((step) => step.state);

  it("starts with nothing done", () => {
    expect(states([])).toEqual(["not_started", "not_started", "not_started"]);
  });

  it("follows BOQ -> RFQ -> PO", () => {
    expect(states([req("B", "BOQ", "IN_PROGRESS")])).toEqual(["open", "not_started", "not_started"]);
    expect(states([req("B", "BOQ", "WAITING_FOR_SALES")])).toEqual(["waiting", "not_started", "not_started"]);
    expect(states([req("B", "BOQ", "REVISION")])).toEqual(["open", "not_started", "not_started"]); // a BOQ being revised is open work again
    expect(states([req("B", "BOQ", "COMPLETED"), req("R", "RFQ", "SUBMITTED")])).toEqual(["done", "open", "not_started"]);
    expect(states([req("B", "BOQ", "COMPLETED"), req("R", "RFQ", "COMPLETED"), req("P", "PO", "COMPLETED")])).toEqual(["done", "done", "done"]);
  });

  it("shows a skipped BOQ when the project started with an RFQ", () => {
    expect(states([req("R", "RFQ", "IN_PROGRESS")])).toEqual(["skipped", "open", "not_started"]);
    expect(states([req("P", "PO", "SUBMITTED")])).toEqual(["skipped", "not_started", "open"]);
  });

  it("shows the step after a decision not to continue, and prefers an open request over a cancelled one", () => {
    expect(states([req("B", "BOQ", "COMPLETED", true)])).toEqual(["done", "stopped", "not_started"]);
    expect(states([req("B", "BOQ", "COMPLETED"), req("R", "RFQ", "COMPLETED", true)])).toEqual(["done", "done", "stopped"]);
    const steps = flowSteps([req("B1", "BOQ", "CANCELLED"), req("B2", "BOQ", "IN_PROGRESS")]);
    expect(steps[0]).toMatchObject({ state: "open", code: "B2" });
    expect(states([req("B", "BOQ", "CANCELLED")])).toEqual(["cancelled", "not_started", "not_started"]);
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

describe("the recipients saved for a team", () => {
  const source = { code: "BOQ-S-260001", type: "BOQ" as const, title: "t", description: "", requiredBy: null, project: { code: "HIT-PROJ-001", endUserCompany: "PT A", name: "P" }, requester: { name: "Sales", role: "SALES" as const }, source: null };
  const template = { subject: "[{{request_id}}]", body: "x", sla: { minDays: 2, maxDays: 3 }, dueAt: new Date("2026-10-30T00:00:00Z") };

  it("replace the server settings when a To is saved, and the server settings still apply when it is empty", () => {
    const env = { EMAIL_TO_HITBOQ: "server@halcom.example", EMAIL_CC_HITBOQ: "servercc@halcom.example" };
    expect(buildRequestEmail(source, { ...template, to: "a@halcom.example, b@halcom.example", cc: "b@halcom.example, c@halcom.example" }, env).recipients).toEqual({ ok: true, to: ["a@halcom.example", "b@halcom.example"], cc: ["c@halcom.example"] });
    expect(buildRequestEmail(source, { ...template, to: "", cc: "c@halcom.example" }, env).recipients).toEqual({ ok: true, to: ["server@halcom.example"], cc: ["servercc@halcom.example"] });
    expect(buildRequestEmail(source, template, {}).recipients).toMatchObject({ ok: false });
  });
});
