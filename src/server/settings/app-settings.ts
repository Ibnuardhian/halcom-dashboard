import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { readProjectColumns, type ProjectColumnKey } from "@/domain/projects/table-columns";

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
