import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { CLOSED_PROGRESSES } from "@/domain/projects/progress";

export type CustomerRow = { id: string; name: string; industry: string | null; projects: number; openProjects: number; lastProjectAt: Date | null };

export const CUSTOMER_LIMIT = 500;

/**
 * Customers (end-user companies) with how many projects they have. Customers are not entered here: they are created from the
 * end-user company typed when a project is created, and the same name is one customer whatever its spelling or case.
 */
export async function listCustomers(db: PrismaClient, viewer: { id: string; role: Role }, search?: string): Promise<CustomerRow[]> {
  if (!can(viewer.role, "customers.view")) throw new Error("Forbidden: missing permission for this query.");
  const term = search?.trim();
  const customers = await db.customer.findMany({
    where: term ? { name: { contains: term, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    take: CUSTOMER_LIMIT,
    include: { projects: { where: { deletedAt: null }, select: { progress: true, trackStatus: true, createdAt: true } } },
  });
  return customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    industry: customer.industry,
    projects: customer.projects.length,
    openProjects: customer.projects.filter((p) => !CLOSED_PROGRESSES.includes(p.progress) && p.trackStatus !== "DONE").length,
    lastProjectAt: customer.projects.reduce<Date | null>((latest, p) => (latest === null || p.createdAt > latest ? p.createdAt : latest), null),
  }));
}

/** The industries a customer can be given: the list a Superadmin edits, A to Z. */
export async function listIndustrySuggestions(db: PrismaClient, viewer: { id: string; role: Role }): Promise<string[]> {
  if (!can(viewer.role, "customers.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.industry.findMany({ select: { name: true } });
  return rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
}
