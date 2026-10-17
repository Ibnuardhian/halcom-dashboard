import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { summariseActions } from "@/domain/projects/actions";
import { getDb } from "@/lib/db";
import { listProjectActions, listProjectChanges } from "@/server/projects/queries";
import { postProjectUpdate, updateProjectDetails } from "@/server/projects/service";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role, name: user.name };
}

async function makeProject() {
  const sales = await actorOf("SALES");
  const result = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "CCTV AI" });
  if (!result.ok) throw new Error(result.message);
  await db.project.update({
    where: { id: result.value.id },
    data: { estimatedValue: 1_000_000, probability: 40, progress: "PROPOSE", sizingStatus: "Waiting for the sizing form" },
  });
  return { ...result.value, sales };
}

const changesOf = (projectId: string) => db.projectChange.findMany({ where: { projectId }, orderBy: [{ changedAt: "asc" }, { field: "asc" }] });

describe("updateProjectDetails (technical fields)", () => {
  it("lets SOA change a technical field and writes a log row and an audit event", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    const result = await updateProjectDetails(db, soa, { projectId: project.id, values: { sizingStatus: "  Sized for 400 users  " } });

    expect(result).toEqual({ ok: true, changed: ["sizingStatus"] });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ sizingStatus: "Sized for 400 users" });
    const log = await changesOf(project.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ changedById: soa.id, field: "sizingStatus", fromValue: "Waiting for the sizing form", toValue: "Sized for 400 users" });
    const audit = await db.auditEvent.findMany({ where: { entityType: "project", entityId: project.id, action: "project.details_updated" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: soa.id,
      before: { sizingStatus: "Waiting for the sizing form" },
      after: { sizingStatus: "Sized for 400 users" },
    });
  });

  it("logs one row per changed field, skips unchanged fields, and shows the log newest first with the author", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    await updateProjectDetails(db, soa, { projectId: project.id, values: { technicalNotes: "Sized for 400 users", boqStatus: "In progress" } });
    const second = await updateProjectDetails(db, soa, {
      projectId: project.id,
      values: { technicalNotes: "Sized for 400 users", boqStatus: "Done", sizingStatus: "Waiting for the sizing form" },
    });

    expect(second).toEqual({ ok: true, changed: ["boqStatus"] }); // the other two submitted the values they already had
    expect(await changesOf(project.id)).toHaveLength(3);
    const viewer = await actorOf("FINANCE");
    const rows = await listProjectChanges(db, viewer, project.id);
    expect(rows.map((row) => [row.field, row.fromValue, row.toValue])[0]).toEqual(["boqStatus", "In progress", "Done"]);
    expect(rows[0]!.changedByName).toBe(soa.name);
  });

  it("writes nothing when nothing changes, and treats whitespace as empty", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    expect(await updateProjectDetails(db, soa, { projectId: project.id, values: { sizingStatus: "Waiting for the sizing form", requirement: "   " } })).toEqual({
      ok: true,
      changed: [],
    });
    expect(await updateProjectDetails(db, soa, { projectId: project.id, values: {} })).toEqual({ ok: true, changed: [] });
    expect(await changesOf(project.id)).toHaveLength(0);
    await expect(db.auditEvent.count({ where: { entityId: project.id, action: "project.details_updated" } })).resolves.toBe(0);
  });

  it("logs clearing a field as a change to empty", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    await updateProjectDetails(db, soa, { projectId: project.id, values: { sizingStatus: "" } });

    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ sizingStatus: null });
    expect((await changesOf(project.id))[0]).toMatchObject({ fromValue: "Waiting for the sizing form", toValue: null });
  });

  it("is limited to SOA, admin and superadmin, and to active users", async () => {
    const project = await makeProject();
    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await updateProjectDetails(db, await actorOf(role), { projectId: project.id, values: { technicalNotes: "x" } }), role).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    }
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      expect((await updateProjectDetails(db, await actorOf(role), { projectId: project.id, values: { technicalNotes: `by ${role}` } })).ok, role).toBe(true);
    }
    const gone = await makeUser("SOA", { isActive: false });
    expect(await updateProjectDetails(db, { id: gone.id, role: "SOA" }, { projectId: project.id, values: { technicalNotes: "y" } })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    // A session that still claims SOA after the user was demoted cannot act: the stored role decides.
    const demoted = await makeUser("SALES");
    expect(await updateProjectDetails(db, { id: demoted.id, role: "SOA" }, { projectId: project.id, values: { technicalNotes: "z" } })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect((await changesOf(project.id)).map((c) => c.toValue)).toEqual(["by ADMIN", "by SUPERADMIN"]);
  });

  it("cannot change any commercial, ownership or feed field, even by crafting the request", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");
    const other = await actorOf("SALES");
    const before = await db.project.findUniqueOrThrow({ where: { id: project.id } });

    for (const [key, value] of Object.entries({
      estimatedValue: "999",
      probability: "99",
      finalValue: "5",
      progress: "CLOSED_WON",
      trackStatus: "DONE",
      stage: "WON",
      status: "WON",
      salesOwnerId: other.id,
      technicalPicId: other.id,
      wonDate: "2026-01-01",
      competitor: "x",
      code: "PRJ-999",
      nextAction: "sneaky",
      currentAction: "sneaky",
    })) {
      const result = await updateProjectDetails(db, soa, { projectId: project.id, values: { technicalNotes: "sneaky", [key]: value } });
      expect(result, key).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }

    const after = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(after).toEqual(before); // not even the permitted field in the same request was applied
    expect(await changesOf(project.id)).toHaveLength(0);
  });

  it("does not touch the commercial fields when it saves technical ones", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    await updateProjectDetails(db, soa, { projectId: project.id, values: { technicalNotes: "n" } });

    const after = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(Number(after.estimatedValue)).toBe(1_000_000);
    expect(after).toMatchObject({ probability: 40, progress: "PROPOSE", trackStatus: "ON_TRACK", salesOwnerId: project.sales.id });
  });

  it("rejects an over-long text, a bad project id and an unknown project", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    expect(await updateProjectDetails(db, soa, { projectId: project.id, values: { technicalNotes: "x".repeat(4001) } })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await updateProjectDetails(db, soa, { projectId: "nope", values: { technicalNotes: "x" } })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await updateProjectDetails(db, soa, { projectId: crypto.randomUUID(), values: { technicalNotes: "x" } })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await updateProjectDetails(db, soa, { projectId: project.id, values: { technicalNotes: "x".repeat(4000) } })).ok).toBe(true);
  });

  it("keeps the log consistent when two people save at the same time", async () => {
    const project = await makeProject();
    const a = await actorOf("SOA");
    const b = await actorOf("SOA");

    const results = await Promise.all([
      updateProjectDetails(db, a, { projectId: project.id, values: { sizingStatus: "From A" } }),
      updateProjectDetails(db, b, { projectId: project.id, values: { sizingStatus: "From B" } }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const log = await changesOf(project.id);
    expect(log).toHaveLength(2);
    // Whoever went second replaced the first one's value, so the log reads as one unbroken chain.
    const first = log.find((row) => row.fromValue === "Waiting for the sizing form");
    const second = log.find((row) => row !== first);
    expect(first).toBeDefined();
    expect(second!.fromValue).toBe(first!.toValue);
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ sizingStatus: second!.toValue });
  });
});

describe("postProjectUpdate (current and next action feed)", () => {
  it("lets SOA add a current action: an entry with author and time, the project's latest text, and an audit event", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");
    const before = new Date();

    const result = await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "  Compiled the BOQ with Dell prices  " });

    expect(result.ok).toBe(true);
    const entries = await db.projectAction.findMany({ where: { projectId: project.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "CURRENT", body: "Compiled the BOQ with Dell prices", authorId: soa.id });
    expect(entries[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
      currentAction: "Compiled the BOQ with Dell prices",
      nextAction: null,
    });
    const audit = await db.auditEvent.findMany({ where: { entityType: "project", entityId: project.id, action: "project.action_posted" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: soa.id, after: { kind: "CURRENT", body: "Compiled the BOQ with Dell prices" } });
  });

  it("keeps current and next apart, and the feed reads newest first with the last two current actions", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");
    for (const [kind, body] of [
      ["CURRENT", "Held the kickoff"],
      ["NEXT", "Send the BOQ"],
      ["CURRENT", "Sent the BOQ to Dell"],
      ["CURRENT", "Received the price"],
      ["NEXT", "Compile the final offer"],
    ] as const) {
      expect((await postProjectUpdate(db, soa, { projectId: project.id, kind, body })).ok).toBe(true);
    }

    const feed = await listProjectActions(db, await actorOf("FINANCE"), project.id);

    expect(feed.map((e) => e.body)).toEqual(["Compile the final offer", "Received the price", "Sent the BOQ to Dell", "Send the BOQ", "Held the kickoff"]);
    expect(feed[0]!.authorName).toBe(soa.name);
    const { current, next } = summariseActions(feed);
    expect(current.map((e) => e.body)).toEqual(["Received the price", "Sent the BOQ to Dell"]);
    expect(next?.body).toBe("Compile the final offer");
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({
      currentAction: "Received the price",
      nextAction: "Compile the final offer",
    });
  });

  it("shows an imported entry (no author) with the feed", async () => {
    const project = await makeProject();
    await db.projectAction.create({ data: { projectId: project.id, kind: "NEXT", body: "From the export" } });

    const feed = await listProjectActions(db, await actorOf("SALES"), project.id);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ body: "From the export", authorName: null });
  });

  it("rejects blank text, over-long text and an unknown kind, and changes nothing", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    expect(await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "x".repeat(4001) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await postProjectUpdate(db, soa, { projectId: project.id, kind: "LATER", body: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await postProjectUpdate(db, soa, { projectId: "nope", kind: "NEXT", body: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await postProjectUpdate(db, soa, { projectId: crypto.randomUUID(), kind: "NEXT", body: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(db.projectAction.count({ where: { projectId: project.id } })).resolves.toBe(0);
    expect((await postProjectUpdate(db, soa, { projectId: project.id, kind: "NEXT", body: "x".repeat(4000) })).ok).toBe(true);
  });

  it("is limited to SOA, admin and superadmin, and to active users (the stored role decides)", async () => {
    const project = await makeProject();
    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await postProjectUpdate(db, await actorOf(role), { projectId: project.id, kind: "NEXT", body: "x" }), role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      expect((await postProjectUpdate(db, await actorOf(role), { projectId: project.id, kind: "NEXT", body: `by ${role}` })).ok, role).toBe(true);
    }
    const gone = await makeUser("SOA", { isActive: false });
    expect(await postProjectUpdate(db, { id: gone.id, role: "SOA" }, { projectId: project.id, kind: "NEXT", body: "y" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const demoted = await makeUser("SALES");
    expect(await postProjectUpdate(db, { id: demoted.id, role: "SOA" }, { projectId: project.id, kind: "NEXT", body: "z" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const stored = await db.projectAction.findMany({ where: { projectId: project.id } });
    expect(stored.map((e) => e.body).sort()).toEqual(["by ADMIN", "by SUPERADMIN"]);
  });

  it("cannot be used to change a commercial field", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");

    await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "Done", estimatedValue: "1", stage: "WON" });

    const after = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(Number(after.estimatedValue)).toBe(1_000_000);
    expect(after).toMatchObject({ progress: "PROPOSE", probability: 40, salesOwnerId: project.sales.id });
  });

  it("keeps the project's latest text equal to the newest entry when two people post at the same time", async () => {
    const project = await makeProject();
    const a = await actorOf("SOA");
    const b = await actorOf("SOA");

    const results = await Promise.all([
      postProjectUpdate(db, a, { projectId: project.id, kind: "NEXT", body: "Next from A" }),
      postProjectUpdate(db, b, { projectId: project.id, kind: "NEXT", body: "Next from B" }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const feed = await listProjectActions(db, a, project.id);
    expect(feed).toHaveLength(2);
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ nextAction: feed[0]!.body });
  });

  it("is append-only and refuses a blank entry", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");
    await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "Logged" });
    const row = (await db.projectAction.findMany({ where: { projectId: project.id } }))[0]!;

    await expect(db.projectAction.update({ where: { id: row.id }, data: { body: "edited" } })).rejects.toThrow(/append-only/);
    await expect(db.projectAction.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "project_actions"`)).rejects.toThrow(/append-only/);
    await expect(db.projectAction.create({ data: { projectId: project.id, kind: "CURRENT", body: "  " } })).rejects.toThrow(/project_actions_body_not_blank_chk/);
  });
});

describe("project change log rules", () => {
  it("is append-only and refuses an entry that changes nothing", async () => {
    const project = await makeProject();
    const soa = await actorOf("SOA");
    await updateProjectDetails(db, soa, { projectId: project.id, values: { technicalNotes: "Logged" } });
    const row = (await changesOf(project.id))[0]!;

    await expect(db.projectChange.update({ where: { id: row.id }, data: { toValue: "edited" } })).rejects.toThrow(/append-only/);
    await expect(db.projectChange.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "project_changes"`)).rejects.toThrow(/append-only/);
    await expect(
      db.projectChange.create({ data: { projectId: project.id, changedById: soa.id, field: "technicalNotes", fromValue: "same", toValue: "same" } }),
    ).rejects.toThrow(/project_changes_value_differs_chk/);
    await expect(
      db.projectChange.create({ data: { projectId: project.id, changedById: soa.id, field: " ", fromValue: "a", toValue: "b" } }),
    ).rejects.toThrow(/project_changes_field_not_blank_chk/);
  });
});
