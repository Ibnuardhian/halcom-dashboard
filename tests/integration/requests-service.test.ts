import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { twoDigitYear } from "@/domain/requests/codes";
import type { RequestType } from "@/domain/requests/types";
import { getDb } from "@/lib/db";
import { getRequestByCode, getWorkStats, listProjects, listRequests } from "@/server/requests/queries";
import {
  changeRequestStatus,
  createProject,
  createRequest,
  handOverToPurchasing,
  type Actor,
} from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
const YY = twoDigitYear(new Date());

afterAll(async () => {
  await db.$disconnect();
});

/** A user whose email gives the initials `local` (for example "qa.one" gives "QO"); the domain keeps emails unique. */
async function actorOf(role: Role, local = "tester.one"): Promise<Actor & { email: string }> {
  const email = `${local}@d${randomBytes(4).toString("hex")}.example.invalid`;
  const user = await makeUser(role, { email });
  return { id: user.id, role: user.role, email };
}

async function makeProject(sales: Actor) {
  const result = await createProject(db, sales, { endUserCompany: "PT ABC", name: "CCTV AI" });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function makeRequest(sales: Actor, projectId: string, type: RequestType = "BOQ", extra: object = {}) {
  const result = await createRequest(db, sales, { projectId, type, title: "Need a BOQ", ...extra });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function advance(actor: Actor, requestId: string, to: string, reason?: string) {
  return changeRequestStatus(db, actor, { requestId, to, reason });
}

async function completedBoq(sales: Actor, soa: Actor, projectId: string) {
  const boq = await makeRequest(sales, projectId, "BOQ");
  expect((await advance(soa, boq.id, "IN_PROGRESS")).ok).toBe(true);
  expect((await advance(soa, boq.id, "COMPLETED")).ok).toBe(true);
  return boq;
}

describe("createProject", () => {
  it("creates a project with the next PRJ code, the creator as Sales owner, and an audit event", async () => {
    const sales = await actorOf("SALES");

    const first = await createProject(db, sales, {
      endUserCompany: "  PT ABC ",
      name: " CCTV AI ",
      description: "",
      targetDate: "2026-12-31",
    });
    const second = await createProject(db, sales, { endUserCompany: "PT XYZ", name: "Access control" });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.code).toMatch(/^PRJ-\d{3,}$/);
    const numbers = [first.value.code, second.value.code].map((code) => Number(code.slice(4)));
    expect(numbers[1]).toBeGreaterThan(numbers[0]!); // not "+1": the import tests may raise the shared counter in between

    const stored = await db.project.findUniqueOrThrow({ where: { id: first.value.id } });
    expect(stored).toMatchObject({
      endUserCompany: "PT ABC",
      name: "CCTV AI",
      description: null,
      status: "ACTIVE",
      salesOwnerId: sales.id,
    });
    expect(stored.targetDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    const events = await db.auditEvent.findMany({ where: { entityType: "project", entityId: first.value.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: sales.id, action: "project.created" });
  });

  it("returns the first project when the same submission key is sent again, even concurrently", async () => {
    const sales = await actorOf("SALES");
    const input = { endUserCompany: "PT ABC", name: "Once", submissionKey: `key-${randomBytes(6).toString("hex")}` };

    const results = await Promise.all([createProject(db, sales, input), createProject(db, sales, input), createProject(db, sales, input)]);

    const values = results.map((result) => (result.ok ? result.value : null));
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values.map((value) => value!.id)).size).toBe(1);
    expect(values.filter((value) => value!.created)).toHaveLength(1);
    await expect(db.project.count({ where: { submissionKey: input.submissionKey } })).resolves.toBe(1);
  });

  it("rejects roles without the permission, blank names, bad dates and deactivated users", async () => {
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const result = await createProject(db, await actorOf(role), { endUserCompany: "PT ABC", name: "X" });
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const sales = await actorOf("SALES");
    expect(await createProject(db, sales, { endUserCompany: "   ", name: "X" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createProject(db, sales, { endUserCompany: "A", name: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createProject(db, sales, { endUserCompany: "A", name: "B", targetDate: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });

    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    expect(await createProject(db, sales, { endUserCompany: "A", name: "B" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("createRequest", () => {
  it("numbers requests TYPE-INITIALS-YY0001 with a separate counter per type and per initials", async () => {
    const ibnu = await actorOf("SALES", "qa.one");
    const other = await actorOf("SALES", "qa.two");
    const project = await makeProject(ibnu);

    const rfq1 = await makeRequest(ibnu, project.id, "RFQ");
    const rfq2 = await makeRequest(ibnu, project.id, "RFQ");
    const boq1 = await makeRequest(ibnu, project.id, "BOQ");
    const po1 = await makeRequest(ibnu, project.id, "PO");
    const otherRfq = await makeRequest(other, project.id, "RFQ");

    expect(rfq1.code).toBe(`RFQ-QO-${YY}0001`);
    expect(rfq2.code).toBe(`RFQ-QO-${YY}0002`);
    expect(boq1.code).toBe(`BOQ-QO-${YY}0001`);
    expect(po1.code).toBe(`PO-QO-${YY}0001`);
    expect(otherRfq.code).toBe(`RFQ-QT-${YY}0001`);
  });

  it("never hands out the same code twice under concurrency", async () => {
    const sales = await actorOf("SALES", "qa.race");
    const project = await makeProject(sales);

    const results = await Promise.all(Array.from({ length: 8 }, () => createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Race" })));

    const codes = results.map((result) => (result.ok ? result.value.code : "failed"));
    expect(codes).not.toContain("failed");
    expect(new Set(codes).size).toBe(8);
    expect(codes.map((code) => Number(code.slice(-4))).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stores the request as Submitted and unassigned, with a history row and an audit event", async () => {
    const sales = await actorOf("SALES", "qa.store");
    const project = await makeProject(sales);

    const request = await makeRequest(sales, project.id, "BOQ", { description: "Details", requiredBy: "2026-11-05" });

    const stored = await db.request.findUniqueOrThrow({ where: { id: request.id }, include: { statusHistory: true } });
    expect(stored).toMatchObject({ status: "SUBMITTED", assigneeId: null, requesterId: sales.id, projectId: project.id, sourceRequestId: null });
    expect(stored.requiredBy?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(stored.statusHistory).toHaveLength(1);
    expect(stored.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: "SUBMITTED", changedById: sales.id });
    const events = await db.auditEvent.findMany({ where: { entityType: "request", entityId: request.id } });
    expect(events.map((event) => event.action)).toEqual(["request.created"]);
  });

  it("is idempotent for a repeated submission key", async () => {
    const sales = await actorOf("SALES", "qa.idem");
    const project = await makeProject(sales);
    const input = { projectId: project.id, type: "RFQ", title: "Once", submissionKey: `key-${randomBytes(6).toString("hex")}` };

    const results = await Promise.all([createRequest(db, sales, input), createRequest(db, sales, input)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const ids = results.map((result) => (result.ok ? result.value.id : ""));
    expect(ids[0]).toBe(ids[1]);
    await expect(db.request.count({ where: { projectId: project.id } })).resolves.toBe(1);
  });

  it("rejects missing projects, inactive projects, invalid input and unauthorised roles", async () => {
    const sales = await actorOf("SALES", "qa.rej");
    const project = await makeProject(sales);

    expect(await createRequest(db, sales, { projectId: crypto.randomUUID(), type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "  " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createRequest(db, sales, { projectId: project.id, type: "XYZ", title: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createRequest(db, sales, { projectId: "nope", type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await createRequest(db, await actorOf(role), { projectId: project.id, type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }

    await db.project.update({ where: { id: project.id }, data: { status: "CLOSED" } });
    expect(await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "PROJECT_NOT_ACTIVE" });
  });
});

describe("changeRequestStatus", () => {
  it("walks a BOQ through its statuses, recording assignee, completion time and history", async () => {
    const sales = await actorOf("SALES", "qa.flow");
    const soa = await actorOf("SOA", "soa.flow");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");

    expect((await advance(soa, boq.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await advance(soa, boq.id, "WAITING_FOR_SALES", "Need the floor plan")).ok).toBe(true);
    expect((await advance(soa, boq.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await advance(soa, boq.id, "COMPLETED")).ok).toBe(true);

    const done = await db.request.findUniqueOrThrow({ where: { id: boq.id }, include: { statusHistory: { orderBy: { changedAt: "asc" } } } });
    expect(done).toMatchObject({ status: "COMPLETED", assigneeId: soa.id });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.statusHistory.map((row) => [row.fromStatus, row.toStatus])).toEqual([
      [null, "SUBMITTED"],
      ["SUBMITTED", "IN_PROGRESS"],
      ["IN_PROGRESS", "WAITING_FOR_SALES"],
      ["WAITING_FOR_SALES", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ]);
    expect(done.statusHistory[2]).toMatchObject({ reason: "Need the floor plan", changedById: soa.id });

    // Reopening needs a reason, clears completed_at and keeps the earlier completion in the history.
    expect(await advance(soa, boq.id, "IN_PROGRESS")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await advance(soa, boq.id, "IN_PROGRESS", "Customer changed the scope")).ok).toBe(true);
    const reopened = await db.request.findUniqueOrThrow({ where: { id: boq.id }, include: { statusHistory: true } });
    expect(reopened).toMatchObject({ status: "IN_PROGRESS", completedAt: null });
    expect(reopened.statusHistory.filter((row) => row.toStatus === "COMPLETED")).toHaveLength(1);
  });

  it("requires a reason to wait or cancel, and refuses transitions that are not allowed", async () => {
    const sales = await actorOf("SALES", "qa.rules");
    const soa = await actorOf("SOA", "soa.rules");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");

    expect(await advance(soa, boq.id, "COMPLETED")).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await advance(soa, boq.id, "CANCELLED")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await advance(soa, boq.id, "CANCELLED", "Customer cancelled")).ok).toBe(true);
    const final = await advance(soa, boq.id, "IN_PROGRESS");
    expect(final).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(!final.ok && final.message).toContain("final");
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ status: "CANCELLED", completedAt: null });
  });

  it("lets only the owning team (and admins) work on a request type", async () => {
    const sales = await actorOf("SALES", "qa.team");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    const rfq = await makeRequest(sales, project.id, "RFQ");

    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await advance(await actorOf(role), boq.id, "IN_PROGRESS")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    for (const role of ["SALES", "SOA", "FINANCE", "MANAGEMENT"] as const) {
      expect(await advance(await actorOf(role), rfq.id, "IN_PROGRESS")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await advance(await actorOf("PURCHASING"), rfq.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await advance(await actorOf("ADMIN"), boq.id, "IN_PROGRESS")).ok).toBe(true);
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("completes only once when two people click at the same time", async () => {
    const sales = await actorOf("SALES", "qa.dbl");
    const soa = await actorOf("SOA", "soa.dbl");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    await advance(soa, boq.id, "IN_PROGRESS");

    const results = await Promise.all([advance(soa, boq.id, "COMPLETED"), advance(soa, boq.id, "COMPLETED")]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "INVALID_STATE" });
    const history = await db.requestStatusHistory.findMany({ where: { requestId: boq.id, toStatus: "COMPLETED" } });
    expect(history).toHaveLength(1);
  });

  it("writes one audit event per change and reports unknown requests", async () => {
    const sales = await actorOf("SALES", "qa.aud");
    const soa = await actorOf("SOA", "soa.aud");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    await advance(soa, boq.id, "IN_PROGRESS");

    const events = await db.auditEvent.findMany({ where: { entityType: "request", entityId: boq.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["request.created", "request.status_changed"]);
    expect(events[1]).toMatchObject({ actorId: soa.id, before: { status: "SUBMITTED" }, after: { status: "IN_PROGRESS", reason: null } });
    expect(await advance(soa, crypto.randomUUID(), "IN_PROGRESS")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("handOverToPurchasing", () => {
  it("creates a linked RFQ from a completed BOQ, carrying the project and context", async () => {
    const sales = await actorOf("SALES", "qa.ho");
    const soa = await actorOf("SOA", "so.ho");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ", { description: "Spec", requiredBy: "2026-11-05" });
    await advance(soa, boq.id, "IN_PROGRESS");
    await advance(soa, boq.id, "COMPLETED");

    const result = await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ created: true, code: `RFQ-SH-${YY}0001` });
    const rfq = await db.request.findUniqueOrThrow({ where: { id: result.value.id }, include: { statusHistory: true } });
    expect(rfq).toMatchObject({
      type: "RFQ",
      status: "SUBMITTED",
      projectId: project.id,
      sourceRequestId: boq.id,
      requesterId: soa.id,
      title: "Need a BOQ",
      description: "Spec",
    });
    expect(rfq.requiredBy?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(rfq.statusHistory[0]?.reason).toBe(`Handed over from ${boq.code}`);
    const events = await db.auditEvent.findMany({ where: { entityId: rfq.id } });
    expect(events[0]).toMatchObject({ action: "request.handed_over", after: { sourceCode: boq.code, type: "RFQ" } });
  });

  it("is idempotent: a repeated or concurrent click returns the same request", async () => {
    const sales = await actorOf("SALES", "qa.ho2");
    const soa = await actorOf("SOA", "so.ho2");
    const project = await makeProject(sales);
    const boq = await completedBoq(sales, soa, project.id);

    const results = await Promise.all([
      handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "PO" }),
      handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "PO" }),
      handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "PO" }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    const values = results.map((result) => (result.ok ? result.value : null));
    expect(new Set(values.map((value) => value!.id)).size).toBe(1);
    expect(values.filter((value) => value!.created)).toHaveLength(1);
    await expect(db.request.count({ where: { sourceRequestId: boq.id, type: "PO" } })).resolves.toBe(1);

    // RFQ and PO are separate choices and may both exist for one BOQ.
    const rfq = await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" });
    expect(rfq).toMatchObject({ ok: true, value: { created: true } });
  });

  it("refuses a BOQ that is not completed, a non-BOQ source, a bad type and unauthorised roles", async () => {
    const sales = await actorOf("SALES", "qa.ho3");
    const soa = await actorOf("SOA", "so.ho3");
    const project = await makeProject(sales);
    const openBoq = await makeRequest(sales, project.id, "BOQ");
    const rfq = await makeRequest(sales, project.id, "RFQ");
    const done = await completedBoq(sales, soa, project.id);

    expect(await handOverToPurchasing(db, soa, { sourceId: openBoq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await handOverToPurchasing(db, soa, { sourceId: rfq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await handOverToPurchasing(db, soa, { sourceId: done.id, targetType: "BOQ" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await handOverToPurchasing(db, soa, { sourceId: crypto.randomUUID(), targetType: "RFQ" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await handOverToPurchasing(db, await actorOf(role), { sourceId: done.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(db.request.count({ where: { sourceRequestId: { not: null }, projectId: project.id } })).resolves.toBe(0);
  });
});

describe("database rules", () => {
  it("rejects malformed codes, a prefix that does not match the type, and an inconsistent completion time", async () => {
    const sales = await actorOf("SALES", "qa.db");
    const project = await makeProject(sales);
    const base = { projectId: project.id, requesterId: sales.id, title: "x" };

    await expect(db.request.create({ data: { ...base, type: "RFQ", code: "BOQ-IA-260001" } })).rejects.toThrow(/requests_code_format_chk/);
    await expect(db.request.create({ data: { ...base, type: "RFQ", code: "RFQ-1" } })).rejects.toThrow(/requests_code_format_chk/);
    await expect(db.request.create({ data: { ...base, type: "RFQ", code: `RFQ-DB-${YY}0001`, status: "COMPLETED" } })).rejects.toThrow(
      /requests_completed_at_matches_status_chk/,
    );
    await expect(db.request.create({ data: { ...base, type: "RFQ", code: `RFQ-DB-${YY}0002`, title: "  " } })).rejects.toThrow(/requests_title_not_blank_chk/);
    await expect(db.project.create({ data: { code: "P-1", endUserCompany: "A", name: "B", salesOwnerId: sales.id } })).rejects.toThrow(/projects_code_format_chk/);
  });

  it("keeps the status history append-only", async () => {
    const sales = await actorOf("SALES", "qa.ao");
    const project = await makeProject(sales);
    const request = await makeRequest(sales, project.id, "BOQ");
    const row = await db.requestStatusHistory.findFirstOrThrow({ where: { requestId: request.id } });

    await expect(db.requestStatusHistory.update({ where: { id: row.id }, data: { reason: "edited" } })).rejects.toThrow(/append-only/);
    await expect(db.requestStatusHistory.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "request_status_history"`)).rejects.toThrow(/append-only/);
  });
});

describe("read queries", () => {
  it("lists projects and requests with filters, and counts real work for the dashboards", async () => {
    const sales = await actorOf("SALES", "qa.rd");
    const viewer = await actorOf("FINANCE");
    const project = await createProject(db, sales, { endUserCompany: "PT Unique Reader Co", name: "Readable" });
    if (!project.ok) throw new Error(project.message);
    await makeRequest(sales, project.value.id, "BOQ");
    const rfq = await makeRequest(sales, project.value.id, "RFQ");
    await advance(await actorOf("PURCHASING"), rfq.id, "IN_PROGRESS");

    const projects = await listProjects(db, viewer, { search: "unique reader" });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ code: project.value.code, salesOwnerName: "Test SALES", openRequests: 2, totalRequests: 2 });

    const boqs = await listRequests(db, viewer, { type: "BOQ", projectId: project.value.id });
    expect(boqs).toHaveLength(1);
    expect(boqs[0]).toMatchObject({ endUserCompany: "PT Unique Reader Co", assigneeName: null, status: "SUBMITTED" });
    const inProgress = await listRequests(db, viewer, { status: "IN_PROGRESS", projectId: project.value.id });
    expect(inProgress.map((row) => row.code)).toEqual([rfq.code]);

    const detail = await getRequestByCode(db, viewer, rfq.code);
    expect(detail).toMatchObject({ code: rfq.code, project: { code: project.value.code } });
    expect(detail?.statusHistory).toHaveLength(2);
    await expect(getRequestByCode(db, viewer, "RFQ-ZZ-999999")).resolves.toBeNull();

    const stats = await getWorkStats(db, viewer);
    expect(stats.projectsActive).toBeGreaterThanOrEqual(1);
    expect(stats.openByType.BOQ).toBeGreaterThanOrEqual(1);
    expect(stats.statusCounts.RFQ.IN_PROGRESS).toBeGreaterThanOrEqual(1);
  });
});
