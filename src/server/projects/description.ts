import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { salesActsOn } from "@/domain/projects/source";
import { notify, projectAudience } from "@/server/notifications/service";

type Actor = { id: string; role: Role };

const PERMISSION = "projects.edit.description";
const descriptionSchema = z.object({ projectId: z.uuid(), description: z.string().max(2000, "Deskripsi maksimal 2000 karakter.") }).strict();

export type DescriptionResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"; message: string };

/**
 * Changes a project's description (an empty text clears it). Whoever holds `projects.edit.description`; a role that edits the commercial part
 * but not the source (Sales) may do it only on the projects it acts on. The old and new text go to the change log and the audit log.
 */
export async function setProjectDescription(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DescriptionResult> {
  const parsed = descriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid." };
  const description = parsed.data.description.replace(/\r\n/g, "\n").trim() || null;

  return db.$transaction(async (tx): Promise<DescriptionResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, PERMISSION)) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${parsed.data.projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: parsed.data.projectId }, select: { id: true, code: true, endUserCompany: true, description: true, sourceType: true, salesOwnerId: true, deletedAt: true } });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." };
    const ownOnly = can(actor.role, "projects.edit.commercial") && !can(actor.role, "projects.edit.source");
    if (ownOnly && !salesActsOn(project, actor.id)) return { ok: false, code: "FORBIDDEN", message: "Anda hanya dapat mengubah deskripsi project yang Anda tangani." };
    if ((project.description ?? null) === description) return { ok: true, changed: false };

    await tx.project.update({ where: { id: project.id }, data: { description } });
    await tx.projectChange.create({ data: { projectId: project.id, changedById: actor.id, field: "description", fromValue: project.description, toValue: description } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "project.description_changed", entityType: "project", entityId: project.id, before: { description: project.description } as Prisma.InputJsonValue, after: { description } as Prisma.InputJsonValue },
    });
    await notify(tx, { actorId: actor.id, recipientIds: await projectAudience(tx, project.id), kind: "project.updated", title: `${project.code} description changed`, body: project.endUserCompany, href: `/projects/${project.code}` });
    return { ok: true, changed: true };
  });
}
