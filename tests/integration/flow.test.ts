import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { listPendingDecisions } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing, setRequestPhase, stopFlow } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

async function completedRequest(sales: { id: string; role: Role }, worker: { id: string; role: Role }, projectId: string, type: "BOQ" | "RFQ") {
  const created = await createRequest(db, sales, { projectId, type, title: `${type} to complete` });
  if (!created.ok) throw new Error(created.message);
  for (const to of ["IN_PROGRESS", "COMPLETED"]) {
    const moved = await changeRequestStatus(db, worker, { requestId: created.value.id, to });
    if (!moved.ok) throw new Error(moved.message);
  }
  return created.value;
}

async function makeProject(sales: { id: string; role: Role }) {
  const project = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "flow" });
  if (!project.ok) throw new Error(project.message);
  return project.value;
}

describe("the flow BOQ -> RFQ -> PO", () => {
  it("lets the Sales owner continue a completed BOQ as an RFQ, and the RFQ as a PO", async () => {
    const [sales, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");

    expect(await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    const rfq = await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" });
    expect(rfq).toMatchObject({ ok: true, value: { created: true } });
    if (!rfq.ok) return;
    await expect(db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).resolves.toMatchObject({ type: "RFQ", requesterId: sales.id, sourceRequestId: boq.id });

    for (const to of ["IN_PROGRESS", "COMPLETED"]) await changeRequestStatus(db, purchasing, { requestId: rfq.value.id, to });
    const po = await handOverToPurchasing(db, sales, { sourceId: rfq.value.id, targetType: "PO" });
    expect(po).toMatchObject({ ok: true, value: { created: true } });
    await expect(db.request.findUniqueOrThrow({ where: { id: po.ok ? po.value.id : "" } })).resolves.toMatchObject({ type: "PO", sourceRequestId: rfq.value.id });
  });

  it("refuses everyone who does not own the decision: another salesperson, Purchasing for a BOQ, SOA for an RFQ", async () => {
    const [sales, other, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");
    const rfq = await completedRequest(sales, purchasing, project.id, "RFQ");

    expect(await handOverToPurchasing(db, other, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await stopFlow(db, other, { sourceId: boq.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await handOverToPurchasing(db, purchasing, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await handOverToPurchasing(db, soa, { sourceId: rfq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: true }); // SOA may still continue its own BOQ
  });

  it("records a decision not to continue, lists the undecided ones, and lets Sales continue later", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");

    expect((await listPendingDecisions(db, sales, sales.id)).map((row) => row.code)).toContain(boq.code);
    expect(await stopFlow(db, sales, { sourceId: boq.id, note: "Customer postponed" })).toEqual({ ok: true, value: { code: boq.code } });
    expect((await listPendingDecisions(db, sales, sales.id)).map((row) => row.code)).not.toContain(boq.code);
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ flowStoppedById: sales.id, flowStoppedNote: "Customer postponed" });
    await expect(db.auditEvent.count({ where: { action: "request.flow_stopped", entityId: boq.id } })).resolves.toBe(1);
    await expect(db.notification.count({ where: { recipientId: soa.id, kind: "request.flow_stopped" } })).resolves.toBeGreaterThan(0);

    // Changing their mind: continuing clears the decision.
    expect(await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: true });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ flowStoppedAt: null, flowStoppedNote: null });
    expect(await stopFlow(db, sales, { sourceId: boq.id })).toMatchObject({ ok: false, code: "INVALID_STATE" }); // already continued
  });

  it("only has a decision to take on a completed BOQ or RFQ", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const open = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "still open" });
    if (!open.ok) throw new Error(open.message);
    const purchasing = await actorOf("PURCHASING");
    const rfq = await completedRequest(sales, purchasing, project.id, "RFQ");
    const po = await handOverToPurchasing(db, sales, { sourceId: rfq.id, targetType: "PO" });
    if (!po.ok) throw new Error(po.message);

    expect(await stopFlow(db, sales, { sourceId: open.value.id })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await stopFlow(db, sales, { sourceId: po.value.id })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await stopFlow(db, soa, { sourceId: crypto.randomUUID() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("a PO follows an RFQ", () => {
  it("refuses a PO until the project has a completed RFQ, then accepts it; the BOQ can be skipped", async () => {
    const [sales, purchasing] = await Promise.all([actorOf("SALES"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);

    expect(await createRequest(db, sales, { projectId: project.id, type: "PO", title: "too early" })).toMatchObject({ ok: false, code: "INVALID_STATE", message: expect.stringContaining("completed RFQ") });
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "starts without a BOQ" }); // the BOQ is skipped
    if (!rfq.ok) throw new Error(rfq.message);
    expect(await createRequest(db, sales, { projectId: project.id, type: "PO", title: "RFQ still open" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    for (const to of ["IN_PROGRESS", "COMPLETED"]) await changeRequestStatus(db, purchasing, { requestId: rfq.value.id, to });
    expect(await createRequest(db, sales, { projectId: project.id, type: "PO", title: "now allowed" })).toMatchObject({ ok: true, value: { created: true } });
  });

  it("a new project cannot start with a PO", async () => {
    const sales = await actorOf("SALES");
    const result = await createProject(db, sales, { endUserCompany: "PT start", name: "start with PO", request: { type: "PO", title: "no" } });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await expect(db.project.count({ where: { endUserCompany: "PT start", name: "start with PO" } })).resolves.toBe(0);
  });
});

describe("a request that waits for Sales", () => {
  async function waiting() {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const created = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "needs input" });
    if (!created.ok) throw new Error(created.message);
    await changeRequestStatus(db, soa, { requestId: created.value.id, to: "IN_PROGRESS" });
    await changeRequestStatus(db, soa, { requestId: created.value.id, to: "WAITING_FOR_SALES", reason: "Which cameras?" });
    return { sales, soa, id: created.value.id, code: created.value.code };
  }

  it("lets the Sales owner answer, which puts it back In progress, records the answer and tells the team", async () => {
    const { sales, soa, id, code } = await waiting();

    expect(await changeRequestStatus(db, sales, { requestId: id, to: "IN_PROGRESS" })).toMatchObject({ ok: false, code: "INVALID_INPUT" }); // the answer is required
    expect(await changeRequestStatus(db, sales, { requestId: id, to: "IN_PROGRESS", reason: "Hikvision DS-2CD, 40 pcs" })).toMatchObject({ ok: true, value: { status: "IN_PROGRESS" } });

    const history = await db.requestStatusHistory.findMany({ where: { requestId: id }, orderBy: { changedAt: "asc" } });
    expect(history.at(-1)).toMatchObject({ fromStatus: "WAITING_FOR_SALES", toStatus: "IN_PROGRESS", changedById: sales.id, reason: "Hikvision DS-2CD, 40 pcs" });
    await expect(db.notification.count({ where: { recipientId: soa.id, title: `${code}: Sales answered` } })).resolves.toBe(1);
  });

  it("lets the Sales owner cancel it with a reason, and nothing else", async () => {
    const { sales, id } = await waiting();

    expect(await changeRequestStatus(db, sales, { requestId: id, to: "COMPLETED", reason: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeRequestStatus(db, sales, { requestId: id, to: "CANCELLED", reason: "No longer needed" })).toMatchObject({ ok: true, value: { status: "CANCELLED" } });
  });

  it("is refused for another salesperson, and for the owner once the request is not waiting", async () => {
    const { sales, soa, id } = await waiting();
    const other = await actorOf("SALES");

    expect(await changeRequestStatus(db, other, { requestId: id, to: "IN_PROGRESS", reason: "hi" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await changeRequestStatus(db, sales, { requestId: id, to: "IN_PROGRESS", reason: "answer" });
    expect(await changeRequestStatus(db, sales, { requestId: id, to: "CANCELLED", reason: "late" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeRequestStatus(db, soa, { requestId: id, to: "COMPLETED" })).toMatchObject({ ok: true });
  });
});

describe("less manual status work", () => {
  it("a handed-over request arrives In progress, with no one having to accept it", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");

    const rfq = await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);

    await expect(db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).resolves.toMatchObject({ status: "IN_PROGRESS", assigneeId: null });
    const history = await db.requestStatusHistory.findMany({ where: { requestId: rfq.value.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "IN_PROGRESS" });
  });

  it("a new request can be completed, or put to Sales, without a manual In progress step; whoever acts first owns it", async () => {
    const [sales, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const boq = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "straight to waiting" });
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "straight to done" });
    if (!boq.ok || !rfq.ok) throw new Error("setup");

    expect(await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "WAITING_FOR_SALES", reason: "Which brand?" })).toMatchObject({ ok: true });
    expect(await changeRequestStatus(db, purchasing, { requestId: rfq.value.id, to: "COMPLETED" })).toMatchObject({ ok: true });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.value.id } })).resolves.toMatchObject({ status: "WAITING_FOR_SALES", assigneeId: soa.id });
    await expect(db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).resolves.toMatchObject({ status: "COMPLETED", assigneeId: purchasing.id });
  });

  it("setting the SOA phase on a BOQ nobody had touched starts it", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "start by labelling" });
    if (!boq.ok) throw new Error(boq.message);

    expect(await setRequestPhase(db, soa, { requestId: boq.value.id, phase: "ASSESSMENT" })).toMatchObject({ ok: true });

    await expect(db.request.findUniqueOrThrow({ where: { id: boq.value.id } })).resolves.toMatchObject({ status: "IN_PROGRESS", phase: "ASSESSMENT", assigneeId: soa.id });
    const history = await db.requestStatusHistory.findMany({ where: { requestId: boq.value.id }, orderBy: { changedAt: "asc" } });
    expect(history.at(-1)).toMatchObject({ fromStatus: "SUBMITTED", toStatus: "IN_PROGRESS", changedById: soa.id });
  });
});
