import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { cleanName, nameKey } from "@/domain/projects/pipeline";

type Actor = { id: string; role: Role };
type Failure = { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT"; message: string };
export type CustomerEditResult<T = Record<string, never>> = { ok: true; value: T } | Failure;

const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";
const fail = (code: Failure["code"], message: string): Failure => ({ ok: false, code, message });

const nameSchema = z.string().trim().min(1, "Tuliskan nama customer.").max(120, "Nama maksimal 120 karakter.");

async function superadmin(tx: Prisma.TransactionClient, claimed: Actor) {
  const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && can(actor.role, "customers.rename") ? actor : null;
}

/**
 * Corrects a customer's name (a typo). Every project of the customer shows the new name as its end user, in lists, charts and
 * exports. A name another customer already has is refused: that is a merge, not a rename. Superadmin only; audited with the old name.
 */
export async function renameCustomer(db: PrismaClient, claimed: Actor, input: unknown): Promise<CustomerEditResult<{ name: string; projects: number }>> {
  const parsed = z.object({ customerId: z.uuid(), name: nameSchema }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimed.role, "customers.rename")) return fail("FORBIDDEN", FORBIDDEN);
  const name = cleanName(parsed.data.name);

  return db.$transaction(async (tx): Promise<CustomerEditResult<{ name: string; projects: number }>> => {
    const actor = await superadmin(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const customer = await tx.customer.findUnique({ where: { id: parsed.data.customerId } });
    if (!customer) return fail("NOT_FOUND", "Customer tidak ditemukan.");
    if (customer.name === name) return { ok: true, value: { name, projects: 0 } };
    const clash = await tx.customer.findUnique({ where: { nameKey: nameKey(name) }, select: { id: true, name: true } });
    if (clash && clash.id !== customer.id) return fail("CONFLICT", `"${clash.name}" sudah ada. Pakai Gabungkan untuk menyatukan keduanya.`);

    await tx.customer.update({ where: { id: customer.id }, data: { name, nameKey: nameKey(name) } });
    const moved = await tx.project.updateMany({ where: { customerId: customer.id }, data: { endUserCompany: name } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "customer.renamed", entityType: "customer", entityId: customer.id, before: { name: customer.name }, after: { name, projects: moved.count } as Prisma.InputJsonValue },
    });
    return { ok: true, value: { name, projects: moved.count } };
  });
}

/**
 * Merges one customer into another that is the same company written differently (PNP into Politeknik Negeri Padang): every project
 * of the first moves to the second and shows its name, the first customer is removed, and the industry of the first is kept only
 * when the second has none. Superadmin only; audited with the counts.
 */
export async function mergeCustomers(db: PrismaClient, claimed: Actor, input: unknown): Promise<CustomerEditResult<{ target: string; projects: number }>> {
  const parsed = z.object({ sourceId: z.uuid(), targetId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Pilih customer tujuan.");
  if (!can(claimed.role, "customers.rename")) return fail("FORBIDDEN", FORBIDDEN);
  const { sourceId, targetId } = parsed.data;
  if (sourceId === targetId) return fail("INVALID_INPUT", "Pilih customer lain sebagai tujuan.");

  return db.$transaction(async (tx): Promise<CustomerEditResult<{ target: string; projects: number }>> => {
    const actor = await superadmin(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const [source, target] = await Promise.all([tx.customer.findUnique({ where: { id: sourceId } }), tx.customer.findUnique({ where: { id: targetId } })]);
    if (!source || !target) return fail("NOT_FOUND", "Customer tidak ditemukan.");

    const moved = await tx.project.updateMany({ where: { customerId: source.id }, data: { customerId: target.id, endUserCompany: target.name } });
    if (target.industry === null && source.industry !== null) await tx.customer.update({ where: { id: target.id }, data: { industry: source.industry } });
    await tx.customer.delete({ where: { id: source.id } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "customer.merged",
        entityType: "customer",
        entityId: target.id,
        before: { name: source.name, industry: source.industry, id: source.id } as Prisma.InputJsonValue,
        after: { name: target.name, projects: moved.count } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, value: { target: target.name, projects: moved.count } };
  });
}
