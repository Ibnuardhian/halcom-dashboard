import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { normaliseIndustry } from "@/domain/customers/industry";
import { nameKey } from "@/domain/projects/pipeline";

type Actor = { id: string; role: Role };
type Failure = { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT"; message: string };
export type IndustryResult<T = Record<string, never>> = { ok: true; value: T } | Failure;

const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";
const fail = (code: Failure["code"], message: string): Failure => ({ ok: false, code, message });

export type IndustryRow = { id: string; name: string; customers: number };

/** The list of industries with how many customers use each, A to Z. Anyone who may read customers may read it. */
export async function listIndustries(db: PrismaClient, viewer: { role: Role }): Promise<IndustryRow[]> {
  if (!can(viewer.role, "customers.view")) throw new Error("Forbidden: missing permission for this query.");
  const [industries, customers] = await Promise.all([db.industry.findMany(), db.customer.groupBy({ by: ["industry"], where: { industry: { not: null } }, _count: true })]);
  const used = new Map<string, number>();
  for (const row of customers) used.set(nameKey(row.industry ?? ""), (used.get(nameKey(row.industry ?? "")) ?? 0) + row._count);
  return industries.map((industry) => ({ id: industry.id, name: industry.name, customers: used.get(industry.nameKey) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

async function superadmin(tx: Prisma.TransactionClient, claimed: Actor) {
  const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && can(actor.role, "industries.manage") ? actor : null;
}

function readName(input: unknown): { ok: true; name: string } | Failure {
  const parsed = z.string().max(400).safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Tuliskan nama industri.");
  const industry = normaliseIndustry(parsed.data);
  if (!industry.ok) return fail("INVALID_INPUT", industry.message);
  if (industry.value === null) return fail("INVALID_INPUT", "Tuliskan nama industri.");
  return { ok: true, name: industry.value };
}

/** Adds an industry to the list. A name that exists (ignoring case and spacing) is refused. Admin and Superadmin; audited. */
export async function createIndustry(db: PrismaClient, claimed: Actor, input: { name: unknown }): Promise<IndustryResult<{ id: string }>> {
  if (!can(claimed.role, "industries.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const read = readName(input.name);
  if (!read.ok) return read;
  return db.$transaction(async (tx): Promise<IndustryResult<{ id: string }>> => {
    const actor = await superadmin(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    if (await tx.industry.findUnique({ where: { nameKey: nameKey(read.name) } })) return fail("CONFLICT", `Industri "${read.name}" sudah ada.`);
    const created = await tx.industry.create({ data: { name: read.name, nameKey: nameKey(read.name) }, select: { id: true } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "industry.created", entityType: "industry", entityId: created.id, after: { name: read.name } } });
    return { ok: true, value: { id: created.id } };
  });
}

/**
 * Renames an industry. Every customer (and project) that carries the old name moves to the new one, so nobody is left on a name that is
 * no longer in the list. A name another industry has is refused. Admin and Superadmin; audited with the count.
 */
export async function renameIndustry(db: PrismaClient, claimed: Actor, input: { id: unknown; name: unknown }): Promise<IndustryResult<{ name: string; customers: number }>> {
  if (!can(claimed.role, "industries.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const id = z.uuid().safeParse(input.id);
  const read = readName(input.name);
  if (!id.success) return fail("INVALID_INPUT", "Industri tidak valid.");
  if (!read.ok) return read;
  return db.$transaction(async (tx): Promise<IndustryResult<{ name: string; customers: number }>> => {
    const actor = await superadmin(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const industry = await tx.industry.findUnique({ where: { id: id.data } });
    if (!industry) return fail("NOT_FOUND", "Industri tidak ditemukan.");
    const clash = await tx.industry.findUnique({ where: { nameKey: nameKey(read.name) } });
    if (clash && clash.id !== industry.id) return fail("CONFLICT", `Industri "${clash.name}" sudah ada.`);
    if (industry.name === read.name) return { ok: true, value: { name: read.name, customers: 0 } };

    await tx.industry.update({ where: { id: industry.id }, data: { name: read.name, nameKey: nameKey(read.name) } });
    // The names are compared ignoring case and spacing, as everywhere else.
    const moved = await tx.$executeRaw`UPDATE customers SET industry = ${read.name} WHERE industry IS NOT NULL AND lower(regexp_replace(trim(industry), '[[:space:]]+', ' ', 'g')) = ${industry.nameKey}`;
    await tx.$executeRaw`UPDATE projects SET industry = ${read.name} WHERE industry IS NOT NULL AND lower(regexp_replace(trim(industry), '[[:space:]]+', ' ', 'g')) = ${industry.nameKey}`;
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "industry.renamed", entityType: "industry", entityId: industry.id, before: { name: industry.name }, after: { name: read.name, customers: moved } } });
    return { ok: true, value: { name: read.name, customers: moved } };
  });
}

/** Removes an industry from the list, only while no customer or project carries it. Admin and Superadmin; audited. */
export async function deleteIndustry(db: PrismaClient, claimed: Actor, input: { id: unknown }): Promise<IndustryResult> {
  if (!can(claimed.role, "industries.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const id = z.uuid().safeParse(input.id);
  if (!id.success) return fail("INVALID_INPUT", "Industri tidak valid.");
  return db.$transaction(async (tx): Promise<IndustryResult> => {
    const actor = await superadmin(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const industry = await tx.industry.findUnique({ where: { id: id.data } });
    if (!industry) return fail("NOT_FOUND", "Industri tidak ditemukan.");
    const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM customers WHERE industry IS NOT NULL AND lower(regexp_replace(trim(industry), '[[:space:]]+', ' ', 'g')) = ${industry.nameKey}) + (SELECT count(*) FROM projects WHERE deleted_at IS NULL AND industry IS NOT NULL AND lower(regexp_replace(trim(industry), '[[:space:]]+', ' ', 'g')) = ${industry.nameKey}) AS n`;
    const inUse = Number(rows[0]?.n ?? 0);
    if (inUse > 0) return fail("CONFLICT", `Industri "${industry.name}" masih dipakai ${inUse} customer atau project. Ganti dulu industrinya, atau ubah namanya.`);
    await tx.industry.delete({ where: { id: industry.id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "industry.deleted", entityType: "industry", entityId: industry.id, before: { name: industry.name } } });
    return { ok: true, value: {} };
  });
}
