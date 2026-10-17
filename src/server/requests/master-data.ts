import type { Prisma } from "@/generated/prisma/client";
import { cleanName, nameKey } from "@/domain/projects/pipeline";

type Tx = Prisma.TransactionClient;

/**
 * Finds or creates the master-data record for a name. Names are matched on their normalised key,
 * so "HPE", "hpe" and " HPE " are one principal; the first spelling used is the one kept.
 */
export async function ensureCustomer(tx: Tx, name: string): Promise<string> {
  const clean = cleanName(name);
  const row = await tx.customer.upsert({
    where: { nameKey: nameKey(clean) },
    update: {},
    create: { name: clean, nameKey: nameKey(clean) },
    select: { id: true },
  });
  return row.id;
}

export async function ensurePrincipal(tx: Tx, name: string): Promise<string> {
  const clean = cleanName(name);
  const row = await tx.principal.upsert({
    where: { nameKey: nameKey(clean) },
    update: {},
    create: { name: clean, nameKey: nameKey(clean) },
    select: { id: true },
  });
  return row.id;
}

export async function ensureSolutionCategory(tx: Tx, name: string): Promise<string> {
  const clean = cleanName(name);
  const row = await tx.solutionCategory.upsert({
    where: { nameKey: nameKey(clean) },
    update: {},
    create: { name: clean, nameKey: nameKey(clean) },
    select: { id: true },
  });
  return row.id;
}
