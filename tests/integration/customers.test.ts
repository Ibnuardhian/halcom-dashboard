import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { listCustomers } from "@/server/customers/queries";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string }, role: Role) => ({ id: user.id, role });

describe("customers", () => {
  it("are filled in by creating projects: one customer per name, however it is spelled, with its project counts", async () => {
    const sales = await makeUser("SALES");
    const name = `PT Pelanggan ${randomBytes(3).toString("hex")}`;

    await createProject(db, as(sales, "SALES"), { endUserCompany: name, name: "First" });
    const second = await createProject(db, as(sales, "SALES"), { endUserCompany: `  ${name.toUpperCase()} `, name: "Second", progress: "CLOSED_WON" });
    expect(second.ok).toBe(true);

    const rows = await listCustomers(db, as(sales, "SALES"), name);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name, projects: 2, openProjects: 1 });
    expect(rows[0]!.lastProjectAt).toBeInstanceOf(Date);
  });

  it("count a project whose sales is Other like any other, and not a deleted one", async () => {
    const sales = await makeUser("SALES");
    const name = `PT Lain ${randomBytes(3).toString("hex")}`;
    await createProject(db, as(sales, "SALES"), { endUserCompany: name, name: "Via partner", sourceType: "OTHER", externalSourceName: "Budi" });
    const gone = await createProject(db, as(sales, "SALES"), { endUserCompany: name, name: "Removed" });
    if (!gone.ok) throw new Error(gone.message);
    await db.project.update({ where: { id: gone.value.id }, data: { deletedAt: new Date() } });

    const [row] = await listCustomers(db, as(sales, "SALES"), name);

    expect(row).toMatchObject({ projects: 1, openProjects: 1 });
  });

  it("are readable by Sales and admins only", async () => {
    const [sales, admin, soa, purchasing, finance] = await Promise.all([makeUser("SALES"), makeUser("ADMIN"), makeUser("SOA"), makeUser("PURCHASING"), makeUser("FINANCE")]);

    await expect(listCustomers(db, as(sales, "SALES"))).resolves.toBeInstanceOf(Array);
    await expect(listCustomers(db, as(admin, "ADMIN"))).resolves.toBeInstanceOf(Array);
    for (const [user, role] of [[soa, "SOA"], [purchasing, "PURCHASING"], [finance, "FINANCE"]] as const) {
      await expect(listCustomers(db, as(user, role))).rejects.toThrow(/Forbidden/);
    }
  });
});
