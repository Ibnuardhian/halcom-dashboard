import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";

type Actor = { id: string; role: Role };

const deleteSchema = z.object({ projectId: z.uuid(), confirmCode: z.string().trim() }).strict();

export type DeleteResult = { ok: true; code: string } | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"; message: string };

/**
 * Deletes a project the way the rest of the system deletes things: it is marked deleted and hidden from every list, chart,
 * target figure and export, while its requests, status history, change log and audit trail stay (those tables are
 * append-only). Only a superadmin may do it, and has to type the project number to confirm. The audit event keeps a snapshot.
 */
export async function deleteProject(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DeleteResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Pilih proyek yang akan dihapus." };
  const { projectId, confirmCode } = parsed.data;

  return db.$transaction(async (tx): Promise<DeleteResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.delete")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, include: { requests: { select: { status: true } } } });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." };
    if (confirmCode !== project.code) return { ok: false, code: "INVALID_INPUT", message: `Ketik ${project.code} untuk mengonfirmasi penghapusan.` };

    await tx.project.update({ where: { id: project.id }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "project.deleted",
        entityType: "project",
        entityId: project.id,
        before: { code: project.code, endUserCompany: project.endUserCompany, name: project.name, progress: project.progress, requests: project.requests.length },
      },
    });
    return { ok: true, code: project.code };
  });
}
