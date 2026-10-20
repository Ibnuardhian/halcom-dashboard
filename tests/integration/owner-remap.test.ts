import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { applyOwnerRemap, planOwnerRemap, type OwnerRemapRules } from "@/server/projects/owner-remap";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

/** A private set of accounts per test, so the shared test database is never touched beyond them. */
async function fixture() {
  const tag = randomBytes(4).toString("hex");
  const email = (label: string) => `${label}-${tag}@example.invalid`;
  const [oldDzaki, soraya, gusti, satrio, hendi, soaOwner, admin] = await Promise.all([
    makeUser("SALES", { email: email("mas.dzaki") }),
    makeUser("SALES", { email: email("soraya") }),
    makeUser("SALES", { email: email("gusti") }),
    makeUser("SALES", { email: email("satrio") }),
    makeUser("SALES", { email: email("hendi") }),
    makeUser("SOA", { email: email("adityo") }),
    makeUser("SUPERADMIN", { email: email("root") }),
  ]);
  const rules: OwnerRemapRules = {
    rename: { fromEmail: oldDzaki.email, toEmail: email("dzaki"), toName: "Dzaki" },
    moves: [
      { fromEmail: soraya.email, toEmail: email("dzaki") },
      { fromEmail: gusti.email, toEmail: satrio.email },
    ],
    keepEmails: [email("dzaki"), satrio.email],
    onlyOwnerEmails: [oldDzaki.email, soraya.email, gusti.email, satrio.email, hendi.email, soaOwner.email, email("dzaki")],
  };
  // Projects are created the normal way (so the code is a real PRJ number); the SOA-owned one is handed over afterwards.
  const make = async (owner: { id: string; role: string }, label: string) => {
    const creator = owner.role === "SALES" ? owner : gusti;
    const created = await createProject(db, { id: creator.id, role: "SALES" }, { endUserCompany: `Customer ${tag} ${label}`, name: `Project ${label}` });
    if (!created.ok) throw new Error(created.message);
    if (owner.role === "SOA") await db.project.update({ where: { id: created.value.id }, data: { salesOwnerId: owner.id } });
    return db.project.findUniqueOrThrow({ where: { id: created.value.id } });
  };
  const projects = {
    dzaki: [await make(oldDzaki, "d1"), await make(oldDzaki, "d2")],
    soraya: [await make(soraya, "s1")],
    gusti: [await make(gusti, "g1"), await make(gusti, "g2")],
    satrio: [await make(satrio, "t1")],
    hendi: [await make(hendi, "h1")],
    soa: [await make(soaOwner, "a1")],
  };
  // A request and a change log row that must survive the move.
  const requested = await createRequest(db, { id: gusti.id, role: "SALES" }, { projectId: projects.gusti[0]!.id, type: "BOQ", title: "BOQ" });
  if (!requested.ok) throw new Error(requested.message);
  const request = await db.request.findUniqueOrThrow({ where: { code: requested.value.code } });
  return { tag, rules, users: { oldDzaki, soraya, gusti, satrio, hendi, soaOwner, admin }, projects, request, email };
}

describe("owner remap (D-031)", () => {
  it("a dry run reports the counts and writes nothing", async () => {
    const f = await fixture();

    const plan = await planOwnerRemap(db, f.rules);

    expect(plan.conflicts).toEqual([]);
    expect(plan.rename.status).toBe("pending");
    expect(plan.moves.map((m) => m.projects)).toEqual([1, 2]);
    expect(plan.toOther.map((o) => [o.ownerEmail, o.projects]).sort()).toEqual(
      [
        [f.users.hendi.email, 1],
        [f.users.soaOwner.email, 1],
      ].sort(),
    );
    expect(plan.after).toMatchObject({ [`Dzaki (${f.email("dzaki")})`]: 3, [`Test SALES (${f.users.satrio.email})`]: 3 });
    const other = "Other (no internal Sales PIC)";
    expect((plan.after[other] ?? 0) - (plan.before[other] ?? 0)).toBe(2); // other tests' Other projects are in both numbers
    expect(plan.warnings.some((w) => w.includes("not a Sales account"))).toBe(true); // the SOA owner is flagged, not guessed
    // Nothing was written.
    await expect(db.user.findUniqueOrThrow({ where: { id: f.users.oldDzaki.id } })).resolves.toMatchObject({ email: f.users.oldDzaki.email, name: "Test SALES" });
    await expect(db.project.count({ where: { id: { in: f.projects.gusti.map((p) => p.id) }, salesOwnerId: f.users.gusti.id } })).resolves.toBe(2);
  });

  it("applies the rename, the moves and Other in order, and keeps history, requests and accounts", async () => {
    const f = await fixture();

    const result = await applyOwnerRemap(db, f.users.admin.id, f.rules);

    expect(result.ok).toBe(true);
    const renamed = await db.user.findUniqueOrThrow({ where: { id: f.users.oldDzaki.id } }); // same account, same id
    expect(renamed).toMatchObject({ name: "Dzaki", email: f.email("dzaki"), role: "SALES", isActive: true });
    const ownerOf = async (id: string) => (await db.project.findUniqueOrThrow({ where: { id } })).salesOwnerId;
    expect(await ownerOf(f.projects.dzaki[0]!.id)).toBe(renamed.id);
    expect(await ownerOf(f.projects.soraya[0]!.id)).toBe(renamed.id); // Soraya -> Dzaki
    expect(await ownerOf(f.projects.gusti[0]!.id)).toBe(f.users.satrio.id); // Gusti -> Satrio
    expect(await ownerOf(f.projects.satrio[0]!.id)).toBe(f.users.satrio.id);
    for (const project of [f.projects.hendi[0]!, f.projects.soa[0]!]) {
      const row = await db.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(row).toMatchObject({ sourceType: "OTHER", salesOwnerId: null });
      expect(row.externalSourceName).toBeTruthy();
      expect(row.sourceNotes).toContain("Previously owned by");
    }
    // The old owners are still accounts; the request and the audit trail are untouched.
    await expect(db.user.count({ where: { id: { in: [f.users.soraya.id, f.users.gusti.id, f.users.hendi.id, f.users.soaOwner.id] } } })).resolves.toBe(4);
    await expect(db.request.findUniqueOrThrow({ where: { id: f.request.id } })).resolves.toMatchObject({ projectId: f.projects.gusti[0]!.id, requesterId: f.users.gusti.id });
    const log = await db.projectChange.findMany({ where: { projectId: f.projects.gusti[0]!.id } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ field: "salesOwner", changedById: f.users.admin.id });
    expect(log[0]!.fromValue).toContain(f.users.gusti.email);
    expect(log[0]!.toValue).toContain(f.users.satrio.email);
    await expect(db.auditEvent.count({ where: { action: "project.owner_remapped", entityId: { in: Object.values(f.projects).flat().map((p) => p.id) } } })).resolves.toBe(5); // the 3 moved + 2 to Other; projects that stay get no record
    await expect(db.auditEvent.count({ where: { action: "user.renamed", entityId: renamed.id } })).resolves.toBe(1);
  });

  it("is safe to run again: nothing more changes", async () => {
    const f = await fixture();
    await applyOwnerRemap(db, f.users.admin.id, f.rules);

    const again = await planOwnerRemap(db, f.rules);

    expect(again.rename.status).toBe("already-done");
    expect(again.totals.moved).toBe(0);
    expect(again.totals.toOther).toBe(0);
    const second = await applyOwnerRemap(db, f.users.admin.id, f.rules);
    expect(second.ok).toBe(true);
    await expect(db.projectChange.count({ where: { projectId: f.projects.gusti[0]!.id } })).resolves.toBe(1); // no duplicate history
  });

  it("rolls everything back when a step fails half way", async () => {
    const f = await fixture();

    await expect(
      applyOwnerRemap(db, f.users.admin.id, f.rules, {
        onStep: (step) => {
          if (step === "moves") throw new Error("simulated failure after the moves");
        },
      }),
    ).rejects.toThrow("simulated failure");

    await expect(db.user.findUniqueOrThrow({ where: { id: f.users.oldDzaki.id } })).resolves.toMatchObject({ email: f.users.oldDzaki.email, name: "Test SALES" });
    await expect(db.project.count({ where: { id: { in: f.projects.gusti.map((p) => p.id) }, salesOwnerId: f.users.gusti.id } })).resolves.toBe(2);
    await expect(db.project.count({ where: { id: f.projects.hendi[0]!.id, sourceType: "INTERNAL_SALES" } })).resolves.toBe(1);
    await expect(db.projectChange.count({ where: { projectId: { in: Object.values(f.projects).flat().map((p) => p.id) } } })).resolves.toBe(0);
    await expect(db.auditEvent.count({ where: { action: { in: ["user.renamed", "project.owner_remapped"] }, entityId: { in: [f.users.oldDzaki.id, ...Object.values(f.projects).flat().map((p) => p.id)] } } })).resolves.toBe(0);
  });

  it("refuses on conflicts: both accounts exist, a missing target, or an inactive target", async () => {
    const f = await fixture();
    await makeUser("SALES", { email: f.email("dzaki") }); // the new address is already another person
    const both = await applyOwnerRemap(db, f.users.admin.id, f.rules);
    expect(both).toMatchObject({ ok: false, code: "CONFLICT" });
    await expect(db.project.count({ where: { id: f.projects.gusti[0]!.id, salesOwnerId: f.users.gusti.id } })).resolves.toBe(1);

    const g = await fixture();
    const missing = await planOwnerRemap(db, { ...g.rules, moves: [{ fromEmail: g.users.gusti.email, toEmail: g.email("nobody") }] });
    expect(missing.conflicts.join(" ")).toContain("does not exist");

    const h = await fixture();
    await db.user.update({ where: { id: h.users.satrio.id }, data: { isActive: false } });
    const inactive = await planOwnerRemap(db, h.rules);
    expect(inactive.conflicts.join(" ")).toContain("active Sales account");
  });

  it("only a superadmin can apply it", async () => {
    const f = await fixture();

    const result = await applyOwnerRemap(db, f.users.satrio.id, f.rules);

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.user.findUniqueOrThrow({ where: { id: f.users.oldDzaki.id } })).resolves.toMatchObject({ email: f.users.oldDzaki.email });
  });
});
