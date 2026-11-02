import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { readProjectColumns, type ProjectColumnKey } from "@/domain/projects/table-columns";
import { MAX_TAX_RATE_PERCENT, readTaxBasis, type TaxBasis } from "@/domain/projects/tax-basis";

const PROJECT_COLUMNS_KEY = "projects.columns";

export async function getProjectColumns(db: PrismaClient): Promise<ProjectColumnKey[]> {
  const row = await db.appSetting.findUnique({ where: { key: PROJECT_COLUMNS_KEY } });
  return readProjectColumns(row?.value);
}

export type SaveColumnsResult = { ok: true; changed: boolean } | { ok: false; message: string };

/** Saves which columns the Projects table shows, for everyone. Superadmin only (checked again against the stored account); audited. */
export async function saveProjectColumns(db: PrismaClient, claimed: { id: string; role: Role }, input: unknown): Promise<SaveColumnsResult> {
  const forbidden = { ok: false, message: "Anda tidak diizinkan melakukan ini." } as const;
  if (!can(claimed.role, "settings.manage")) return forbidden;
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string")) return { ok: false, message: "Pilihan kolom tidak valid." };
  const columns = readProjectColumns(input);
  if (input.length === 0) return { ok: false, message: "Pilih paling sedikit satu kolom." };
  return db.$transaction(async (tx): Promise<SaveColumnsResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "settings.manage")) return forbidden;
    const before = readProjectColumns((await tx.appSetting.findUnique({ where: { key: PROJECT_COLUMNS_KEY } }))?.value);
    if (before.join() === columns.join()) return { ok: true, changed: false };
    await tx.appSetting.upsert({ where: { key: PROJECT_COLUMNS_KEY }, create: { key: PROJECT_COLUMNS_KEY, value: columns, updatedById: actor.id }, update: { value: columns, updatedById: actor.id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "settings.project_columns", entityType: "settings", entityId: PROJECT_COLUMNS_KEY, before: { columns: before } as Prisma.InputJsonValue, after: { columns } as Prisma.InputJsonValue } });
    return { ok: true, changed: true };
  });
}

const TAX_BASIS_KEY = "pricing.tax-basis";

export async function getTaxBasis(db: PrismaClient): Promise<TaxBasis> {
  return readTaxBasis((await db.appSetting.findUnique({ where: { key: TAX_BASIS_KEY } }))?.value);
}

/** Saves whether the value and the margin include PPN, and the rate. Superadmin only (checked again against the stored account); audited. */
export async function saveTaxBasis(db: PrismaClient, claimed: { id: string; role: Role }, input: { valueIncludesTax: unknown; marginIncludesTax: unknown; taxRatePercent: unknown }): Promise<SaveColumnsResult> {
  const forbidden = { ok: false, message: "Anda tidak diizinkan melakukan ini." } as const;
  if (!can(claimed.role, "settings.manage")) return forbidden;
  const rate = typeof input.taxRatePercent === "number" ? input.taxRatePercent : Number.NaN;
  if (typeof input.valueIncludesTax !== "boolean" || typeof input.marginIncludesTax !== "boolean") return { ok: false, message: "Pilihan basis tidak valid." };
  if (!(rate >= 0 && rate <= MAX_TAX_RATE_PERCENT)) return { ok: false, message: `Tarif PPN harus antara 0 dan ${MAX_TAX_RATE_PERCENT} persen.` };
  const next: TaxBasis = { valueIncludesTax: input.valueIncludesTax, marginIncludesTax: input.marginIncludesTax, taxRatePercent: Math.round(rate * 100) / 100 };
  return db.$transaction(async (tx): Promise<SaveColumnsResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "settings.manage")) return forbidden;
    const before = readTaxBasis((await tx.appSetting.findUnique({ where: { key: TAX_BASIS_KEY } }))?.value);
    if (JSON.stringify(before) === JSON.stringify(next)) return { ok: true, changed: false };
    await tx.appSetting.upsert({ where: { key: TAX_BASIS_KEY }, create: { key: TAX_BASIS_KEY, value: next, updatedById: actor.id }, update: { value: next, updatedById: actor.id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "settings.tax_basis", entityType: "settings", entityId: TAX_BASIS_KEY, before: before as Prisma.InputJsonValue, after: next as Prisma.InputJsonValue } });
    return { ok: true, changed: true };
  });
}
