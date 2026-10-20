import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getTeamDashboard } from "@/server/dashboards/metrics";
import { assignRequestPic, createPic, listAssignablePics, listPicAssignments, listPics, updatePic } from "@/server/pics/service";
import { searchRequests } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const actor = (user: { id: string; role: Parameters<typeof createPic>[1]["role"] }) => ({ id: user.id, role: user.role });

async function setup() {
  const [admin, sales, soa, purchasing] = await Promise.all([makeUser("ADMIN"), makeUser("SALES"), makeUser("SOA"), makeUser("PURCHASING")]);
  const tag = randomBytes(3).toString("hex");
  const created = await createProject(db, actor(sales), { endUserCompany: `Pic ${tag}`, name: "pic project" });
  if (!created.ok) throw new Error(created.message);
  const request = async (type: "BOQ" | "RFQ") => {
    const made = await createRequest(db, actor(sales), { projectId: created.value.id, type, title: `${type} ${tag}` });
    if (!made.ok) throw new Error(made.message);
    return db.request.findUniqueOrThrow({ where: { code: made.value.code } });
  };
  const pic = async (team: "SOA" | "PURCHASING", name: string) => {
    const made = await createPic(db, actor(admin), { team, name: `${name} ${tag}` });
    if (!made.ok) throw new Error(made.message);
    return made.value;
  };
  return { admin, sales, soa, purchasing, tag, project: created.value, request, pic };
}

describe("PIC records", () => {
  it("an administrator adds, renames, deactivates and reactivates them; each change is audited", async () => {
    const { admin, tag } = await setup();

    const created = await createPic(db, actor(admin), { team: "SOA", name: `  Adityo   ${tag} ` });
    expect(created).toMatchObject({ ok: true, value: { name: `Adityo ${tag}` } }); // spacing is tidied
    if (!created.ok) return;
    const { id } = created.value;

    await expect(updatePic(db, actor(admin), { id, name: `Adityo S ${tag}` })).resolves.toMatchObject({ ok: true, value: { name: `Adityo S ${tag}`, isActive: true } });
    await expect(updatePic(db, actor(admin), { id, isActive: false })).resolves.toMatchObject({ ok: true, value: { isActive: false } });
    await expect(updatePic(db, actor(admin), { id, isActive: true })).resolves.toMatchObject({ ok: true, value: { isActive: true } });
    const actions = (await db.auditEvent.findMany({ where: { entityType: "pic", entityId: id }, orderBy: { createdAt: "asc" } })).map((event) => event.action);
    expect(actions).toEqual(["pic.created", "pic.updated", "pic.deactivated", "pic.activated"]);
    const row = (await listPics(db, actor(admin))).find((pic) => pic.id === id);
    expect(row).toMatchObject({ team: "SOA", isActive: true, openRequests: 0 });
  });

  it("does not hold the same name twice in one team (any case or spacing), but two teams may share a name", async () => {
    const { admin, tag } = await setup();
    const first = await createPic(db, actor(admin), { team: "SOA", name: `Ibnu ${tag}` });
    if (!first.ok) throw new Error(first.message);

    await expect(createPic(db, actor(admin), { team: "SOA", name: `  IBNU   ${tag}` })).resolves.toMatchObject({ ok: false, code: "DUPLICATE", existing: { id: first.value.id } });
    await expect(createPic(db, actor(admin), { team: "PURCHASING", name: `Ibnu ${tag}` })).resolves.toMatchObject({ ok: true });
    const other = await createPic(db, actor(admin), { team: "SOA", name: `Other ${tag}` });
    if (!other.ok) throw new Error(other.message);
    await expect(updatePic(db, actor(admin), { id: other.value.id, name: `ibnu ${tag}` })).resolves.toMatchObject({ ok: false, code: "DUPLICATE" });
    // The database also refuses it, whatever code writes the row.
    await expect(db.pic.create({ data: { team: "SOA", name: `Ibnu ${tag}`, nameKey: `ibnu ${tag}` } })).rejects.toThrow();
    await expect(db.pic.create({ data: { team: "SOA", name: "Bad", nameKey: "NOT normalised" } })).rejects.toThrow(/pics_name_key_chk/);
  });

  it("only an administrator manages them; invalid names are refused", async () => {
    const { sales, soa, purchasing, admin } = await setup();
    for (const user of [sales, soa, purchasing]) {
      await expect(createPic(db, actor(user), { team: "SOA", name: "Nope" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(createPic(db, actor(admin), { team: "SOA", name: "   " })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createPic(db, actor(admin), { team: "SOA", name: "x".repeat(81) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createPic(db, actor(admin), { team: "SALES", name: "Nope" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(updatePic(db, actor(soa), { id: "00000000-0000-4000-8000-000000000000", isActive: false })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(updatePic(db, actor(admin), { id: "00000000-0000-4000-8000-000000000000", isActive: false })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(listPics(db, actor(soa))).rejects.toThrow(/Forbidden/);
  });
});

describe("handing a request to a PIC", () => {
  it("SOA hands a BOQ to a SOA PIC and Purchasing hands an RFQ to a Purchasing PIC; every change stays in the history", async () => {
    const { soa, purchasing, request, pic } = await setup();
    const boq = await request("BOQ");
    const rfq = await request("RFQ");
    const adityo = await pic("SOA", "Adityo");
    const ibnu = await pic("SOA", "Ibnu");
    const budi = await pic("PURCHASING", "Budi");

    expect(await listAssignablePics(db, actor(soa), "BOQ")).toEqual(expect.arrayContaining([adityo, ibnu]));
    expect((await listAssignablePics(db, actor(soa), "BOQ")).some((p) => p.id === budi.id)).toBe(false); // the other team's PIC is not offered
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: adityo.id })).resolves.toMatchObject({ ok: true, value: { picId: adityo.id } });
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: ibnu.id })).resolves.toMatchObject({ ok: true });
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: ibnu.id })).resolves.toMatchObject({ ok: true }); // same PIC: no new history
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: "" })).resolves.toMatchObject({ ok: true, value: { picId: null } });
    await expect(assignRequestPic(db, actor(purchasing), { requestId: rfq.id, picId: budi.id })).resolves.toMatchObject({ ok: true });

    const history = await listPicAssignments(db, actor(soa), boq.id);
    expect(history.map((row) => [row.fromName, row.toName])).toEqual([
      [null, adityo.name],
      [adityo.name, ibnu.name],
      [ibnu.name, null],
    ]);
    expect(history.every((row) => row.changedByName === soa.name)).toBe(true);
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ picId: null }); // the login account is not the assignee
    await expect(db.auditEvent.count({ where: { action: "request.pic_assigned", entityId: boq.id } })).resolves.toBe(3);
  });

  it("refuses the wrong team, an inactive or unknown PIC, and people who do not work that type", async () => {
    const { sales, soa, purchasing, request, pic, admin } = await setup();
    const boq = await request("BOQ");
    const adityo = await pic("SOA", "Adityo");
    const budi = await pic("PURCHASING", "Budi");

    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: budi.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" }); // a Purchasing PIC on a BOQ
    await expect(assignRequestPic(db, actor(purchasing), { requestId: boq.id, picId: adityo.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(assignRequestPic(db, actor(sales), { requestId: boq.id, picId: adityo.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: "00000000-0000-4000-8000-000000000000" })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: "nope" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await updatePic(db, actor(admin), { id: adityo.id, isActive: false });
    await expect(assignRequestPic(db, actor(soa), { requestId: boq.id, picId: adityo.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await listAssignablePics(db, actor(soa), "BOQ")).some((p) => p.id === adityo.id)).toBe(false);
    await expect(db.requestPicAssignment.count({ where: { requestId: boq.id } })).resolves.toBe(0);
    await expect(listAssignablePics(db, actor(sales), "BOQ")).rejects.toThrow(/Forbidden/);
  });

  it("deactivating a PIC keeps its requests and its history, and the history cannot be edited or deleted", async () => {
    const { soa, admin, request, pic } = await setup();
    const boq = await request("BOQ");
    const adityo = await pic("SOA", "Adityo");
    await assignRequestPic(db, actor(soa), { requestId: boq.id, picId: adityo.id });

    await updatePic(db, actor(admin), { id: adityo.id, isActive: false });
    await updatePic(db, actor(admin), { id: adityo.id, name: `${adityo.name} Renamed` });

    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ picId: adityo.id });
    expect((await listPicAssignments(db, actor(soa), boq.id)).map((row) => row.toName)).toEqual([`${adityo.name} Renamed`]);
    const row = await db.requestPicAssignment.findFirstOrThrow({ where: { requestId: boq.id } });
    await expect(db.requestPicAssignment.update({ where: { id: row.id }, data: { toPicId: null } })).rejects.toThrow(/append-only/);
    await expect(db.requestPicAssignment.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.pic.delete({ where: { id: adityo.id } })).rejects.toThrow(); // a PIC that has history cannot be deleted either
  });

  it("starting the work no longer turns the shared login account into the assignee", async () => {
    const { soa, request } = await setup();
    const boq = await request("BOQ");

    const moved = await changeRequestStatus(db, actor(soa), { requestId: boq.id, to: "IN_PROGRESS" });

    expect(moved.ok).toBe(true);
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ status: "IN_PROGRESS", picId: null });
  });
});

describe("workload by assignee counts PICs", () => {
  it("lists each PIC with its open requests, the unassigned ones apart, and filters the list by PIC", async () => {
    const { soa, request, pic, admin, sales } = await setup();
    const adityo = await pic("SOA", "Adityo");
    const ibnu = await pic("SOA", "Ibnu");
    const [a, b, c, d] = [await request("BOQ"), await request("BOQ"), await request("BOQ"), await request("BOQ")];
    await assignRequestPic(db, actor(soa), { requestId: a.id, picId: adityo.id });
    await assignRequestPic(db, actor(soa), { requestId: b.id, picId: adityo.id });
    await assignRequestPic(db, actor(soa), { requestId: c.id, picId: ibnu.id });
    await changeRequestStatus(db, actor(soa), { requestId: b.id, to: "CANCELLED", reason: "not needed" }); // closed work is not workload

    const team = await getTeamDashboard(db, actor(soa), "SOA");
    const row = (name: string) => team.metrics.workload.find((entry) => entry.name === name);
    expect(row(adityo.name)).toMatchObject({ assigneeId: adityo.id, open: 1 });
    expect(row(ibnu.name)).toMatchObject({ assigneeId: ibnu.id, open: 1 });
    expect(team.metrics.workload.find((entry) => entry.assigneeId === null)?.open).toBeGreaterThanOrEqual(1); // d, and other tests' requests
    expect(team.metrics.workload.some((entry) => entry.name === soa.name)).toBe(false); // the shared login account is not a row

    await updatePic(db, actor(admin), { id: ibnu.id, isActive: false });
    expect((await getTeamDashboard(db, actor(soa), "SOA")).metrics.workload.some((entry) => entry.name === `${ibnu.name} (inactive)`)).toBe(true);

    const mine = await searchRequests(db, actor(sales), { type: "BOQ", assignee: adityo.id });
    expect(mine.rows.map((r) => r.code).sort()).toEqual([a.code, b.code].sort());
    expect((await searchRequests(db, actor(sales), { type: "BOQ", assignee: adityo.id, q: adityo.name })).rows).toHaveLength(2); // search by the PIC's name
    expect((await searchRequests(db, actor(sales), { type: "BOQ", assignee: "none", q: d.code })).rows.map((r) => r.code)).toEqual([d.code]);
  });
});
