import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { listCustomers, listIndustrySuggestions } from "@/server/customers/queries";
import { setCustomerIndustry } from "@/server/customers/service";
import { getPipelineAnalytics } from "@/server/projects/analytics";
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

async function customerWithProject(sales: { id: string; role: Role }, tag: string) {
  const created = await createProject(db, sales, { endUserCompany: `PT Ind ${tag}`, name: "Industry test", estimatedValue: "1.000" });
  if (!created.ok) throw new Error(created.message);
  const project = await db.project.findUniqueOrThrow({ where: { id: created.value.id }, select: { id: true, customerId: true } });
  return { projectId: project.id, customerId: project.customerId! };
}

describe("setCustomerIndustry", () => {
  it("sets, changes and clears the industry, trims it, and audits each real change", async () => {
    const sales = await actorOf("SALES");
    const { customerId } = await customerWithProject(sales, randomBytes(3).toString("hex"));

    expect(await setCustomerIndustry(db, sales, { customerId, industry: "  Banking  " })).toEqual({ ok: true, changed: true, industry: "Banking" });
    expect(await setCustomerIndustry(db, sales, { customerId, industry: "Banking" })).toEqual({ ok: true, changed: false, industry: "Banking" });
    expect(await setCustomerIndustry(db, sales, { customerId, industry: "Education" })).toMatchObject({ ok: true, changed: true });
    expect(await setCustomerIndustry(db, sales, { customerId, industry: "   " })).toEqual({ ok: true, changed: true, industry: null });

    await expect(db.customer.findUniqueOrThrow({ where: { id: customerId } })).resolves.toMatchObject({ industry: null });
    const audit = await db.auditEvent.findMany({ where: { action: "customer.industry_set", entityId: customerId }, orderBy: { createdAt: "asc" } });
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ actorId: sales.id, before: { industry: null }, after: { industry: "Banking" } });
  });

  it("is allowed for Admin and Superadmin and refused for the other roles, bad input and an unknown customer", async () => {
    const sales = await actorOf("SALES");
    const { customerId } = await customerWithProject(sales, randomBytes(3).toString("hex"));

    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect((await setCustomerIndustry(db, await actorOf(role), { customerId, industry: "Retail" })).ok, role).toBe(true);
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await setCustomerIndustry(db, await actorOf(role), { customerId, industry: "x" }), role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await setCustomerIndustry(db, sales, { customerId, industry: "x".repeat(81) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setCustomerIndustry(db, sales, { customerId: "not-an-id", industry: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setCustomerIndustry(db, sales, { customerId: "00000000-0000-4000-8000-000000000000", industry: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    expect(await setCustomerIndustry(db, sales, { customerId, industry: "y" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("shows on the Customers list, is suggested to the next person, and counts the customer's projects under it in the Industry chart", async () => {
    const sales = await actorOf("SALES");
    const tag = randomBytes(3).toString("hex");
    const { customerId, projectId } = await customerWithProject(sales, tag);
    const industry = `Industry ${tag}`;
    // The project carries free text from the export; the customer's industry wins once it is filled in.
    await db.project.update({ where: { id: projectId }, data: { industry: `Old text ${tag}` } });

    await setCustomerIndustry(db, sales, { customerId, industry });

    const customers = await listCustomers(db, sales, `PT Ind ${tag}`);
    expect(customers[0]).toMatchObject({ id: customerId, industry });
    expect(await listIndustrySuggestions(db, sales)).toContain(industry);
    const analytics = await getPipelineAnalytics(db, sales, { salesOwnerId: sales.id });
    const labels = analytics.byIndustry.map((slice) => slice.label);
    expect(labels).toContain(industry);
    expect(labels).not.toContain(`Old text ${tag}`);
  });
});
