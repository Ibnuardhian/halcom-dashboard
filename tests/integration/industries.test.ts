import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { createIndustry, deleteIndustry, listIndustries, renameIndustry } from "@/server/customers/industries";
import { setCustomerIndustry } from "@/server/customers/service";
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

describe("editing the list of industries", () => {
  it("lets Admin and Superadmin add one, refuses the other roles, a repeat (ignoring case and spacing) and an empty name", async () => {
    const [admin, root, sales, soa] = await Promise.all([actorOf("ADMIN"), actorOf("SUPERADMIN"), actorOf("SALES"), actorOf("SOA")]);
    const name = `Maritime ${randomBytes(3).toString("hex")}`;

    expect((await createIndustry(db, admin, { name: `  ${name}  ` })).ok).toBe(true);
    expect(await createIndustry(db, root, { name: name.toUpperCase() })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await createIndustry(db, root, { name: "   " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    for (const actor of [sales, soa]) expect(await createIndustry(db, actor, { name: "Nope" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await listIndustries(db, sales)).map((row) => row.name)).toContain(name);
    await expect(db.auditEvent.count({ where: { action: "industry.created", actorId: admin.id } })).resolves.toBeGreaterThan(0);
  });

  it("renames an industry and the customers on it follow; a name that exists is refused", async () => {
    const [admin, sales] = await Promise.all([actorOf("ADMIN"), actorOf("SALES")]);
    const tag = randomBytes(3).toString("hex");
    const created = await createIndustry(db, admin, { name: `Aviation ${tag}` });
    if (!created.ok) throw new Error(created.message);
    const project = await createProject(db, sales, { endUserCompany: `PT Avi ${tag}`, name: "avi" });
    if (!project.ok) throw new Error(project.message);
    const { customerId } = await db.project.findUniqueOrThrow({ where: { id: project.value.id }, select: { customerId: true } }).then((row) => ({ customerId: row.customerId! }));
    expect(await setCustomerIndustry(db, sales, { customerId, industry: `Aviation ${tag}` })).toMatchObject({ ok: true });

    expect(await renameIndustry(db, admin, { id: created.value.id, name: "Manufacturing" })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await renameIndustry(db, admin, { id: created.value.id, name: `Air transport ${tag}` })).toMatchObject({ ok: true, value: { name: `Air transport ${tag}`, customers: 1 } });
    await expect(db.customer.findUniqueOrThrow({ where: { id: customerId } })).resolves.toMatchObject({ industry: `Air transport ${tag}` });
    expect(await renameIndustry(db, sales, { id: created.value.id, name: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("deletes an industry only while nobody uses it", async () => {
    const [root, sales] = await Promise.all([actorOf("SUPERADMIN"), actorOf("SALES")]);
    const tag = randomBytes(3).toString("hex");
    const used = await createIndustry(db, root, { name: `Used ${tag}` });
    const spare = await createIndustry(db, root, { name: `Spare ${tag}` });
    if (!used.ok || !spare.ok) throw new Error("setup");
    const project = await createProject(db, sales, { endUserCompany: `PT Del ${tag}`, name: "del" });
    if (!project.ok) throw new Error(project.message);
    const row = await db.project.findUniqueOrThrow({ where: { id: project.value.id }, select: { customerId: true } });
    await setCustomerIndustry(db, sales, { customerId: row.customerId!, industry: `Used ${tag}` });

    expect(await deleteIndustry(db, root, { id: used.value.id })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await deleteIndustry(db, root, { id: spare.value.id })).toMatchObject({ ok: true });
    expect(await deleteIndustry(db, sales, { id: spare.value.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.industry.findUnique({ where: { id: spare.value.id } })).resolves.toBeNull();
  });
});
