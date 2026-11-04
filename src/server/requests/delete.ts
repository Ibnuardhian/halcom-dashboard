import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";

type Actor = { id: string; role: Role };

const deleteSchema = z.object({ requestId: z.uuid(), confirmCode: z.string().trim() }).strict();

export type DeleteRequestResult = { ok: true; code: string; projectCode: string } | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "INVALID_STATE"; message: string };

/**
 * A superadmin deletes a BOQ, RFQ or PO request. Its status history is append-only, so the row is kept and hidden from every list,
 * board, count and email instead. The superadmin types the request code to confirm. A request that was continued (a BOQ with its
 * RFQ, an RFQ with its PO) is deleted after its continuation, so no request points at a hidden one. A deleted continuation lets go
 * of its source, so the BOQ or RFQ can be continued again. An audit event keeps what was deleted.
 */
export async function deleteRequest(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DeleteRequestResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Pilih request yang akan dihapus." };
  const { requestId, confirmCode } = parsed.data;

  return db.$transaction(async (tx): Promise<DeleteRequestResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "requests.delete")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({
      where: { id: requestId },
      include: { project: { select: { code: true, deletedAt: true } }, source: { select: { code: true } }, handovers: { where: { deletedAt: null }, select: { code: true } } },
    });
    if (!request || request.deletedAt || request.project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Request tidak ditemukan." };
    if (confirmCode !== request.code) return { ok: false, code: "INVALID_INPUT", message: `Ketik ${request.code} untuk mengonfirmasi penghapusan.` };
    if (request.handovers.length > 0) {
      return { ok: false, code: "INVALID_STATE", message: `Request ini sudah dilanjutkan ke ${request.handovers.map((h) => h.code).join(", ")}. Hapus request itu terlebih dahulu.` };
    }

    await tx.request.update({ where: { id: request.id }, data: { deletedAt: new Date(), deletedById: actor.id, sourceRequestId: null } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "request.deleted",
        entityType: "request",
        entityId: request.id,
        before: {
          code: request.code,
          type: request.type,
          status: request.status,
          project: request.project.code,
          title: request.title,
          description: request.description,
          source: request.source?.code ?? null,
        },
      },
    });
    return { ok: true, code: request.code, projectCode: request.project.code };
  });
}
