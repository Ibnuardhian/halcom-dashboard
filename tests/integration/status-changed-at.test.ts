import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { listRequests } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("statusChangedAt, which orders the cards of the board", () => {
  it("is the creation for a request never moved, then the latest move into the current status", async () => {
    const sales = await makeUser("SALES");
    const soa = await makeUser("SOA");
    const project = await createProject(db, { id: sales.id, role: sales.role }, { endUserCompany: `PT Order ${randomBytes(3).toString("hex")}`, name: "Order job" });
    if (!project.ok) throw new Error(project.message);
    const request = await createRequest(db, { id: sales.id, role: sales.role }, { projectId: project.value.id, type: "BOQ", description: "Core switches" });
    if (!request.ok) throw new Error(request.message);
    const find = async () => (await listRequests(db, { id: soa.id, role: soa.role }, { projectId: project.value.id })).find((row) => row.code === request.value.code)!;

    const fresh = await find();
    // Creation writes its own first history step a few milliseconds after the row.
    expect(Math.abs(fresh.statusChangedAt.getTime() - fresh.createdAt.getTime())).toBeLessThan(1000);

    const moved = await changeRequestStatus(db, { id: soa.id, role: soa.role }, { requestId: request.value.id, to: "IN_PROGRESS" });
    expect(moved.ok).toBe(true);
    const inProgress = await find();
    expect(inProgress.statusChangedAt.getTime()).toBeGreaterThan(fresh.statusChangedAt.getTime());
  });
});
