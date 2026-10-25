import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { normaliseIndustry } from "@/domain/customers/industry";

type Actor = { id: string; role: Role };

export type SetIndustryResult = { ok: true; changed: boolean; industry: string | null } | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND"; message: string };

const schema = z.object({ customerId: z.uuid(), industry: z.string().max(400).nullish() }).strict();

/**
 * Sets the industry of a customer (empty clears it). The customer's industry is what charts, filters and exports use for all of its
 * projects. Who may: the roles that hold customers.edit (Sales, Admin and Superadmin by default). The stored actor is re-read inside the
 * transaction, and the change with its audit event (who, from, to) commits together; setting the same value changes and logs nothing.
 */
export async function setCustomerIndustry(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<SetIndustryResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "The submitted customer is invalid." };
  if (!can(claimedActor.role, "customers.edit")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  const industry = normaliseIndustry(parsed.data.industry);
  if (!industry.ok) return { ok: false, code: "INVALID_INPUT", message: industry.message };

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "customers.edit")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." } satisfies SetIndustryResult;
    const customer = await tx.customer.findUnique({ where: { id: parsed.data.customerId }, select: { id: true, name: true, industry: true } });
    if (!customer) return { ok: false, code: "NOT_FOUND", message: "Customer tidak ditemukan." } satisfies SetIndustryResult;
    if (customer.industry === industry.value) return { ok: true, changed: false, industry: industry.value } satisfies SetIndustryResult;

    await tx.customer.update({ where: { id: customer.id }, data: { industry: industry.value } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "customer.industry_set",
        entityType: "customer",
        entityId: customer.id,
        before: { name: customer.name, industry: customer.industry } as Prisma.InputJsonValue,
        after: { name: customer.name, industry: industry.value } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, changed: true, industry: industry.value } satisfies SetIndustryResult;
  });
}
