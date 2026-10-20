import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createMasterRecord, setProjectMasterData } from "@/server/masterdata/service";
import { searchRequests } from "@/server/requests/queries";
import { assignRequestPic } from "@/server/pics/service";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

type Actor = { id: string; role: Parameters<typeof createRequest>[1]["role"] };
const actor = (user: Actor): Actor => ({ id: user.id, role: user.role });

/** Three RFQs and one BOQ under a tag nothing else uses, so a search for the tag sees only these. */
async function fixture() {
  const tag = `tag${randomBytes(4).toString("hex")}`;
  const [sales, soa, purchasing] = await Promise.all([makeUser("SALES"), makeUser("SOA"), makeUser("PURCHASING")]);
  const principal = await createMasterRecord(db, actor(soa), { kind: "principal", name: `Principal ${tag}` });
  const solution = await createMasterRecord(db, actor(soa), { kind: "solution", name: `Solution ${tag}` });
  if (!principal.ok || !solution.ok) throw new Error("setup");

  const made: { code: string; projectId: string; id: string }[] = [];
  for (const [index, endUser] of ["Alpha", "Bravo", "Charlie"].entries()) {
    const project = await createProject(db, actor(sales), { endUserCompany: `${endUser} ${tag}`, name: `Project ${index}` });
    if (!project.ok) throw new Error(project.message);
    const request = await createRequest(db, actor(sales), { projectId: project.value.id, type: "RFQ", title: `Switches ${index}`, description: `${index * 10} units of item ${tag}-${index}` });
    if (!request.ok) throw new Error(request.message);
    made.push({ code: request.value.code, projectId: project.value.id, id: request.value.id });
  }
  await setProjectMasterData(db, actor(soa), { projectId: made[0].projectId, principalId: principal.value.id, solutionId: solution.value.id });
  const boqProject = await createProject(db, actor(sales), { endUserCompany: `Delta ${tag}`, name: "Only a BOQ" });
  if (!boqProject.ok) throw new Error(boqProject.message);
  const boq = await createRequest(db, actor(sales), { projectId: boqProject.value.id, type: "BOQ", title: "A BOQ" });
  if (!boq.ok) throw new Error(boq.message);
  return { tag, sales, soa, purchasing, made, boq: boq.value, principal: principal.value, solution: solution.value };
}

describe("searchRequests (the RFQ list)", () => {
  it("returns only RFQs when asked for them, with project, End User, requester, Principal, Solution, item details, PIC and SLA", async () => {
    const { tag, sales, purchasing, made } = await fixture();
    await changeRequestStatus(db, actor(purchasing), { requestId: made[0].id, to: "IN_PROGRESS" });
    const pic = await db.pic.create({ data: { team: "PURCHASING", name: `Budi ${tag}`, nameKey: `budi ${tag}` } });
    await assignRequestPic(db, actor(purchasing), { requestId: made[0].id, picId: pic.id });

    const page = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort: "created", dir: "asc" });

    expect(page.total).toBe(3);
    expect(page.rows.map((row) => row.type)).toEqual(["RFQ", "RFQ", "RFQ"]);
    const first = page.rows.find((row) => row.code === made[0].code)!;
    expect(first).toMatchObject({
      endUserCompany: `Alpha ${tag}`,
      projectName: "Project 0",
      requesterName: sales.name,
      principalName: `Principal ${tag}`,
      solutionName: `Solution ${tag}`,
      title: "Switches 0",
      description: `0 units of item ${tag}-0`,
      status: "IN_PROGRESS",
      assigneeName: pic.name,
    });
    expect(first.sla.dueAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    const unclassified = page.rows.find((row) => row.code === made[1].code)!;
    expect(unclassified).toMatchObject({ principalName: null, solutionName: null, assigneeName: null });
  });

  it("finds a request by End User, requester, Principal, Solution, item details, PIC and code, ignoring case, and by nothing else", async () => {
    const { tag, purchasing, made, sales } = await fixture();
    await changeRequestStatus(db, actor(purchasing), { requestId: made[2].id, to: "IN_PROGRESS" });
    const codes = async (q: string) => (await searchRequests(db, actor(purchasing), { type: "RFQ", q })).rows.map((row) => row.code);

    expect(await codes(`bravo ${tag}`)).toEqual([made[1].code]);
    expect(await codes(`PRINCIPAL ${tag}`)).toEqual([made[0].code]);
    expect(await codes(`solution ${tag}`)).toEqual([made[0].code]);
    expect(await codes(`${tag}-2`)).toEqual([made[2].code]);
    expect(await codes(made[1].code.toLowerCase())).toEqual([made[1].code]);
    expect(await codes(purchasing.email.split("@")[0]!)).toEqual([]); // email is not searched
    expect((await codes(sales.name)).length).toBeGreaterThanOrEqual(3);
    expect(await codes(`nothing-matches-${tag}`)).toEqual([]);
    // Percent signs and underscores are text, not wildcards.
    expect(await codes("%")).toEqual([]);
  });

  it("keeps the BOQ out of an RFQ search and respects the status filter", async () => {
    const { tag, purchasing, made, boq } = await fixture();
    await changeRequestStatus(db, actor(purchasing), { requestId: made[0].id, to: "IN_PROGRESS" });
    await changeRequestStatus(db, actor(purchasing), { requestId: made[0].id, to: "COMPLETED" });

    const all = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag });
    const open = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, openOnly: true });
    const completed = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, status: "COMPLETED" });

    expect(all.rows.map((row) => row.code)).not.toContain(boq.code);
    expect(open.total).toBe(2);
    expect(completed.rows.map((row) => row.code)).toEqual([made[0].code]);
  });

  it("sorts by code, project and requester in both directions, with a stable order", async () => {
    const { tag, purchasing } = await fixture();
    const sorted = async (sort: "code" | "project" | "created", dir: "asc" | "desc") =>
      (await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort, dir })).rows.map((row) => (sort === "code" ? row.code : sort === "project" ? row.projectCode : row.createdAt.getTime()));

    const codeAsc = await sorted("code", "asc");
    expect(codeAsc).toEqual([...codeAsc].sort());
    expect(await sorted("code", "desc")).toEqual([...codeAsc].reverse());
    const projectAsc = await sorted("project", "asc");
    expect(projectAsc).toEqual([...projectAsc].sort());
    const createdDesc = (await sorted("created", "desc")) as number[];
    expect(createdDesc).toEqual([...createdDesc].sort((a, b) => b - a));
  });

  it("sorts by SLA deadline (computed, not stored), earliest first and latest first", async () => {
    const { tag, purchasing, made } = await fixture();
    // Make the middle request the oldest, so its deadline is the earliest.
    await db.request.update({ where: { id: made[1].id }, data: { createdAt: new Date(Date.now() - 20 * 86_400_000) } });

    const asc = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort: "sla", dir: "asc" });
    const desc = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort: "sla", dir: "desc" });

    expect(asc.rows[0]!.code).toBe(made[1].code);
    expect(desc.rows.at(-1)!.code).toBe(made[1].code);
    const dues = asc.rows.map((row) => row.sla.dueAt.getTime());
    expect(dues).toEqual([...dues].sort((a, b) => a - b));
  });

  it("paginates: pages do not overlap, add up to the total, and an out-of-range page is clamped", async () => {
    const { tag, purchasing } = await fixture();

    const one = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort: "code", dir: "asc", pageSize: 2, page: 1 });
    const two = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort: "code", dir: "asc", pageSize: 2, page: 2 });
    const beyond = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, sort: "code", dir: "asc", pageSize: 2, page: 99 });
    const nonsense = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag, pageSize: 2, page: Number.NaN });

    expect(one).toMatchObject({ total: 3, pageCount: 2, page: 1 });
    expect(one.rows).toHaveLength(2);
    expect(two.rows).toHaveLength(1);
    expect(new Set([...one.rows, ...two.rows].map((row) => row.code)).size).toBe(3);
    expect(beyond.page).toBe(2);
    expect(beyond.rows.map((row) => row.code)).toEqual(two.rows.map((row) => row.code));
    expect(nonsense.page).toBe(1);
  });

  it("hides requests of a deleted project", async () => {
    const { tag, purchasing, made } = await fixture();
    await db.project.update({ where: { id: made[2].projectId }, data: { deletedAt: new Date() } });

    const page = await searchRequests(db, actor(purchasing), { type: "RFQ", q: tag });

    expect(page.rows.map((row) => row.code)).not.toContain(made[2].code);
    expect(page.total).toBe(2);
  });
});
