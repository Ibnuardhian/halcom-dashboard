import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createSession } from "@/server/auth/session-store";
import { applyDevCleanup, planDevCleanup, type CleanupOptions } from "@/server/devdata/cleanup";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser, uniqueEmail } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

// A day long past, so the fixtures of other tests (created "now") are never inside the window.
const DAY = "2020-03-05";
const CREATED = new Date("2020-03-05T10:00:00.000Z");

const letters = () => Array.from(randomBytes(4), (byte) => String.fromCharCode(65 + (byte % 26))).join("");

async function fixture() {
  const [sales, superadmin] = await Promise.all([makeUser("SALES"), makeUser("SUPERADMIN")]);
  const tag = randomBytes(3).toString("hex");
  const actor = { id: sales.id, role: sales.role };

  /** A project made through the form, then dated to the test day. */
  const project = async (customer: string, extra: { submissionKey?: string | null; importedFrom?: string | null; createdAt?: Date } = {}) => {
    const made = await createProject(db, actor, { endUserCompany: customer, name: `cleanup ${tag}`, submissionKey: `cleanup-${tag}-${letters()}` });
    if (!made.ok) throw new Error(made.message);
    await db.project.update({
      where: { id: made.value.id },
      data: { createdAt: extra.createdAt ?? CREATED, ...(extra.submissionKey === null ? { submissionKey: null } : {}), ...(extra.importedFrom ? { importedFrom: extra.importedFrom } : {}) },
    });
    return made.value;
  };
  const request = async (projectId: string) => {
    const made = await createRequest(db, actor, { projectId, type: "BOQ", title: `BOQ ${tag}` });
    if (!made.ok) throw new Error(made.message);
    await db.request.update({ where: { code: made.value.code }, data: { createdAt: CREATED } });
    return made.value;
  };
  const options = (obsoleteEmails: string[] = []): CleanupOptions => ({ date: DAY, timeZone: "UTC", obsoleteEmails });
  return { sales, superadmin, tag, project, request, options };
}

describe("test projects", () => {
  it("confirms only a placeholder-named form project of the day, and reports everything else it looked at", async () => {
    const f = await fixture();
    const test = await f.project(`PT ${letters()}`);
    const imported = await f.project(`PT ${letters()}`, { importedFrom: "export.csv" });
    const realName = await f.project(`Acme Industries ${f.tag}`);
    const noKey = await f.project(`PT ${letters()}`, { submissionKey: null });
    const otherDay = await f.project(`PT ${letters()}`, { createdAt: new Date("2020-03-06T10:00:00.000Z") });

    const plan = await planDevCleanup(db, f.options());

    expect(plan.testProjects.map((p) => p.code)).toContain(test.code);
    for (const kept of [imported, realName, noKey, otherDay]) expect(plan.testProjects.map((p) => p.code), kept.code).not.toContain(kept.code);
    const reasons = Object.fromEntries(plan.untouched.map((record) => [record.code, record.reason]));
    expect(reasons[imported.code]).toMatch(/imported from export\.csv/);
    expect(reasons[realName.code]).toMatch(/not a placeholder/);
    expect(reasons[noKey.code]).toMatch(/project form/);
    expect(plan.lookalikes.map((record) => record.code)).toContain(otherDay.code);
    // A dry run writes nothing.
    expect((await db.project.findUniqueOrThrow({ where: { id: test.id } })).deletedAt).toBeNull();
  });

  it("reads the day in the given time zone", async () => {
    const f = await fixture();
    const project = await f.project(`PT ${letters()}`, { createdAt: new Date("2020-03-04T20:00:00.000Z") }); // 03:00 on 5 March in Jakarta

    const utc = await planDevCleanup(db, f.options());
    const jakarta = await planDevCleanup(db, { ...f.options(), timeZone: "Asia/Jakarta" });

    expect(utc.testProjects.map((p) => p.code)).not.toContain(project.code);
    expect(jakarta.testProjects.map((p) => p.code)).toContain(project.code);
    expect(jakarta.window.start.toISOString()).toBe("2020-03-04T17:00:00.000Z");
  });

  it("deletes a test project the way the application does: hidden, with its requests, history and audit trail kept", async () => {
    const f = await fixture();
    const project = await f.project(`PT ${letters()}`);
    const request = await f.request(project.id);
    const requestRow = await db.request.findUniqueOrThrow({ where: { code: request.code } });
    const href = `/request/${request.code}`;
    const other = await makeUser("SOA");
    await db.notification.create({ data: { recipientId: other.id, kind: "request.created", title: "t", href } });
    const historyBefore = await db.requestStatusHistory.count({ where: { requestId: requestRow.id } });
    const keep = await f.project(`Keep ${f.tag}`);

    const plan = await planDevCleanup(db, f.options());
    const mine = plan.testProjects.find((p) => p.code === project.code)!;
    expect(mine.requests.map((r) => r.code)).toEqual([request.code]);
    // Raising the request already told the SOA users, and one more was added above; all of them point at the hidden request.
    expect(mine.notificationIds.length).toBeGreaterThanOrEqual(1);
    const summary = await applyDevCleanup(db, plan, f.options(), f.superadmin.email);

    expect(summary.projectsDeleted).toBeGreaterThanOrEqual(1);
    expect(await db.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ deletedById: f.superadmin.id });
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).not.toBeNull();
    // Nothing is hard-deleted: the request, its history and the audit events are all still there.
    expect(await db.request.count({ where: { id: requestRow.id } })).toBe(1);
    expect(await db.requestStatusHistory.count({ where: { requestId: requestRow.id } })).toBe(historyBefore);
    expect(await db.auditEvent.count({ where: { entityType: "project", entityId: project.id, action: "project.created" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityType: "project", entityId: project.id, action: "project.deleted", actorId: f.superadmin.id } })).toBe(1);
    // The notification that led to the hidden request is gone; unrelated projects are untouched.
    expect(await db.notification.count({ where: { href } })).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: keep.id } })).deletedAt).toBeNull();
  });

  it("rolls everything back when a step fails", async () => {
    const f = await fixture();
    const project = await f.project(`PT ${letters()}`);
    const gone = uniqueEmail("gone");
    const user = await makeUser("SALES", { email: gone });
    const options = f.options([gone]);
    const plan = await planDevCleanup(db, options);
    expect(plan.accounts[0]?.action).toBe("delete");

    await expect(
      applyDevCleanup(db, plan, options, f.superadmin.email, {
        onStep: (step) => {
          if (step === "accounts") throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");

    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).toBeNull();
    expect(await db.user.count({ where: { id: user.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityType: "project", entityId: project.id, action: "project.deleted" } })).toBe(0);
  });

  it("refuses to apply a plan whose data moved since the dry run", async () => {
    const f = await fixture();
    const project = await f.project(`PT ${letters()}`);
    const plan = await planDevCleanup(db, f.options());
    await f.request(project.id); // a request appears after the review

    await expect(applyDevCleanup(db, plan, f.options(), f.superadmin.email)).rejects.toThrow(/changed since the dry run/);

    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).deletedAt).toBeNull();
  });

  it("only writes as an active superadmin", async () => {
    const f = await fixture();
    await f.project(`PT ${letters()}`);
    const plan = await planDevCleanup(db, f.options());

    await expect(applyDevCleanup(db, plan, f.options(), f.sales.email)).rejects.toThrow(/not an active superadmin/);
  });
});

describe("obsolete accounts", () => {
  it("deletes an unreferenced account, deactivates one that history refers to, and keeps the rest", async () => {
    const f = await fixture();
    const unused = await makeUser("SALES", { email: uniqueEmail("unused") });
    const referenced = await makeUser("SALES", { email: uniqueEmail("referenced") });
    await db.auditEvent.create({ data: { actorId: referenced.id, action: "test.cleanup", entityType: "user", entityId: referenced.id } });
    await createSession(db, referenced.id);
    const admin = await makeUser("ADMIN", { email: uniqueEmail("adm") });
    const signedIn = await makeUser("SALES", { email: uniqueEmail("signedin") });
    const outsider = await makeUser("SALES", { email: `${randomBytes(4).toString("hex")}@company.test` });
    await createSession(db, signedIn.id);

    const emails = [unused.email, referenced.email, admin.email, signedIn.email, outsider.email, "nobody-here@example.invalid"];
    const options = f.options(emails);
    const plan = await planDevCleanup(db, options);
    const action = Object.fromEntries(plan.accounts.map((account) => [account.email, account.action]));

    expect(action).toEqual({
      [unused.email]: "delete",
      // History refers to it and it has a live session, so it is not confirmed unused.
      [referenced.email]: "keep",
      [admin.email]: "keep",
      [signedIn.email]: "keep",
      [outsider.email]: "keep",
      "nobody-here@example.invalid": "missing",
    });
  });

  it("removes what the plan says: delete, or deactivate and sign out", async () => {
    const f = await fixture();
    const unused = await makeUser("SALES", { email: uniqueEmail("unused") });
    const referenced = await makeUser("SALES", { email: uniqueEmail("referenced") });
    await db.auditEvent.create({ data: { actorId: referenced.id, action: "test.cleanup", entityType: "user", entityId: referenced.id } });
    // An expired session is not use.
    await db.session.create({ data: { tokenHash: randomBytes(16).toString("hex"), userId: referenced.id, createdAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1000) } });
    const options = f.options([unused.email, referenced.email]);

    const plan = await planDevCleanup(db, options);
    expect(Object.fromEntries(plan.accounts.map((a) => [a.email, a.action]))).toEqual({ [unused.email]: "delete", [referenced.email]: "deactivate" });
    const summary = await applyDevCleanup(db, plan, options, f.superadmin.email);

    expect(summary.accountsDeleted).toEqual([unused.email]);
    expect(summary.accountsDeactivated).toEqual([referenced.email]);
    expect(await db.user.count({ where: { id: unused.id } })).toBe(0);
    expect(await db.user.findUniqueOrThrow({ where: { id: referenced.id } })).toMatchObject({ isActive: false });
    expect(await db.session.count({ where: { userId: referenced.id } })).toBe(0);
    // The audit trail still resolves to the deactivated account, and the removal itself is recorded.
    expect(await db.auditEvent.count({ where: { actorId: referenced.id, action: "test.cleanup" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: unused.id, action: "user.removed", actorId: f.superadmin.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: referenced.id, action: "user.deactivated", actorId: f.superadmin.id } })).toBe(1);

    // Running it again changes nothing more.
    const again = await planDevCleanup(db, options);
    expect(Object.fromEntries(again.accounts.map((a) => [a.email, a.action]))).toEqual({ [unused.email]: "missing", [referenced.email]: "keep" });
  });
});
