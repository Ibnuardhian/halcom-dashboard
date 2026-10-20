import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createMasterRecord, deleteMasterRecord, listMasterRecords, renameMasterRecord, setProjectMasterData } from "@/server/masterdata/service";
import { updateProjectDetails } from "@/server/projects/service";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const actor = (user: { id: string; role: Parameters<typeof createMasterRecord>[1]["role"] }) => ({ id: user.id, role: user.role });
const unique = (label: string) => `${label} ${randomBytes(4).toString("hex")}`;

async function makeProject(owner: Awaited<ReturnType<typeof makeUser>>) {
  const created = await createProject(db, actor(owner), { endUserCompany: unique("PT"), name: "classified" });
  if (!created.ok) throw new Error(created.message);
  return created.value;
}

describe("Principal and Solution master data", () => {
  it("creates a record with a stable id, lists it, and writes an audit event", async () => {
    const soa = await makeUser("SOA");
    const name = unique("Hewlett");

    const principal = await createMasterRecord(db, actor(soa), { kind: "principal", name });
    const solution = await createMasterRecord(db, actor(soa), { kind: "solution", name });

    expect(principal.ok && solution.ok).toBe(true);
    if (!principal.ok || !solution.ok) return;
    // The same name is a different record in the other list.
    expect(principal.value.id).not.toBe(solution.value.id);
    const listed = await listMasterRecords(db, actor(soa), "principal");
    expect(listed.find((record) => record.id === principal.value.id)).toEqual({ id: principal.value.id, name, projectCount: 0 });
    expect((await listMasterRecords(db, actor(soa), "solution")).map((record) => record.id)).toContain(solution.value.id);
    await expect(db.auditEvent.count({ where: { action: "principal.created", entityId: principal.value.id, actorId: soa.id } })).resolves.toBe(1);
  });

  it("refuses a duplicate name however it is cased or spaced, and hands back the existing record to reuse", async () => {
    const soa = await makeUser("SOA");
    const name = unique("Dell Technologies");
    const first = await createMasterRecord(db, actor(soa), { kind: "principal", name });
    if (!first.ok) throw new Error(first.message);

    const again = await createMasterRecord(db, actor(soa), { kind: "principal", name: `  ${name.toUpperCase().replace(" ", "   ")}  ` });

    expect(again).toMatchObject({ ok: false, code: "DUPLICATE", existing: { id: first.value.id, name } });
    const matches = (await listMasterRecords(db, actor(soa), "principal")).filter((record) => record.name.toLowerCase() === name.toLowerCase());
    expect(matches).toHaveLength(1);
  });

  it("creates one record when the same name is submitted many times at once", async () => {
    const soa = await makeUser("SOA");
    const name = unique("Concurrent");

    const results = await Promise.all(Array.from({ length: 6 }, () => createMasterRecord(db, actor(soa), { kind: "solution", name })));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const winner = results.find((result) => result.ok);
    for (const result of results) {
      if (!result.ok) expect(result).toMatchObject({ code: "DUPLICATE", existing: { id: winner && winner.ok ? winner.value.id : "" } });
    }
    const rows = await db.solutionCategory.findMany({ where: { name } });
    expect(rows).toHaveLength(1);
  });

  it("rejects an empty name, an over-long name, control characters, an unknown kind and extra keys", async () => {
    const soa = await makeUser("SOA");

    for (const input of [
      { kind: "principal", name: "   " },
      { kind: "principal", name: "x".repeat(121) },
      { kind: "principal", name: "bad\u0000name" },
      { kind: "customer", name: "Nope" },
      { kind: "principal", name: "Extra", id: "x" },
    ]) {
      await expect(createMasterRecord(db, actor(soa), input)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("lets SOA, admin and superadmin manage the lists and refuses every other role", async () => {
    for (const role of ["SOA", "ADMIN", "SUPERADMIN"] as const) {
      const user = await makeUser(role);
      await expect(createMasterRecord(db, actor(user), { kind: "principal", name: unique(role) })).resolves.toMatchObject({ ok: true });
    }
    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const user = await makeUser(role);
      const name = unique(role);
      await expect(createMasterRecord(db, actor(user), { kind: "principal", name })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
      await expect(db.principal.count({ where: { name } })).resolves.toBe(0);
    }
  });

  it("re-checks the stored account, so a deactivated user or a role that was changed since sign-in is refused", async () => {
    const inactive = await makeUser("SOA", { isActive: false });
    const demoted = await makeUser("SALES");

    await expect(createMasterRecord(db, actor(inactive), { kind: "principal", name: unique("Inactive") })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // The caller claims to be SOA; the stored role (Sales) decides.
    await expect(createMasterRecord(db, { id: demoted.id, role: "SOA" }, { kind: "principal", name: unique("Claimed") })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("renames a record in place: the id and every project that uses it stay, a taken name is refused", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await makeProject(sales);
    const principal = await createMasterRecord(db, actor(soa), { kind: "principal", name: unique("Old name") });
    const other = await createMasterRecord(db, actor(soa), { kind: "principal", name: unique("Taken") });
    if (!principal.ok || !other.ok) throw new Error("setup");
    await setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: principal.value.id });
    const newName = unique("New name");

    const renamed = await renameMasterRecord(db, actor(soa), { kind: "principal", id: principal.value.id, name: newName });
    const clash = await renameMasterRecord(db, actor(soa), { kind: "principal", id: principal.value.id, name: other.value.name.toUpperCase() });

    expect(renamed).toEqual({ ok: true, value: { id: principal.value.id, name: newName } });
    expect(clash).toMatchObject({ ok: false, code: "DUPLICATE", existing: { id: other.value.id } });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ principalId: principal.value.id });
    await expect(db.auditEvent.count({ where: { action: "principal.renamed", entityId: principal.value.id } })).resolves.toBe(1);
  });

  it("deletes an unused record and refuses one a project uses", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await makeProject(sales);
    const used = await createMasterRecord(db, actor(soa), { kind: "solution", name: unique("Used") });
    const unused = await createMasterRecord(db, actor(soa), { kind: "solution", name: unique("Unused") });
    if (!used.ok || !unused.ok) throw new Error("setup");
    await setProjectMasterData(db, actor(soa), { projectId: project.id, solutionId: used.value.id });

    await expect(deleteMasterRecord(db, actor(soa), { kind: "solution", id: used.value.id })).resolves.toMatchObject({ ok: false, code: "IN_USE" });
    await expect(deleteMasterRecord(db, actor(sales), { kind: "solution", id: unused.value.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(deleteMasterRecord(db, actor(soa), { kind: "solution", id: unused.value.id })).resolves.toEqual({ ok: true, value: { id: unused.value.id } });
    await expect(db.solutionCategory.count({ where: { id: unused.value.id } })).resolves.toBe(0);
    await expect(db.solutionCategory.count({ where: { id: used.value.id } })).resolves.toBe(1);
    await expect(deleteMasterRecord(db, actor(soa), { kind: "solution", id: unused.value.id })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("setProjectMasterData", () => {
  it("sets, changes and clears the Principal and Solution of a project, logging each change and leaving the rest alone", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await makeProject(sales);
    const first = await createMasterRecord(db, actor(soa), { kind: "principal", name: unique("First") });
    const second = await createMasterRecord(db, actor(soa), { kind: "principal", name: unique("Second") });
    const solution = await createMasterRecord(db, actor(soa), { kind: "solution", name: unique("Solution") });
    if (!first.ok || !second.ok || !solution.ok) throw new Error("setup");
    const before = await db.project.findUniqueOrThrow({ where: { id: project.id } });

    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: first.value.id, solutionId: solution.value.id })).resolves.toEqual({ ok: true, value: { changed: ["principal", "solution"] } });
    // Only the field that is sent changes.
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: second.value.id })).resolves.toEqual({ ok: true, value: { changed: ["principal"] } });
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: second.value.id })).resolves.toEqual({ ok: true, value: { changed: [] } });
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, solutionId: "" })).resolves.toEqual({ ok: true, value: { changed: ["solution"] } });

    const after = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after).toMatchObject({ principalId: second.value.id, solutionCategoryId: null, name: before.name, salesOwnerId: sales.id });
    const log = await db.projectChange.findMany({ where: { projectId: project.id, field: { in: ["principal", "solution"] } }, orderBy: { changedAt: "asc" } });
    expect(log.map((row) => [row.field, row.fromValue, row.toValue])).toEqual(
      expect.arrayContaining([
        ["principal", null, first.value.name],
        ["principal", first.value.name, second.value.name],
        ["solution", solution.value.name, null],
      ]),
    );
  });

  it("refuses roles that may not edit technical details, an unknown record and a deleted project", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await makeProject(sales);
    const principal = await createMasterRecord(db, actor(soa), { kind: "principal", name: unique("Allowed") });
    if (!principal.ok) throw new Error("setup");

    await expect(setProjectMasterData(db, actor(sales), { projectId: project.id, principalId: principal.value.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: "00000000-0000-4000-8000-000000000000" })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(setProjectMasterData(db, actor(soa), { projectId: "00000000-0000-4000-8000-000000000000", principalId: principal.value.id })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ principalId: null });
  });
});

describe("removing a technical section", () => {
  it("clears only that section, keeps the other sections and the change log, and removing an empty section changes nothing", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await makeProject(sales);
    await updateProjectDetails(db, actor(soa), { projectId: project.id, values: { requirement: "Need 2 racks", technicalNotes: "Keep me", technicalBlocker: "Waiting on site" } });

    const removed = await updateProjectDetails(db, actor(soa), { projectId: project.id, values: { technicalNotes: "" } });
    const again = await updateProjectDetails(db, actor(soa), { projectId: project.id, values: { technicalNotes: "" } });

    expect(removed.ok).toBe(true);
    expect(again.ok).toBe(true);
    const after = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after).toMatchObject({ requirement: "Need 2 racks", technicalBlocker: "Waiting on site", technicalNotes: null });
    // The change log keeps what the section said and who removed it; the second removal added nothing.
    const log = await db.projectChange.findMany({ where: { projectId: project.id, field: "technicalNotes" }, orderBy: { changedAt: "asc" } });
    expect(log.map((row) => [row.fromValue, row.toValue, row.changedById])).toEqual([
      [null, "Keep me", soa.id],
      ["Keep me", null, soa.id],
    ]);
  });

  it("is refused for a role that may not edit technical details, and the section stays", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await makeProject(sales);
    await updateProjectDetails(db, actor(soa), { projectId: project.id, values: { requirement: "Stays" } });

    const result = await updateProjectDetails(db, actor(sales), { projectId: project.id, values: { requirement: "" } });

    expect(result.ok).toBe(false);
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ requirement: "Stays" });
  });
});
