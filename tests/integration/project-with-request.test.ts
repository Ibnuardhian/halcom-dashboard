import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const base = () => ({ endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "CCTV AI" });

describe("createProject with a first request", () => {
  it("creates the project, its commercial details and a BOQ request in one go", async () => {
    const sales = await makeUser("SALES");

    const result = await createProject(db, { id: sales.id, role: "SALES" }, {
      ...base(),
      estimatedValue: "1.500.000.000",
      progress: "PROPOSE",
      trackStatus: "ON_HOLD",
      targetMargin: "11,5",
      request: { type: "BOQ", title: "BOQ for 40 cameras", description: "4K, PoE", requiredBy: "2026-12-01" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestCode).toMatch(/^BOQ-[A-Z0-9]+-\d{6,}$/);
    const project = await db.project.findUniqueOrThrow({ where: { id: result.value.id }, include: { requests: { include: { statusHistory: true } } } });
    expect(project.estimatedValue?.toNumber()).toBe(1_500_000_000);
    expect(project).toMatchObject({ progress: "PROPOSE", trackStatus: "ON_HOLD" });
    expect(project.targetMargin?.toNumber()).toBe(11.5);
    expect(project.requests).toHaveLength(1);
    expect(project.requests[0]).toMatchObject({ code: result.value.requestCode, type: "BOQ", requesterId: sales.id, status: "SUBMITTED", title: "BOQ for 40 cameras" });
    expect(project.requests[0]!.statusHistory).toHaveLength(1);
    await expect(db.auditEvent.count({ where: { action: "request.created", entityId: project.requests[0]!.id } })).resolves.toBe(1);
  });

  it("works without a request, and an RFQ or PO can be the first request too", async () => {
    const sales = await makeUser("SALES");
    const actor = { id: sales.id, role: "SALES" as const };

    const plain = await createProject(db, actor, base());
    const rfq = await createProject(db, actor, { ...base(), request: { type: "RFQ", title: "Price for 10 servers" } });

    expect(plain).toMatchObject({ ok: true, value: { requestCode: null } });
    if (plain.ok) await expect(db.project.findUniqueOrThrow({ where: { id: plain.value.id } })).resolves.toMatchObject({ progress: "QUALIFY", trackStatus: "ON_TRACK" });
    expect(rfq.ok && rfq.value.requestCode).toMatch(/^RFQ-/);
  });

  it("creates nothing when the request is invalid or the values are wrong", async () => {
    const sales = await makeUser("SALES");
    const actor = { id: sales.id, role: "SALES" as const };
    const company = `PT ${randomBytes(3).toString("hex")}`;

    await expect(createProject(db, actor, { endUserCompany: company, name: "X", request: { type: "BOQ", title: "  " } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createProject(db, actor, { endUserCompany: company, name: "X", targetMargin: "150" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createProject(db, actor, { endUserCompany: company, name: "X", request: { type: "XYZ", title: "t" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    await expect(db.project.count({ where: { endUserCompany: company } })).resolves.toBe(0);
  });

  it("a repeated submit with the same key gives one project and one request", async () => {
    const sales = await makeUser("SALES");
    const actor = { id: sales.id, role: "SALES" as const };
    const input = { ...base(), submissionKey: randomBytes(8).toString("hex"), request: { type: "BOQ", title: "Once only" } };

    const first = await createProject(db, actor, input);
    const second = await createProject(db, actor, input);

    expect(first.ok && second.ok && first.value.id === second.value.id).toBe(true);
    expect(second.ok && second.value.created).toBe(false);
    await expect(db.request.count({ where: { requesterId: sales.id } })).resolves.toBe(1);
  });

  it("refuses roles that cannot create projects", async () => {
    const purchasing = await makeUser("PURCHASING");
    const soa = await makeUser("SOA");

    await expect(createProject(db, { id: purchasing.id, role: "PURCHASING" }, { ...base(), request: { type: "BOQ", title: "t" } })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // SOA may create a project with a BOQ, but for a salesperson: without one it is refused as invalid input.
    await expect(createProject(db, { id: soa.id, role: "SOA" }, { ...base(), request: { type: "BOQ", title: "t" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
