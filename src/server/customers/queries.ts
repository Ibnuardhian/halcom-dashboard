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

/** The industries already in use (customers first, then what projects carried from the export), so the form can suggest them and spelling stays the same. */
export async function listIndustrySuggestions(db: PrismaClient, viewer: { id: string; role: Role }): Promise<string[]> {
  if (!can(viewer.role, "customers.view")) throw new Error("Forbidden: missing permission for this query.");
  const [fromCustomers, fromProjects] = await Promise.all([
    db.customer.findMany({ where: { industry: { not: null } }, distinct: ["industry"], select: { industry: true }, take: 200 }),
    db.project.findMany({ where: { industry: { not: null }, deletedAt: null }, distinct: ["industry"], select: { industry: true }, take: 200 }),
  ]);
  const seen = new Map<string, string>();
  for (const row of [...fromCustomers, ...fromProjects]) {
    const value = row.industry?.trim();
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
