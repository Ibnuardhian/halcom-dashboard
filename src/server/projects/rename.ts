import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { notify, projectAudience } from "@/server/notifications/service";

type Actor = { id: string; role: Role };

const renameSchema = z.object({ projectId: z.uuid(), name: z.string().trim().min(1, "Tuliskan nama project.").max(160, "Nama maksimal 160 karakter.") }).strict();

export type RenameResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"; message: string };

/**
 * Changes a project's name (a typo, or a clearer title). Superadmin, Admin and SOA. Nothing else about the project changes; the old
 * and the new name go to the change log and the audit log, and the people on the project are told.
 */
export async function renameProject(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<RenameResult> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid." };
  const { projectId } = parsed.data;
  const name = parsed.data.name.replace(/\s+/g, " ");

  return db.$transaction(async (tx): Promise<RenameResult> => {
    // The stored role decides, so a demoted or deactivated user cannot act on a stale session.
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.rename")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, name: true, endUserCompany: true, deletedAt: true } });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." };
    if (project.name === name) return { ok: true, changed: false };

    await tx.project.update({ where: { id: project.id }, data: { name } });
    await tx.projectChange.create({ data: { projectId: project.id, changedById: actor.id, field: "name", fromValue: project.name, toValue: name } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "project.renamed", entityType: "project", entityId: project.id, before: { name: project.name } as Prisma.InputJsonValue, after: { name } as Prisma.InputJsonValue },
    });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: await projectAudience(tx, project.id),
      kind: "project.updated",
      title: `${project.code} renamed`,
      body: `${project.endUserCompany}: ${project.name} → ${name}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, changed: true };
  });
}
