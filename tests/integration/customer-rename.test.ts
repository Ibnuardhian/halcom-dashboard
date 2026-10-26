import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { mergeCustomers, renameCustomer } from "@/server/customers/rename";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

async function customerWithProject(sales: { id: string; role: Role }, company: string) {
  const created = await createProject(db, sales, { endUserCompany: company, name: "p" });
  if (!created.ok) throw new Error(created.message);
  const project = await db.project.findUniqueOrThrow({ where: { id: created.value.id }, select: { id: true, customerId: true } });
  return { projectId: project.id, customerId: project.customerId! };
}

describe("renameCustomer", () => {
  it("corrects a name for the customer and its projects, audits it, and is for the superadmin only", async () => {
    const [root, admin, sales] = await Promise.all([actorOf("SUPERADMIN"), actorOf("ADMIN"), actorOf("SALES")]);
    const tag = randomBytes(3).toString("hex");
    const { customerId, projectId } = await customerWithProject(sales, `PT Tpyo ${tag}`);

    for (const actor of [admin, sales]) expect(await renameCustomer(db, actor, { customerId, name: "Nope" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await renameCustomer(db, root, { customerId, name: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const done = await renameCustomer(db, root, { customerId, name: `  PT   Typo ${tag} ` });
    expect(done).toMatchObject({ ok: true, value: { name: `PT Typo ${tag}`, projects: 1 } });
    await expect(db.customer.findUniqueOrThrow({ where: { id: customerId } })).resolves.toMatchObject({ name: `PT Typo ${tag}`, nameKey: `pt typo ${tag}` });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ endUserCompany: `PT Typo ${tag}` });
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "customer.renamed", entityId: customerId } });
    expect(event.before).toMatchObject({ name: `PT Tpyo ${tag}` });
  });

  it("refuses a name another customer has (that is a merge), also in another case", async () => {
    const [root, sales] = await Promise.all([actorOf("SUPERADMIN"), actorOf("SALES")]);
    const tag = randomBytes(3).toString("hex");
    const first = await customerWithProject(sales, `PT Uno ${tag}`);
    await customerWithProject(sales, `PT Dos ${tag}`);
    expect(await renameCustomer(db, root, { customerId: first.customerId, name: `pt dos ${tag.toUpperCase()}` })).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});

describe("mergeCustomers", () => {
  it("moves every project to the other customer, keeps a missing industry, removes the first and audits it", async () => {
    const [root, sales] = await Promise.all([actorOf("SUPERADMIN"), actorOf("SALES")]);
    const tag = randomBytes(3).toString("hex");
    const short = await customerWithProject(sales, `PNP ${tag}`);
    const second = await createProject(db, sales, { endUserCompany: `pnp ${tag}`, name: "again" });
    if (!second.ok) throw new Error(second.message);
    const full = await customerWithProject(sales, `Politeknik Negeri Padang ${tag}`);
    await db.customer.update({ where: { id: short.customerId }, data: { industry: "Education" } });

    expect(await mergeCustomers(db, sales, { sourceId: short.customerId, targetId: full.customerId })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await mergeCustomers(db, root, { sourceId: short.customerId, targetId: short.customerId })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const merged = await mergeCustomers(db, root, { sourceId: short.customerId, targetId: full.customerId });
    expect(merged).toMatchObject({ ok: true, value: { target: `Politeknik Negeri Padang ${tag}`, projects: 2 } });

    await expect(db.customer.findUnique({ where: { id: short.customerId } })).resolves.toBeNull();
    await expect(db.customer.findUniqueOrThrow({ where: { id: full.customerId } })).resolves.toMatchObject({ industry: "Education" });
    const moved = await db.project.findMany({ where: { customerId: full.customerId }, select: { endUserCompany: true } });
    expect(moved).toHaveLength(3);
    expect(new Set(moved.map((row) => row.endUserCompany))).toEqual(new Set([`Politeknik Negeri Padang ${tag}`]));
    await expect(db.auditEvent.count({ where: { action: "customer.merged", entityId: full.customerId } })).resolves.toBe(1);
  });
});
